import { getToolsForDefaultPreset } from '../../tools.js'
import { deriveExpertTemplateFillSchema, EXPERT_TEMPLATE_FILL_FORMAT } from '../../utils/expertTemplateFill.js'
import type { ExpertRuntimeContext } from './expertRuntimeService.js'
import type { ExpertHostTool, ExpertRuntimeBinding, ExpertSessionMetadata, ExpertToolManifest } from './expertPackRegistryService.js'

const MAX_PROMPT_CHARACTERS = 24_000
const MAX_SKILL_CHARACTERS = 28_000
const MAX_OUTPUT_PROTOCOL_CHARACTERS = 12_000
const MAX_OUTPUT_TEMPLATE_CHARACTERS = 12_000

// Expert packs may describe recommended tools, but they do not narrow the
// desktop's actual tool pool. Edit is intentionally unavailable to every
// Expert Mode session; use Write or Bash when an expert needs to create output.
const EXPERT_GLOBALLY_DISABLED_TOOL_NAMES = new Set(['Edit', 'WebSearch'])

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
  _modelId?: string,
  baseToolNames: Iterable<string> = getToolsForDefaultPreset(),
): string[] {
  return unique([...new Set(baseToolNames)].filter((toolName) => !EXPERT_GLOBALLY_DISABLED_TOOL_NAMES.has(toolName)))
}

export function resolveExpertRuntimeToolAvailability(
  binding: ExpertRuntimeBinding,
  enabledToolNames: Iterable<string> = getToolsForDefaultPreset(),
): ExpertRuntimeToolAvailability {
  const enabled = new Set([...enabledToolNames].filter((toolName) => !EXPERT_GLOBALLY_DISABLED_TOOL_NAMES.has(toolName)))
  const hostTools = binding.hostTools.filter((tool) => tool.supported !== false && enabled.has(tool.id))
  const toolNames = unique([...enabled])
  return {
    hostTools,
    toolNames,
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

function adaptSkillContentForRuntime(content: string): string {
  // Existing imported packs may still contain obsolete names. Do not expose a
  // non-Expert research mechanism to the model through a package-local Skill.
  return content
    .replace(/\bWebSearch(?:Tool)?\b/g, 'BrowserResearch candidate-URL workflow')
    .replace(/\bweb search\b/gi, 'candidate-URL browser research')
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
    ...(context.expert.outputMode
      ? { outputMode: context.expert.outputMode }
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
    adaptSkillContentForRuntime(skill.content),
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
    ...(availability.toolNames.includes('BrowserResearch')
      ? [
          'Public research protocol: when product names, competitor names, or a research question need public evidence, construct candidate URLs from trusted domains, public entry points, task terms, and links discovered on successfully opened pages. Use BrowserResearch to open each candidate before treating it as a discovery or citation.',
          'A candidate URL is not evidence. Record accessible pages, relevant links, access limits, and failed attempts. For a key field, try other relevant candidate URLs or discovered links before asking the user for material. If BrowserResearch still cannot obtain the needed evidence after reasonable attempts, use AskUserQuestion to request a replacement link, screenshot, source file, or permission to retain an evidence gap.',
        ]
      : [
          'Public research limitation: BrowserResearch is not available for this turn. Do not claim that public pages were checked. Use AskUserQuestion to request a link, screenshot, copied page text, exported page, source file, or permission to retain an evidence gap.',
        ]),
    'Permissions:',
    permissionLines.length ? permissionLines.join('\n') : '- Follow normal desktop permissions.',
    'Expert system prompt snapshot:',
    binding.promptSnapshot || '(none)',
    'Expert package-local skills:',
    skills || '(none)',
    ...(binding.outputProtocol
      ? ['Expert output protocol:', binding.outputProtocol.content]
      : []),
    ...(binding.outputMode === 'template-fill' && binding.outputTemplate
      ? [
          'Final report delivery uses server-rendered template filling:',
          `Template source: ${binding.outputTemplate.path}`,
          'Do not generate a complete HTML document, CSS, headings, table headers, or any other page structure for the final report.',
          'After the user confirms the final .html path, call the existing Write tool once with that path and a strictly valid JSON object as content. The desktop server will render the fixed expert template; ordinary HTML text is not a formal report delivery.',
          'Use this exact JSON protocol:',
          JSON.stringify({
            format: EXPERT_TEMPLATE_FILL_FORMAT,
            templateId: deriveExpertTemplateFillSchema(binding.outputTemplate.content).templateId,
            fields: { FIELD_ID: 'text, paragraph array, or table row arrays matching the schema below' },
          }, null, 2),
          'Allowed field schema (field IDs and table columns are authoritative):',
          JSON.stringify(deriveExpertTemplateFillSchema(binding.outputTemplate.content), null, 2),
          'Each final-report field must be present. Write evidence gaps as visible content such as “待验证 / 未取得 / 无法确认”; do not invent HTML or omit required fields.',
          'Bash may create drafts or helper files, but it does not produce a server-verified formal report.',
        ]
      : binding.outputTemplate
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
