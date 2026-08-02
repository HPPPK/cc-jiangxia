import { describe, expect, test } from 'bun:test'
import {
  BROWSER_RESEARCH_NODE_BOOTSTRAP,
  BROWSER_RESEARCH_NODE_RUNNER_PATH_ENV,
  createBrowserResearchNodeBridgeInvocation,
  normalizeBrowserResearchNodeRunnerPath,
} from './playwrightNodeBridge.js'

describe('BrowserResearch Node Playwright bridge invocation', () => {
  test('passes the managed runner path through Node environment instead of Windows argv', () => {
    const runnerPath = 'C:\\Program Files\\Claude Code Jiangxia\\binaries\\browser-runtime\\playwright\\browser-research-playwright-runner.cjs'
    const invocation = createBrowserResearchNodeBridgeInvocation(
      {
        nodeExecutable: 'C:\\Program Files\\Claude Code Jiangxia\\binaries\\node-runtime\\node.exe',
        runnerPath,
      },
      { PATH: 'C:\\Windows\\System32', EXISTING_VALUE: 'kept' },
    )

    expect(invocation.command).toEqual([
      'C:\\Program Files\\Claude Code Jiangxia\\binaries\\node-runtime\\node.exe',
      '--eval',
      BROWSER_RESEARCH_NODE_BOOTSTRAP,
    ])
    expect(invocation.command).not.toContain(runnerPath)
    expect(invocation.env).toMatchObject({
      PATH: 'C:\\Windows\\System32',
      EXISTING_VALUE: 'kept',
      [BROWSER_RESEARCH_NODE_RUNNER_PATH_ENV]: runnerPath,
    })
  })

  test('removes the Windows long-path prefix before Node resolves the runner', () => {
    expect(normalizeBrowserResearchNodeRunnerPath('\\\\?\\C:\\Users\\潘婧瑜\\Desktop\\cc-jiangxia\\browser-research-playwright-runner.cjs')).toBe(
      'C:\\Users\\潘婧瑜\\Desktop\\cc-jiangxia\\browser-research-playwright-runner.cjs',
    )
    expect(normalizeBrowserResearchNodeRunnerPath('C:\\Users\\潘婧瑜\\Desktop\\cc-jiangxia\\browser-research-playwright-runner.cjs')).toBe(
      'C:\\Users\\潘婧瑜\\Desktop\\cc-jiangxia\\browser-research-playwright-runner.cjs',
    )
  })

  test('passes a Node-compatible runner path when Tauri supplies an extended Windows path', () => {
    const invocation = createBrowserResearchNodeBridgeInvocation(
      {
        nodeExecutable: 'C:\\Program Files\\Claude Code Jiangxia\\binaries\\node-runtime\\node.exe',
        runnerPath: '\\\\?\\C:\\Users\\潘婧瑜\\Desktop\\cc-jiangxia\\browser-research-playwright-runner.cjs',
      },
      {},
    )

    expect(invocation.env[BROWSER_RESEARCH_NODE_RUNNER_PATH_ENV]).toBe(
      'C:\\Users\\潘婧瑜\\Desktop\\cc-jiangxia\\browser-research-playwright-runner.cjs',
    )
  })

  test('uses a static Node bootstrap that loads the trusted runner from environment', () => {
    expect(BROWSER_RESEARCH_NODE_BOOTSTRAP).toContain(
      'process.env.CLAUDE_BROWSER_RESEARCH_PLAYWRIGHT_RUNNER_PATH',
    )
    expect(BROWSER_RESEARCH_NODE_BOOTSTRAP).toContain('require(runnerPath)')
    expect(BROWSER_RESEARCH_NODE_BOOTSTRAP).not.toContain('browser-research-playwright-runner.cjs')
  })
})
