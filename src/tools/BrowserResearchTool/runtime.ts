import { existsSync, readdirSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'

const BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_FILE = 'browser-research-playwright-runner.cjs'
import { getAppStoragePath } from '../../utils/appIdentity.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const BROWSER_RUNTIME_SEGMENTS = ['browser-runtime', 'playwright'] as const
const PRIVATE_IPV4_PREFIXES = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
]

export function getBrowserResearchRuntimeDir(configDir = getClaudeConfigHomeDir()): string {
  return getAppStoragePath(configDir, ...BROWSER_RUNTIME_SEGMENTS)
}

export function getBrowserResearchScreenshotDir(configDir = getClaudeConfigHomeDir()): string {
  return join(getBrowserResearchRuntimeDir(configDir), 'screenshots')
}

export async function ensureBrowserResearchRuntimeDir(): Promise<string> {
  const runtimeDir = getBrowserResearchRuntimeDir()
  await mkdir(runtimeDir, { recursive: true })
  return runtimeDir
}

export async function seedBundledBrowserResearchRuntime(
  configDir = getClaudeConfigHomeDir(),
  bundledRuntimeDir = process.env.CLAUDE_BROWSER_RUNTIME_DIR,
): Promise<boolean> {
  const runtimeDir = getBrowserResearchRuntimeDir(configDir)
  const localExecutable = getBrowserResearchExecutablePathFromRuntimeDir(runtimeDir)
  const localRunnerPath = join(runtimeDir, BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_FILE)
  if (localExecutable && existsSync(localRunnerPath)) return false

  const bundledExecutable = bundledRuntimeDir
    ? getBrowserResearchExecutablePathFromRuntimeDir(bundledRuntimeDir)
    : null
  const bundledRunnerPath = bundledRuntimeDir
    ? join(bundledRuntimeDir, BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_FILE)
    : null
  if (!bundledRuntimeDir || !bundledExecutable || !bundledRunnerPath || !existsSync(bundledRunnerPath)) return false

  await mkdir(runtimeDir, { recursive: true })
  if (localExecutable) {
    // Preserve an already-downloaded local Chromium while backfilling a
    // runner introduced by a newer desktop sidecar build.
    await cp(bundledRunnerPath, localRunnerPath, { force: true })
  } else {
    await cp(bundledRuntimeDir, runtimeDir, { recursive: true, force: true })
  }

  return getBrowserResearchExecutablePathFromRuntimeDir(runtimeDir) !== null
    && existsSync(localRunnerPath)
}

function isPrivateIpv4(hostname: string): boolean {
  if (PRIVATE_IPV4_PREFIXES.some((pattern) => pattern.test(hostname))) return true
  const octets = hostname.split('.').map(Number)
  return octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
}

export function getUnsafeBrowserResearchUrlReason(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'The URL could not be parsed.'
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Only public http(s) URLs are supported.'
  }
  if (parsed.username || parsed.password) {
    return 'URLs containing credentials are not supported.'
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'Localhost URLs are not supported.'
  }
  if (isIP(hostname) === 4 && isPrivateIpv4(hostname)) {
    return 'Private IPv4 addresses are not supported.'
  }
  if (isIP(hostname) === 6 && isPrivateIpv6(hostname)) {
    return 'Private IPv6 addresses are not supported.'
  }

  return null
}

export function getBrowserResearchExecutablePathFromRuntimeDir(runtimeDir: string): string | null {
  if (!existsSync(runtimeDir)) return null

  try {
    const entries = readdirSync(runtimeDir, { recursive: true })
    const executable = entries.find((entry) => /(?:headless_shell|chrome-headless-shell)(?:\.exe)?$/i.test(entry.replaceAll('\\', '/')))
      ?? entries.find((entry) => /chrome(?:\.exe)?$/i.test(entry.replaceAll('\\', '/')))
    return executable ? join(runtimeDir, executable) : null
  } catch {
    return null
  }
}

export function getBrowserResearchExecutablePath(configDir = getClaudeConfigHomeDir()): string | null {
  return getBrowserResearchExecutablePathFromRuntimeDir(getBrowserResearchRuntimeDir(configDir))
}

export function isBrowserResearchRuntimeInstalled(configDir = getClaudeConfigHomeDir()): boolean {
  return getBrowserResearchExecutablePath(configDir) !== null
}

export function resolveBrowserResearchExecutablePath(
  configDir = getClaudeConfigHomeDir(),
  bundledRuntimeDir = process.env.CLAUDE_BROWSER_RUNTIME_DIR,
): string | null {
  return getBrowserResearchExecutablePath(configDir)
    ?? (bundledRuntimeDir ? getBrowserResearchExecutablePathFromRuntimeDir(bundledRuntimeDir) : null)
}

export function isBrowserResearchRuntimeAvailable(
  configDir = getClaudeConfigHomeDir(),
  bundledRuntimeDir = process.env.CLAUDE_BROWSER_RUNTIME_DIR,
): boolean {
  return resolveBrowserResearchExecutablePath(configDir, bundledRuntimeDir) !== null
}

export function summarizeBrowserResearchText(text: string, maxChars = 24_000): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (normalized.length <= maxChars) return { text: normalized, truncated: false }
  return {
    text: `${normalized.slice(0, Math.max(0, maxChars - 64)).trimEnd()}\n\n[Rendered page text truncated by BrowserResearch]`,
    truncated: true,
  }
}
