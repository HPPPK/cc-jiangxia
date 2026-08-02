import { createHash } from 'node:crypto'
import * as path from 'node:path'

import {
  ExpertPackRegistryService,
  getExpertPackStorageDir,
  type ExpertPackCreateInput,
  type ExpertPackImportPreview,
  type ExpertPackIndexEntry,
  type ExpertPackUpdateInput,
} from './expertPackRegistryService.js'
import { assertSafeZipPath, ZipPackAdapter } from './zipPackAdapter.js'

export type ExpertPackAuthoringOperationName =
  | 'guide'
  | 'list'
  | 'inspect'
  | 'validate'
  | 'create'
  | 'update'
  | 'duplicate'
  | 'delete'

export type ExpertPackAuthoringOperationInput =
  | { operation: 'guide'; topic?: string }
  | { operation: 'list' }
  | { operation: 'inspect'; packId: string }
  | { operation: 'validate'; pack: unknown }
  | { operation: 'create'; pack: unknown }
  | { operation: 'update'; packId: string; basisHash: string; patch: unknown }
  | { operation: 'duplicate'; packId: string }
  | { operation: 'delete'; packId: string; basisHash: string }

export type ExpertPackAuthoringIssue = {
  path: string
  code: string
  message: string
  severity: 'error' | 'warning'
}

export type ExpertPackAuthoringSummary = {
  packId: string
  name: string
  version: string
  description: string
  expertIds: string[]
  expertNames: string[]
  zipPath: string
  basisHash?: string
}

export type ExpertPackAuthoringResult = {
  operation: ExpertPackAuthoringOperationName
  status: 'succeeded' | 'validated' | 'rejected' | 'failed'
  persisted: boolean
  validation?: { valid: boolean; issues: ExpertPackAuthoringIssue[] }
  packs?: ExpertPackAuthoringSummary[]
  affectedPack?: ExpertPackAuthoringSummary
  beforeSummary?: ExpertPackAuthoringSummary
  afterSummary?: ExpertPackAuthoringSummary
  draft?: Record<string, unknown>
  guide?: Record<string, unknown>
  nextAction: 'none' | 'inspect-and-retry' | 'repair-and-validate' | 'choose-unique-pack-id' | 'retry-after-server-available'
  message: string
}

export type ExpertPackAuthoringServiceContext = {
  registry?: ExpertPackRegistryService
}

const adapter = new ZipPackAdapter()
const basisHashPattern = /^sha256:[a-f0-9]{64}$/

const expertPackAuthoringGuide = {
  title: 'Expert ZIP pack authoring guide',
  storage: 'Create and update only Expert ZIP packs. This tool never writes workflow packs or workflows.json.',
  requiredCreateFields: [
    'pack.packId',
    'pack.name',
    'pack.version',
    'pack.expert.id',
    'pack.expert.name',
    'pack.expert.systemPromptContent',
  ],
  recommendedFlow: [
    'Use guide or inspect to understand the expected package shape.',
    'Use validate before create.',
    'Use create only with a unique packId and expert.id.',
    'Use inspect to obtain a basisHash before update or delete.',
  ],
  boundaries: [
    'This tool only writes under the user Expert ZIP pack directory.',
    'It never writes workflow ZIP packs, workflow state, sessions, transcripts, provider settings, skills, OAuth state, or managed MCP configuration.',
    'Do not declare package-local executables or tool archives through this authoring tool.',
    'To add or replace an in-ZIP Skill during update, send patch.skills as [{ id, files: { "SKILL.md": "..." } }] and list the same id in patch.expert.skillIds. Every Skill must include non-empty SKILL.md.',
    'The legacy Skill shape { name, systemPromptContent } is rejected. Never use Bash or direct file writes to edit an Expert ZIP; use this controlled update operation.',
    'Do not set runtimePolicy during create; use a reviewed Expert pack update flow when strict runtime policy is actually required.',
    'When creating a general-purpose Expert, derive the ZIP only from the user-stated requirements.',
    'Do not inspect the current workspace, project directories, attachments, or unrelated files merely to author a general-purpose Expert.',
    'Do not automatically run a newly created Expert or analyze a directory; do so only after the user explicitly asks to use it on a specified directory.',
  ],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(field + ' is required.')
  }
  return value.trim()
}

