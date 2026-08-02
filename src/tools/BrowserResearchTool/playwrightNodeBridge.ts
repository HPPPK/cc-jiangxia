import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserResearchSearchEngine } from './searchEngines.js'

export const BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_FILE = 'browser-research-playwright-runner.cjs'
export const BROWSER_RESEARCH_NODE_RUNNER_PATH_ENV = 'CLAUDE_BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_PATH'

// Keep the executable arguments free of a Windows absolute runner path. The
// bundled Bun executable can otherwise pass that path to Node incorrectly on
// Windows (Node receives only "C:" as its main script). Node receives this
// small static program and resolves the trusted runner path from its own env.
export const BROWSER_RESEARCH_NODE_BOOTSTRAP = [
  'const runnerPath = process.env.CLAUDE_BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_PATH',
  "if (!runnerPath) throw new Error('Missing CLAUDE_BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_PATH')",
  'require(runnerPath)',
].join(';')

type BrowserResearchTarget =
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string; searchEngine: BrowserResearchSearchEngine; market?: string; locale?: string }

type BrowserResearchRunnerRequest = {
  executablePath: string
  target: BrowserResearchTarget
  locale?: string
  screenshotPath?: string
  pageTimeoutMs: number
  networkIdleTimeoutMs: number
  maxLinks: number
}

type BrowserResearchRunnerResponse = {
  ok: boolean
  result?: {
    url: string
    title: string
    text: string
    links: Array<{ text: string; url: string }>
    screenshotPath?: string
  }
  error?: string
}

export type BrowserResearchNodeBridge = {
  nodeExecutable: string
  runnerPath: string
}

export type BrowserResearchNodeBridgeInvocation = {
  command: string[]
  env: NodeJS.ProcessEnv
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

export function resolveBrowserResearchNodeBridge(
  env: NodeJS.ProcessEnv = process.env,
): BrowserResearchNodeBridge | null {
  const nodeExecutable = env.CLAUDE_BUNDLED_NODE_EXECUTABLE
  const runtimeDir = env.CLAUDE_BROWSER_RUNTIME_DIR
  if (!nodeExecutable || !runtimeDir) return null

  const runnerPath = join(runtimeDir, BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_FILE)
  if (!isFile(nodeExecutable) || !isFile(runnerPath)) return null
  return { nodeExecutable, runnerPath }
}

export function isBrowserResearchNodeBridgeAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveBrowserResearchNodeBridge(env) !== null
}


export function normalizeBrowserResearchNodeRunnerPath(runnerPath: string): string {
  // Node 22 cannot resolve the Windows extended-length namespace in require().
  // Tauri supplies resource paths in that form (\\?\C:\...), so convert only
  // the namespace syntax before handing this trusted absolute file path to Node.
  if (runnerPath.startsWith('\\\\?\\UNC\\')) return '\\\\' + runnerPath.slice('\\\\?\\UNC\\'.length)
  if (/^\\\\\?\\[A-Za-z]:\\/.test(runnerPath)) return runnerPath.slice(4)
  return runnerPath
}

export function createBrowserResearchNodeBridgeInvocation(
  bridge: BrowserResearchNodeBridge,
  env: NodeJS.ProcessEnv = process.env,
): BrowserResearchNodeBridgeInvocation {
  return {
    command: [bridge.nodeExecutable, '--eval', BROWSER_RESEARCH_NODE_BOOTSTRAP],
    env: {
      ...env,
      [BROWSER_RESEARCH_NODE_RUNNER_PATH_ENV]: normalizeBrowserResearchNodeRunnerPath(bridge.runnerPath),
    },
  }
}

export async function runBrowserResearchWithNodeBridge(
  request: BrowserResearchRunnerRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NonNullable<BrowserResearchRunnerResponse['result']>> {
  const bridge = resolveBrowserResearchNodeBridge(env)
  if (!bridge) {
    throw new Error('The managed Node Playwright bridge is unavailable. Rebuild the desktop sidecars so the bundled Node runtime and browser research runner are present.')
  }

  const invocation = createBrowserResearchNodeBridgeInvocation(bridge, env)
  const proc = Bun.spawn(invocation.command, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: invocation.env,
  })
  proc.stdin.write(JSON.stringify(request))
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const trimmedStdout = stdout.trim()
  if (exitCode !== 0) {
    throw new Error('The managed Node Playwright bridge exited with code ' + exitCode + ': ' + (stderr || trimmedStdout || 'no diagnostic output').trim().slice(0, 1_000))
  }

  let response: BrowserResearchRunnerResponse
  try {
    response = JSON.parse(trimmedStdout) as BrowserResearchRunnerResponse
  } catch {
    throw new Error('The managed Node Playwright bridge returned invalid JSON: ' + (trimmedStdout || stderr || 'no output').slice(0, 1_000))
  }
  if (!response.ok || !response.result) {
    throw new Error(response.error || 'The managed Node Playwright bridge did not return a research result.')
  }
  return response.result
}
