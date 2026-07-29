import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { EXPERT_TEMPLATE_FILL_FORMAT, type ExpertTemplateFillPayload } from '../utils/expertTemplateFill.js'

type RecordValue = Record<string, unknown>

export type ExpertTemplateFillCliOptions = {
  dataPath: string
  outputPath: string
  serverUrl?: string
  sessionId?: string
}

export type ExpertTemplateFillCliResult = {
  outputPath: string
  templateId: string
  bytes: number
}

export type ExpertTemplateFillCliDependencies = {
  env: Record<string, string | undefined>
  readFile: typeof fs.readFile
  mkdir: typeof fs.mkdir
  writeFile: typeof fs.writeFile
  fetch: typeof fetch
}

const usage = 'Usage: cc-jiangxia expert-template-fill --data <report-fields.json> --output <final-report.html> [--server-url <url>] [--session-id <id>]'

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value. ${usage}`)
  return value
}

export function parseExpertTemplateFillCliArgs(args: string[]): ExpertTemplateFillCliOptions {
  const options: Partial<ExpertTemplateFillCliOptions> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') throw new Error(usage)
    if (arg === '--data') {
      if (options.dataPath) throw new Error(`--data may only be provided once. ${usage}`)
      options.dataPath = optionValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--output') {
      if (options.outputPath) throw new Error(`--output may only be provided once. ${usage}`)
      options.outputPath = optionValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--server-url') {
      if (options.serverUrl) throw new Error(`--server-url may only be provided once. ${usage}`)
      options.serverUrl = optionValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--session-id') {
      if (options.sessionId) throw new Error(`--session-id may only be provided once. ${usage}`)
      options.sessionId = optionValue(args, index, arg)
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}. ${usage}`)
  }
  if (!options.dataPath || !options.outputPath) throw new Error(`Both --data and --output are required. ${usage}`)
  if (!/\.html?$/i.test(options.outputPath)) throw new Error('--output must be an .html or .htm file.')
  return options as ExpertTemplateFillCliOptions
}

function parseFieldsDocument(content: string): ExpertTemplateFillPayload {
  let document: unknown
  try {
    document = JSON.parse(content)
  } catch (error) {
    throw new Error(`Could not parse --data JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(document)) throw new Error('--data must be a JSON object with templateId and fields.')
  if (document.format !== undefined && document.format !== EXPERT_TEMPLATE_FILL_FORMAT) {
    throw new Error(`Unsupported template-fill format: ${String(document.format)}.`)
  }
  if (typeof document.templateId !== 'string' || !document.templateId.trim()) {
    throw new Error('--data.templateId must be a non-empty string.')
  }
  if (!isRecord(document.fields)) throw new Error('--data.fields must be an object keyed by template field ID.')
  return {
    format: EXPERT_TEMPLATE_FILL_FORMAT,
    templateId: document.templateId.trim(),
    fields: document.fields,
  }
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown; error?: unknown }
    if (typeof body.message === 'string' && body.message.trim()) return body.message
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Use the HTTP status below when the server has no JSON error body.
  }
  return `Template renderer returned HTTP ${response.status}.`
}

function resolveServerUrl(value: string | undefined): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error('Missing Desktop Expert renderer URL. Run this command from the active Expert session, or pass --server-url.')
  try {
    return new URL(normalized).toString().replace(/\/$/, '')
  } catch {
    throw new Error(`Invalid --server-url: ${normalized}`)
  }
}

export async function runExpertTemplateFillCli(
  options: ExpertTemplateFillCliOptions,
  dependencies: ExpertTemplateFillCliDependencies = {
    env: process.env,
    readFile: fs.readFile,
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
    fetch: globalThis.fetch,
  },
): Promise<ExpertTemplateFillCliResult> {
  const fieldsDocument = await dependencies.readFile(options.dataPath, 'utf8')
  const payload = parseFieldsDocument(fieldsDocument)
  const serverUrl = resolveServerUrl(options.serverUrl ?? dependencies.env.CC_JIANGXIA_DESKTOP_SERVER_URL ?? dependencies.env.DESKTOP_SERVER_URL)
  const sessionId = (options.sessionId ?? dependencies.env.CC_JIANGXIA_EXPERT_SESSION_ID ?? dependencies.env.EXPERT_SESSION_ID)?.trim()
  if (!sessionId) throw new Error('Missing Expert session ID. Run this command from the active Expert session, or pass --session-id.')

  let response: Response
  try {
    response = await dependencies.fetch(`${serverUrl}/api/sessions/${encodeURIComponent(sessionId)}/expert/template-fill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    })
  } catch (error) {
    throw new Error(`Could not reach the Desktop Expert template renderer: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(await responseMessage(response))

  const body = await response.json() as { content?: unknown; templateId?: unknown }
  if (typeof body.content !== 'string' || !body.content.trim() || typeof body.templateId !== 'string' || !body.templateId.trim()) {
    throw new Error('The Desktop Expert template renderer returned an invalid result.')
  }

  const outputPath = path.resolve(options.outputPath)
  await dependencies.mkdir(path.dirname(outputPath), { recursive: true })
  await dependencies.writeFile(outputPath, body.content, 'utf8')
  return { outputPath, templateId: body.templateId, bytes: Buffer.byteLength(body.content, 'utf8') }
}

export async function expertTemplateFillMain(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(usage)
    return
  }
  try {
    const result = await runExpertTemplateFillCli(parseExpertTemplateFillCliArgs(args))
    console.log(JSON.stringify({ ok: true, ...result }))
  } catch (error) {
    console.error(`expert-template-fill: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
