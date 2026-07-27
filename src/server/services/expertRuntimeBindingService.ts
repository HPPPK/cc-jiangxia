import { getToolsForDefaultPreset } from '../../tools.js'
import { isWebSearchEnabledForModel } from '../../tools/WebSearchTool/backend.js'
import {
  createExpertOutputTemplateWriteGuard,
  encodeExpertOutputTemplateWriteGuard,
} from '../../utils/expertOutputTemplateGuard.js'
import type { ExpertRuntimeContext } from './expertRuntimeService.js'
import type { ExpertHostTool, ExpertRuntimeBinding, ExpertSessionMetadata, ExpertToolManifest } from './expertPackRegistryService.js'

const MAX_PROMPT_CHARACTERS = 24_000
const MAX_SKILL_CHARACTERS = 28_000
const MAX_OUTPUT_PROTOCOL_CHARACTERS = 12_000
const MAX_OUTPUT_TEMPLATE_CHARACTERS = 12_000

// Expert packs may describe recommended tools, but they do not narrow the
// desktop's actual tool pool. Edit is intentionally unavailable to every
// Expert Mode session; use Write or Bash when an expert needs to create output.
const EXPERT_GLOBALLY_DISABLED_TOOL_NAMES = new Set(['Edit'])

export class ExpertRuntimeBindingError extends Error {
  readonly code = 'EXPERT_RUNTIME_BINDING_MISSING'

  constructor(message = 'Expert Mode is active but its server runtime binding is missing. Exit and re-enter this expert before sending a message.') {
    super(message)
    this.name = 'ExpertRuntimeBindingError'
  }
}

export type ExpertRuntimeTurnOptions = {
  enabledToolNames?: Iterable<string>
  modelId?: string
}

type ExpertRuntimeToolAvailability = {
  hostTools: ExpertHostTool[]
  toolNames: string[]
  webSearchUnavailable: boolean
}

