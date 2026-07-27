import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getBrowserResearchRuntimeDir,
  getUnsafeBrowserResearchUrlReason,
  isBrowserResearchRuntimeInstalled,
  summarizeBrowserResearchText,
} from './runtime.js'

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
  return mkdtemp(join(tmpdir(), prefix))
}