function issue(path: string, code: string, message: string): ExpertPackAuthoringIssue {
  return { path, code, message, severity: 'error' }
}

function summarize(pack: ExpertPackIndexEntry, basisHash?: string): ExpertPackAuthoringSummary {
  const zipPath = pack.storage.source === 'bundled'
    ? pack.storage.path
    : path.join(getExpertPackStorageDir(), pack.storage.path)
  return {
    packId: pack.packId,
    name: pack.name,
    version: pack.version,
    description: pack.description,
    expertIds: pack.experts.map((expert) => expert.id),
    expertNames: pack.experts.map((expert) => expert.name),
    zipPath,
    ...(basisHash ? { basisHash } : {}),
  }
}

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('Expert pack identifiers must contain safe file-name characters.')
  }
  return safe
}

function basisHashFor(data: Uint8Array): string {
  return 'sha256:' + createHash('sha256').update(data).digest('hex')
}

function asCreateInput(value: unknown): ExpertPackCreateInput {
  if (!isRecord(value)) throw new Error('pack must be an object.')
  if ('toolArchivesBase64' in value) throw new Error('toolArchivesBase64 is not supported by expert_pack_authoring.')
  if (value.runtimePolicy !== undefined) {
    throw new Error('runtimePolicy is not supported during Expert pack creation. Create the base ZIP first, then use a reviewed update flow if needed.')
  }
  if (!isRecord(value.expert)) throw new Error('pack.expert must be an object.')

  const expert = value.expert
  return {
    ...(clone(value) as ExpertPackUpdateInput),
    packId: text(value.packId, 'pack.packId'),
    name: text(value.name ?? expert.name, 'pack.name'),
    version: text(value.version ?? '1.0.0', 'pack.version'),
    expert: {
      ...(clone(expert) as NonNullable<ExpertPackUpdateInput['expert']>),
      id: text(expert.id, 'pack.expert.id'),
      name: text(expert.name, 'pack.expert.name'),
      systemPromptContent: text(expert.systemPromptContent, 'pack.expert.systemPromptContent'),
    },
  }
}

function asUpdateInput(value: unknown): ExpertPackUpdateInput {
  if (!isRecord(value)) throw new Error('patch must be an object.')
  if ('toolArchivesBase64' in value) throw new Error('toolArchivesBase64 is not supported by expert_pack_authoring.')
  return clone(value) as ExpertPackUpdateInput
}

