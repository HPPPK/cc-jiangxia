import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getBrowserResearchRuntimeDir,
  getUnsafeBrowserResearchUrlReason,
  isBrowserResearchRuntimeInstalled,
  seedBundledBrowserResearchRuntime,
  summarizeBrowserResearchText,
} from './runtime.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('BrowserResearch runtime guardrails', () => {
  test('allows public http(s) URLs and rejects local or credential-bearing targets', () => {
    expect(getUnsafeBrowserResearchUrlReason('https://www.example.com/products')).toBeNull()
    expect(getUnsafeBrowserResearchUrlReason('http://127.0.0.1:3456/admin')).toContain('Private IPv4')
    expect(getUnsafeBrowserResearchUrlReason('http://localhost:3000')).toContain('Localhost')
    expect(getUnsafeBrowserResearchUrlReason('https://user:secret@example.com')).toContain('credentials')
    expect(getUnsafeBrowserResearchUrlReason('file:///C:/Users/example.txt')).toContain('http(s)')
  })

  test('detects only the managed browser runtime, not merely its parent directory', async () => {
    const configDir = await mkdtemp('browser-research-runtime-')
    const runtimeDir = getBrowserResearchRuntimeDir(configDir)
    await mkdir(runtimeDir, { recursive: true })
    expect(isBrowserResearchRuntimeInstalled(configDir)).toBe(false)
    await mkdir(join(runtimeDir, 'chromium_headless_shell-1', 'chrome-win'), { recursive: true })
    await writeFile(join(runtimeDir, 'chromium_headless_shell-1', 'chrome-win', 'headless_shell.exe'), '')
    expect(isBrowserResearchRuntimeInstalled(configDir)).toBe(true)
  })

  test('seeds the bundled managed Chromium runtime for a clean user and preserves an existing local runtime', async () => {
    const configDir = await mkdtemp('browser-research-runtime-config-')
    const bundledRuntimeDir = await mkdtemp('browser-research-runtime-bundled-')
    const bundledExecutable = join(bundledRuntimeDir, 'chromium_headless_shell-1', 'chrome-win', 'headless_shell.exe')
    await mkdir(join(bundledRuntimeDir, 'chromium_headless_shell-1', 'chrome-win'), { recursive: true })
    await writeFile(bundledExecutable, 'bundled runtime')

    expect(await seedBundledBrowserResearchRuntime(configDir, bundledRuntimeDir)).toBe(true)
    const localExecutable = join(getBrowserResearchRuntimeDir(configDir), 'chromium_headless_shell-1', 'chrome-win', 'headless_shell.exe')
    expect(isBrowserResearchRuntimeInstalled(configDir)).toBe(true)
    expect(await readFile(localExecutable, 'utf8')).toBe('bundled runtime')

    await writeFile(localExecutable, 'user managed runtime')
    await writeFile(bundledExecutable, 'new bundled runtime')
    expect(await seedBundledBrowserResearchRuntime(configDir, bundledRuntimeDir)).toBe(false)
    expect(await readFile(localExecutable, 'utf8')).toBe('user managed runtime')
  })

  test('bounds rendered text without losing its truncation signal', () => {
    expect(summarizeBrowserResearchText(' short ')).toEqual({ text: 'short', truncated: false })
    const result = summarizeBrowserResearchText('x'.repeat(100), 40)
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('truncated by BrowserResearch')
  })
})

async function mkdtemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}