function bounded(value: string | undefined, limit: number): string {
  const normalized = value?.trim() ?? ''
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 32)).trimEnd()}\n[truncated by expert runtime]`
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function isDeclaredHostToolAvailable(
  tool: ExpertToolManifest,
  hostToolsById: Map<string, ExpertHostTool>,
  enabledToolNames: Set<string>,
): boolean {
  if (tool.type !== 'hostBuiltinRef' || !tool.hostToolId || !enabledToolNames.has(tool.hostToolId)) return false
  return hostToolsById.get(tool.hostToolId)?.supported !== false
}

export function resolveCurrentExpertRuntimeToolNames(
  modelId?: string,
  baseToolNames: Iterable<string> = getToolsForDefaultPreset(),
  webSearchEnabledForModel: (model: string) => boolean = isWebSearchEnabledForModel,
): string[] {
  const enabled = new Set(baseToolNames)
  if (modelId?.trim()) {
    if (webSearchEnabledForModel(modelId)) enabled.add('WebSearch')
    else enabled.delete('WebSearch')
  }
  return [...enabled].filter((toolName) => !EXPERT_GLOBALLY_DISABLED_TOOL_NAMES.has(toolName))
}

export function resolveExpertRuntimeToolAvailability(
  binding: ExpertRuntimeBinding,
  enabledToolNames: Iterable<string> = getToolsForDefaultPreset(),
): ExpertRuntimeToolAvailability {
  const enabled = new Set(enabledToolNames)
  const hostTools = binding.hostTools.filter((tool) => tool.supported !== false && enabled.has(tool.id))
  const toolNames = unique([...enabled].filter((toolName) => !EXPERT_GLOBALLY_DISABLED_TOOL_NAMES.has(toolName)))
  return {
    hostTools,
    toolNames,
    webSearchUnavailable: !enabled.has('WebSearch'),
  }
}


export type ExpertRuntimeToolPolicy = {
  allowedTools: string[]
  disallowedTools: string[]
}

/**
 * Converts an Expert ZIP's declared host tools into an actual CLI deny list.
 * A legacy package with no currently available declarations keeps the ordinary
 * tool pool so it is not accidentally rendered unusable.
 */
export function resolveExpertRuntimeToolPolicy(
  expert: ExpertSessionMetadata | undefined,
  options: ExpertRuntimeTurnOptions = {},
): ExpertRuntimeToolPolicy {
  const declaredEnabledTools = options.enabledToolNames ?? getToolsForDefaultPreset()
  const allowedTools = resolveCurrentExpertRuntimeToolNames(options.modelId, declaredEnabledTools)
  const allowed = new Set(allowedTools)
  return {
    allowedTools,
    // This is intentionally global, not ZIP-specific: Expert Mode never narrows
    // access based on a package's hostTools declaration.
    disallowedTools: [...new Set(declaredEnabledTools)].filter((toolName) => !allowed.has(toolName)),
  }
}

function adaptSkillContentForRuntime(content: string, availability: ExpertRuntimeToolAvailability): string {
  if (!availability.webSearchUnavailable) return content
  const replacement = '[public web search is unavailable: ask the user for URLs, screenshots, copied page text, or source files instead]'
  const adapted = content.replace(/\bWebSearch(?:Tool)?\b/g, replacement)
  return [
    'Runtime availability substitution: public web discovery is unavailable in this session. Do not invoke a search tool. Ask the user to provide URLs, screenshots, copied text, exported pages, or files; use WebFetch only for a URL the user has supplied or confirmed.',
    adapted,
  ].join('\n\n')
}

export function createExpertRuntimeBinding(
  context: ExpertRuntimeContext,
  activatedAt: string,
): ExpertRuntimeBinding {
  return {
    schemaVersion: 1,
    active: true,
    expertId: context.expert.id,
    expertName: context.expert.name,
    packId: context.expert.packId,
    packVersion: context.expert.packVersion,
    promptSnapshot: bounded(context.prompts.system, MAX_PROMPT_CHARACTERS),
    skills: context.skills.map((skill) => ({
      skillId: skill.skillId,
      title: skill.title,
      path: skill.path,
      sha256: skill.sha256,
      content: bounded(skill.content, MAX_SKILL_CHARACTERS),
    })),
    hostTools: context.hostTools.map((tool) => ({ ...tool })),
    tools: context.expert.tools.map((tool) => ({
      ...tool,
      permissions: tool.permissions.map((permission) => ({ ...permission })),
    })),
    permissions: context.permissions.map((permission) => ({ ...permission })),
    ...(context.outputProtocol
      ? {
          outputProtocol: {
            path: context.outputProtocol.path,
            content: bounded(context.outputProtocol.content, MAX_OUTPUT_PROTOCOL_CHARACTERS),
          },
        }
      : {}),
    ...(context.outputTemplate
      ? {
          outputTemplate: {
            path: context.outputTemplate.path,
            content: bounded(context.outputTemplate.content, MAX_OUTPUT_TEMPLATE_CHARACTERS),
          },
        }
      : {}),
    activatedAt,
  }
}

export function buildExpertOutputTemplateWriteGuard(
  expert: ExpertSessionMetadata | undefined,
): string | null {
  if (!hasActiveExpertRuntime(expert) || !expert.runtimeBinding.outputTemplate) return null
  const template = expert.runtimeBinding.outputTemplate
  const guard = createExpertOutputTemplateWriteGuard(
    expert.runtimeBinding.expertId,
    template.path,
    template.content,
  )
  return guard ? encodeExpertOutputTemplateWriteGuard(guard) : null
}

export function hasActiveExpertRuntime(
  expert: ExpertSessionMetadata | undefined,
): expert is ExpertSessionMetadata & { runtimeBinding: ExpertRuntimeBinding } {
  return Boolean(
    expert &&
      expert.status !== 'exited' &&
      expert.runtimeBinding?.active === true,
  )
}

export function buildExpertRuntimeTurnInstruction(
  expert: ExpertSessionMetadata | undefined,
  options: ExpertRuntimeTurnOptions = {},
): string | null {
  if (!hasActiveExpertRuntime(expert)) return null
  const binding = expert.runtimeBinding
  const availability = resolveExpertRuntimeToolAvailability(
    binding,
    options.enabledToolNames ?? resolveCurrentExpertRuntimeToolNames(options.modelId),
  )
  const skills = binding.skills.map((skill) => [
    `## Skill: ${skill.title || skill.skillId}`,
    `Source: ${skill.path} (sha256:${skill.sha256})`,
    adaptSkillContentForRuntime(skill.content, availability),
  ].join('\n')).join('\n\n---\n\n')
  const permissionLines = binding.permissions.map((permission) =>
    `- ${permission.id}: ${permission.description || 'explicit user authorization is required'}`,
  )

  return [
    '<expert-runtime>',
    'This server-managed Expert Runtime is active for this turn. Follow it over ordinary chat preferences when they conflict.',
    `Expert: ${binding.expertName} (${binding.expertId})`,
    'Keep normal conversational and streamed responses. Do not turn this into a blocking form flow.',
    'Enabled host tools for this turn. Call no other tool, even if the Expert ZIP or a Skill mentions it:',
    availability.toolNames.length ? availability.toolNames.map((name) => `- ${name}`).join('\n') : '- No additional host tool is available for this expert turn.',
    ...(availability.webSearchUnavailable
      ? ['Public research fallback: web discovery is unavailable for the current model/runtime. Ask the user for URLs, screenshots, copied page text, exported pages, or files. Do not call a search tool. WebFetch may only be used for a URL the user supplied or confirmed.']
      : []),
    'Permissions:',
    permissionLines.length ? permissionLines.join('\n') : '- Follow normal desktop permissions.',
    'Expert system prompt snapshot:',
    binding.promptSnapshot || '(none)',
    'Expert package-local skills:',
    skills || '(none)',
    ...(binding.outputProtocol
      ? ['Expert output protocol:', binding.outputProtocol.content]
      : []),
    ...(binding.outputTemplate
      ? [
          'Mandatory expert output template:',
          `Source: ${binding.outputTemplate.path}`,
          'Use the following file as the exact starting document for the final output. Preserve its CSS, heading hierarchy, table headers, anchors, and all non-slot structure. Replace only {{...}} placeholders and <!-- SLOT: ... --> regions. Do not generate a new HTML layout.',
          binding.outputTemplate.content,
          'Before calling Write, check that no unresolved {{...}} placeholder or SLOT comment remains, and that every evidence-limited claim is visibly labeled as verified evidence, observation, hypothesis, or evidence gap.',
        ]
      : []),
    'When a durable expert report is required, tell the user that the desktop Expert material control creates the downloadable material package. Do not fabricate a successful package write.',
    '</expert-runtime>',
  ].join('\n\n')
}

export function buildNormalRuntimeResetInstruction(
  expert: ExpertSessionMetadata | undefined,
): string | null {
  if (!expert || expert.status !== 'exited') return null
  return [
    '<runtime-mode-reset>',
    'Expert Mode is exited. Continue as an ordinary chat session and do not apply previously injected Expert Runtime prompt, skill, tool, permission, or output-protocol constraints.',
    '</runtime-mode-reset>',
  ].join('\n')
}