async function buildCandidateZip(input: ExpertPackCreateInput): Promise<Uint8Array> {
  const expert = input.expert
  const packId = text(input.packId, 'pack.packId')
  const expertId = text(expert.id, 'pack.expert.id')
  const expertName = text(expert.name, 'pack.expert.name')
  const expertRoot = 'experts/' + safeSegment(expertId)
  const systemPath = expertRoot + '/prompts/system.md'
  const expertPath = expertRoot + '/expert.json'
  const entries: Record<string, Uint8Array | string> = {
    'manifest.json': JSON.stringify({
      packId,
      name: text(input.name ?? expertName, 'pack.name'),
      version: text(input.version ?? '1.0.0', 'pack.version'),
      schemaVersion: 1,
      type: 'expert-pack',
      description: input.description ?? '',
      entrypoints: { experts: [expertPath], skills: [], tools: [] },
      ...(input.minHostVersion ? { minHostVersion: input.minHostVersion } : {}),
      ...(input.hostTools ? { hostTools: input.hostTools } : {}),
      ...(input.permissions ? { permissions: input.permissions } : {}),
      ...(input.compatibility ? { compatibility: input.compatibility } : {}),
      ...(input.catalog ? { catalog: input.catalog } : {}),
      portability: input.portability ?? { selfContained: true },
    }, null, 2) + '\n',
    [expertPath]: JSON.stringify({
      id: expertId,
      name: expertName,
      description: expert.description ?? '',
      statusLabel: expert.statusLabel ?? '',
      ...(expert.profile ? { profile: expert.profile } : {}),
      promptPaths: { system: systemPath },
      skillIds: expert.skillIds ?? [],
      formPaths: [],
    }, null, 2) + '\n',
    [systemPath]: expert.systemPromptContent ?? '',
  }

  if (expert.intakeFlow) {
    const formPath = expertRoot + '/forms/intake.json'
    const expertEntry = JSON.parse(String(entries[expertPath])) as Record<string, unknown>
    expertEntry.formPaths = [formPath]
    entries[expertPath] = JSON.stringify(expertEntry, null, 2) + '\n'
    entries[formPath] = JSON.stringify(expert.intakeFlow, null, 2) + '\n'
  }
  if (expert.outputProtocolContent !== undefined) {
    const outputPath = expertRoot + '/output-protocol.json'
    const expertEntry = JSON.parse(String(entries[expertPath])) as Record<string, unknown>
    expertEntry.outputProtocolPath = outputPath
    entries[expertPath] = JSON.stringify(expertEntry, null, 2) + '\n'
    entries[outputPath] = expert.outputProtocolContent
  }

  const toolPaths: string[] = []
  for (const tool of input.tools ?? []) {
    if (!isRecord(tool)) throw new Error('pack.tools entries must be objects.')
    const entrypoint = text(tool.entrypoint, 'pack.tools[].entrypoint')
    assertSafeZipPath(entrypoint)
    if (!entrypoint.startsWith('tools/')) throw new Error('ZIP tool entrypoint must be inside tools/: ' + entrypoint)
    entries[entrypoint] = JSON.stringify(tool, null, 2) + '\n'
    toolPaths.push(entrypoint)
  }
  const manifest = JSON.parse(String(entries['manifest.json'])) as Record<string, unknown>
  manifest.entrypoints = {
    ...(isRecord(manifest.entrypoints) ? manifest.entrypoints : {}),
    tools: [...new Set(toolPaths)],
  }
  entries['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n'
  return adapter.write(entries)
}

async function findPack(registry: ExpertPackRegistryService, packId: string): Promise<ExpertPackIndexEntry | null> {
  return (await registry.listPacks()).find((pack) => pack.packId === packId) ?? null
}

async function getBasisHash(registry: ExpertPackRegistryService, packId: string): Promise<string> {
  const exported = await registry.exportExpertPackZip(packId)
  return basisHashFor(new Uint8Array(Buffer.from(exported.dataBase64, 'base64')))
}

async function validateCandidate(input: ExpertPackCreateInput, registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringIssue[]> {
  try {
    const preview: ExpertPackImportPreview = await registry.previewExpertPackZip(await buildCandidateZip(input), { detectConflicts: false })
    return preview.canImport
      ? []
      : preview.warnings.map((warning) => issue('$.pack', 'EXPERT_PACK_INVALID', warning))
  } catch (error) {
    return [issue('$.pack', 'EXPERT_PACK_INVALID', error instanceof Error ? error.message : String(error))]
  }
}

async function executeGuide(topic?: string): Promise<ExpertPackAuthoringResult> {
  const known = new Set(['identity', 'prompt', 'intake', 'tools', 'boundaries'])
  const invalid = Boolean(topic && !known.has(topic))
  return {
    operation: 'guide',
    status: invalid ? 'rejected' : 'succeeded',
    persisted: false,
    validation: { valid: !invalid, issues: invalid ? [issue('$.topic', 'EXPERT_PACK_AUTHORING_GUIDE_TOPIC_UNKNOWN', 'Guide topic was not recognized; returning the full guide.')] : [] },
    guide: clone(expertPackAuthoringGuide),
    nextAction: invalid ? 'repair-and-validate' : 'none',
    message: invalid ? 'Guide topic was not recognized.' : 'Expert ZIP pack authoring guide returned.',
  }
}

async function executeList(registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringResult> {
  const packs = await registry.listPacks()
  const summaries = await Promise.all(packs.map(async (pack) => summarize(pack, await getBasisHash(registry, pack.packId))))
  return { operation: 'list', status: 'succeeded', persisted: false, packs: summaries, nextAction: 'none', message: 'Expert ZIP packs listed.' }
}

async function executeInspect(packId: string, registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringResult> {
  const pack = await findPack(registry, packId)
  if (!pack) {
    return { operation: 'inspect', status: 'rejected', persisted: false, validation: { valid: false, issues: [issue('$.packId', 'EXPERT_PACK_NOT_FOUND', 'Expert ZIP pack was not found.')] }, nextAction: 'inspect-and-retry', message: 'Expert ZIP pack was not found.' }
  }
  const exported = await registry.exportExpertPackZip(packId)
  const bytes = new Uint8Array(Buffer.from(exported.dataBase64, 'base64'))
  const zip = await adapter.read(bytes)
  const manifest = await zip.readJson<Record<string, unknown>>('manifest.json')
  const entrypoints = isRecord(manifest.entrypoints) ? manifest.entrypoints : {}
  const expertPaths = Array.isArray(entrypoints.experts) ? entrypoints.experts.filter((entry): entry is string => typeof entry === 'string') : []
  const expertPath = expertPaths[0]
  if (!expertPath || !zip.has(expertPath)) throw new Error('Expert ZIP manifest does not declare a readable expert entrypoint.')
  const expert = await zip.readJson<Record<string, unknown>>(expertPath)
  const promptPaths = isRecord(expert.promptPaths) ? expert.promptPaths : {}
  const systemPath = typeof promptPaths.system === 'string' ? promptPaths.system : null
  const formPaths = Array.isArray(expert.formPaths) ? expert.formPaths.filter((entry): entry is string => typeof entry === 'string') : []
  const toolPaths = Array.isArray(entrypoints.tools) ? entrypoints.tools.filter((entry): entry is string => typeof entry === 'string') : []
  const tools = await Promise.all(toolPaths.filter((entry) => zip.has(entry)).map((entry) => zip.readJson(entry)))
  const draft: Record<string, unknown> = {
    packId: manifest.packId,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    ...(manifest.catalog ? { catalog: manifest.catalog } : {}),
    ...(manifest.minHostVersion ? { minHostVersion: manifest.minHostVersion } : {}),
    ...(manifest.hostTools ? { hostTools: manifest.hostTools } : {}),
    ...(manifest.permissions ? { permissions: manifest.permissions } : {}),
    ...(manifest.compatibility ? { compatibility: manifest.compatibility } : {}),
    ...(manifest.portability ? { portability: manifest.portability } : {}),
    expert: {
      id: expert.id,
      name: expert.name,
      ...(expert.description ? { description: expert.description } : {}),
      ...(expert.statusLabel ? { statusLabel: expert.statusLabel } : {}),
      ...(expert.profile ? { profile: expert.profile } : {}),
      ...(Array.isArray(expert.skillIds) ? { skillIds: expert.skillIds } : {}),
      systemPromptContent: systemPath && zip.has(systemPath) ? await zip.readText(systemPath) : '',
      ...(formPaths[0] && zip.has(formPaths[0]) ? { intakeFlow: await zip.readJson(formPaths[0]) } : {}),
      ...(typeof expert.outputProtocolPath === 'string' && zip.has(expert.outputProtocolPath) ? { outputProtocolContent: await zip.readText(expert.outputProtocolPath) } : {}),
    },
    ...(tools.length ? { tools } : {}),
  }
  const basisHash = basisHashFor(bytes)
  const summary = summarize(pack, basisHash)
  return { operation: 'inspect', status: 'succeeded', persisted: false, affectedPack: summary, beforeSummary: summary, draft, nextAction: 'none', message: 'Expert ZIP pack inspected.' }
}

async function executeValidate(pack: unknown, registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringResult> {
  try {
    const candidate = asCreateInput(pack)
    const issues = await validateCandidate(candidate, registry)
    return { operation: 'validate', status: issues.length ? 'rejected' : 'validated', persisted: false, validation: { valid: issues.length === 0, issues }, nextAction: issues.length ? 'repair-and-validate' : 'none', message: issues.length ? 'Expert ZIP pack candidate is invalid.' : 'Expert ZIP pack candidate is valid.' }
  } catch (error) {
    const errors = [issue('$.pack', 'EXPERT_PACK_INVALID', error instanceof Error ? error.message : String(error))]
    return { operation: 'validate', status: 'rejected', persisted: false, validation: { valid: false, issues: errors }, nextAction: 'repair-and-validate', message: 'Expert ZIP pack candidate is invalid.' }
  }
}

async function executeCreate(pack: unknown, registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringResult> {
  try {
    const candidate = asCreateInput(pack)
    const existing = await findPack(registry, candidate.packId)
    if (existing) {
      return { operation: 'create', status: 'rejected', persisted: false, affectedPack: summarize(existing, await getBasisHash(registry, existing.packId)), validation: { valid: false, issues: [issue('$.pack.packId', 'EXPERT_PACK_CONFLICT', 'An Expert ZIP pack with this packId already exists.')] }, nextAction: 'choose-unique-pack-id', message: 'Expert ZIP pack id already exists.' }
    }
    const issues = await validateCandidate(candidate, registry)
    if (issues.length) {
      return { operation: 'create', status: 'rejected', persisted: false, validation: { valid: false, issues }, nextAction: 'repair-and-validate', message: 'Expert ZIP pack candidate is invalid.' }
    }
    const created = await registry.createExpertPack(candidate)
    const after = await findPack(registry, created.pack.packId)
    if (!after) throw new Error('Expert ZIP pack was written but could not be reloaded.')
    const summary = summarize(after, await getBasisHash(registry, after.packId))
    return { operation: 'create', status: 'succeeded', persisted: true, affectedPack: summary, afterSummary: summary, validation: { valid: true, issues: [] }, nextAction: 'none', message: 'Expert ZIP pack created.' }
  } catch (error) {
    const errors = [issue('$.pack', 'EXPERT_PACK_INVALID', error instanceof Error ? error.message : String(error))]
    return { operation: 'create', status: 'rejected', persisted: false, validation: { valid: false, issues: errors }, nextAction: 'repair-and-validate', message: 'Expert ZIP pack candidate is invalid.' }
  }
}

async function executeUpdate(packId: string, basisHash: string, patch: unknown, registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringResult> {
  const before = await findPack(registry, packId)
  if (!before) return { operation: 'update', status: 'rejected', persisted: false, validation: { valid: false, issues: [issue('$.packId', 'EXPERT_PACK_NOT_FOUND', 'Expert ZIP pack was not found.')] }, nextAction: 'inspect-and-retry', message: 'Expert ZIP pack was not found.' }
  const currentHash = await getBasisHash(registry, packId)
  if (!basisHashPattern.test(basisHash) || basisHash !== currentHash) {
    return { operation: 'update', status: 'rejected', persisted: false, affectedPack: summarize(before, currentHash), validation: { valid: false, issues: [issue('$.basisHash', 'EXPERT_PACK_STALE', 'Expert ZIP pack changed. Inspect it again and retry with the current basisHash.')] }, nextAction: 'inspect-and-retry', message: 'Expert ZIP pack changed since it was inspected.' }
  }
  try {
    const updated = await registry.updateExpertPack(packId, asUpdateInput(patch))
    const afterHash = await getBasisHash(registry, packId)
    return { operation: 'update', status: 'succeeded', persisted: true, affectedPack: summarize(updated, afterHash), beforeSummary: summarize(before, currentHash), afterSummary: summarize(updated, afterHash), validation: { valid: true, issues: [] }, nextAction: 'none', message: 'Expert ZIP pack updated.' }
  } catch (error) {
    const errors = [issue('$.patch', 'EXPERT_PACK_INVALID', error instanceof Error ? error.message : String(error))]
    return { operation: 'update', status: 'rejected', persisted: false, validation: { valid: false, issues: errors }, nextAction: 'repair-and-validate', message: 'Expert ZIP pack update is invalid.' }
  }
}

async function executeDuplicate(packId: string, registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringResult> {
  const before = await findPack(registry, packId)
  if (!before) return { operation: 'duplicate', status: 'rejected', persisted: false, validation: { valid: false, issues: [issue('$.packId', 'EXPERT_PACK_NOT_FOUND', 'Expert ZIP pack was not found.')] }, nextAction: 'inspect-and-retry', message: 'Expert ZIP pack was not found.' }
  const copied = await registry.copyExpertPack(packId)
  const after = await findPack(registry, copied.pack.packId)
  if (!after) throw new Error('Copied Expert ZIP pack could not be reloaded.')
  const beforeHash = await getBasisHash(registry, before.packId)
  const afterHash = await getBasisHash(registry, after.packId)
  return { operation: 'duplicate', status: 'succeeded', persisted: true, affectedPack: summarize(after, afterHash), beforeSummary: summarize(before, beforeHash), afterSummary: summarize(after, afterHash), validation: { valid: true, issues: [] }, nextAction: 'none', message: 'Expert ZIP pack duplicated.' }
}

async function executeDelete(packId: string, basisHash: string, registry: ExpertPackRegistryService): Promise<ExpertPackAuthoringResult> {
  const before = await findPack(registry, packId)
  if (!before) return { operation: 'delete', status: 'rejected', persisted: false, validation: { valid: false, issues: [issue('$.packId', 'EXPERT_PACK_NOT_FOUND', 'Expert ZIP pack was not found.')] }, nextAction: 'inspect-and-retry', message: 'Expert ZIP pack was not found.' }
  const currentHash = await getBasisHash(registry, packId)
  if (!basisHashPattern.test(basisHash) || basisHash !== currentHash) {
    return { operation: 'delete', status: 'rejected', persisted: false, affectedPack: summarize(before, currentHash), validation: { valid: false, issues: [issue('$.basisHash', 'EXPERT_PACK_STALE', 'Expert ZIP pack changed. Inspect it again and retry with the current basisHash.')] }, nextAction: 'inspect-and-retry', message: 'Expert ZIP pack changed since it was inspected.' }
  }
  await registry.deleteExpertPack(packId)
  return { operation: 'delete', status: 'succeeded', persisted: true, affectedPack: summarize(before, currentHash), beforeSummary: summarize(before, currentHash), validation: { valid: true, issues: [] }, nextAction: 'none', message: 'Expert ZIP pack deleted.' }
}

export async function executeExpertPackAuthoringOperation(
  input: ExpertPackAuthoringOperationInput,
  context: ExpertPackAuthoringServiceContext = {},
): Promise<ExpertPackAuthoringResult> {
  const registry = context.registry ?? new ExpertPackRegistryService()
  try {
    switch (input.operation) {
      case 'guide': return executeGuide(input.topic)
      case 'list': return executeList(registry)
      case 'inspect': return executeInspect(input.packId, registry)
      case 'validate': return executeValidate(input.pack, registry)
      case 'create': return executeCreate(input.pack, registry)
      case 'update': return executeUpdate(input.packId, input.basisHash, input.patch, registry)
      case 'duplicate': return executeDuplicate(input.packId, registry)
      case 'delete': return executeDelete(input.packId, input.basisHash, registry)
    }
  } catch (error) {
    return { operation: input.operation, status: 'failed', persisted: false, validation: { valid: false, issues: [issue('$', 'EXPERT_PACK_AUTHORING_FAILED', error instanceof Error ? error.message : String(error))] }, nextAction: 'repair-and-validate', message: 'Expert ZIP pack authoring operation failed.' }
  }
}

export class ExpertPackAuthoringService {
  constructor(private readonly registry = new ExpertPackRegistryService()) {}

  execute(input: ExpertPackAuthoringOperationInput): Promise<ExpertPackAuthoringResult> {
    return executeExpertPackAuthoringOperation(input, { registry: this.registry })
  }
}
