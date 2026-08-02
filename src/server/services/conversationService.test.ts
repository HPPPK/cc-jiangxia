import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getBrowserResearchExecutablePathFromRuntimeDir } from '../../tools/BrowserResearchTool/runtime.js'
import {
  ConversationService,
  removeSessionRuntimePromptFile,
  writeSessionRuntimePromptFile,
} from './conversationService.js'

type CliArgBuilder = {
  buildSessionCliArgs(
    sessionId: string,
    sdkUrl: string,
    shouldResume: boolean,
    options?: {
      disallowedTools?: string[]
      expertSystemPrompt?: string
      appendSystemPromptFile?: string
      expertRuntimeActive?: boolean
    },
  ): string[]
}

type ChildEnvBuilder = {
  buildChildEnv(
    workDir: string,
    sdkUrl?: string,
    options?: {
      expertSystemPrompt?: string
      expertSessionId?: string
      appendSystemPromptFile?: string
      expertRuntimeActive?: boolean
    },
  ): Promise<Record<string, string>>
}

describe('ConversationService expert tool policy', () => {
  test('passes a de-duplicated expert deny list to the spawned CLI', () => {
    const service = new ConversationService() as unknown as CliArgBuilder

    const args = service.buildSessionCliArgs('expert-session', 'ws://127.0.0.1:57420', false, {
      disallowedTools: ['WebFetch', 'WebSearch', 'Bash', 'WebFetch'],
    })

    expect(args).toContain('--disallowed-tools')
    expect(args[args.indexOf('--disallowed-tools') + 1]).toBe('WebFetch,WebSearch,Bash')
  })

  test('passes a full expert runtime through a short hidden prompt-file argument', () => {
    const service = new ConversationService() as unknown as CliArgBuilder
    const expertSystemPrompt = `<expert-runtime>${'template body\n'.repeat(10_000)}</expert-runtime>`
    const promptFile = 'C:\\Temp\\cc-jiangxia-runtime-prompts\\expert-session.md'

    const args = service.buildSessionCliArgs('expert-session', 'ws://127.0.0.1:57420', false, {
      appendSystemPromptFile: promptFile,
    })

    expect(args).toContain('--append-system-prompt-file')
    expect(args[args.indexOf('--append-system-prompt-file') + 1]).toBe(promptFile)
    expect(args).not.toContain('--append-system-prompt')
    expect(args).not.toContain(expertSystemPrompt)
  })

  test('keeps the visual-QA renderer environment when an Expert prompt is moved to a hidden file', async () => {
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-browser-runtime-'))
    const chromiumDir = path.join(runtimeDir, 'chromium_headless_shell-test', 'chrome-headless-shell-win64')
    const executable = path.join(chromiumDir, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
    const configDir = path.join(runtimeDir, 'empty-config')
    const previousRuntimeDir = process.env.CLAUDE_BROWSER_RUNTIME_DIR
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR

    try {
      await fs.mkdir(chromiumDir, { recursive: true })
      await fs.mkdir(configDir, { recursive: true })
      await fs.writeFile(executable, '')
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.CLAUDE_BROWSER_RUNTIME_DIR = runtimeDir

      const service = new ConversationService() as unknown as ChildEnvBuilder
      const childEnv = await service.buildChildEnv(process.cwd(), 'ws://127.0.0.1:57420/sdk/test', {
        // This is the launchOptions shape after startSession moved the full
        // prompt to appendSystemPromptFile. The marker must retain the Expert
        // classification for local visual QA.
        appendSystemPromptFile: path.join(runtimeDir, 'expert-runtime.md'),
        expertRuntimeActive: true,
      })

      const expectedExecutable = getBrowserResearchExecutablePathFromRuntimeDir(runtimeDir)
      expect(expectedExecutable).toBe(executable)
      expect(childEnv.CC_JIANGXIA_VISUAL_QA_BROWSER_EXECUTABLE).toBe(expectedExecutable)
    } finally {
      if (previousRuntimeDir === undefined) delete process.env.CLAUDE_BROWSER_RUNTIME_DIR
      else process.env.CLAUDE_BROWSER_RUNTIME_DIR = previousRuntimeDir
      if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
      await fs.rm(runtimeDir, { recursive: true, force: true })
    }
  })
  test('pins Desktop-managed providers to the local proxy instead of stale alternate cloud routing', async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-provider-env-'))
    const managedRouteKeys = [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'CLAUDE_CODE_USE_AZURE_OPENAI',
      'ANTHROPIC_FOUNDRY_RESOURCE',
      'AZURE_OPENAI_BASE_URL',
    ] as const
    const previousEnv = new Map(managedRouteKeys.map((key) => [key, process.env[key]]))
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR

    try {
      process.env.CLAUDE_CONFIG_DIR = configDir
      for (const key of managedRouteKeys) process.env[key] = 'stale-provider-routing'

      const service = new ConversationService() as unknown as ChildEnvBuilder & {
        providerService: { getProviderRuntimeEnv(providerId: string): Promise<Record<string, string>> }
      }
      service.providerService = {
        async getProviderRuntimeEnv(providerId) {
          expect(providerId).toBe('desktop-provider')
          return {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:45678/proxy/providers/desktop-provider',
            ANTHROPIC_API_KEY: 'proxy-managed',
            ANTHROPIC_MODEL: 'saved-model',
          }
        },
      }

      const childEnv = await service.buildChildEnv(process.cwd(), 'ws://127.0.0.1:45678/sdk/test', {
        providerId: 'desktop-provider',
        model: 'selected-model',
      })

      expect(childEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:45678/proxy/providers/desktop-provider')
      expect(childEnv.ANTHROPIC_API_KEY).toBe('proxy-managed')
      expect(childEnv.ANTHROPIC_MODEL).toBe('selected-model')
      expect(childEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
      expect(childEnv.CLAUDE_CODE_USE_BEDROCK).toBe('0')
      expect(childEnv.CLAUDE_CODE_USE_VERTEX).toBe('0')
      expect(childEnv.CLAUDE_CODE_USE_FOUNDRY).toBe('0')
      expect(childEnv.CLAUDE_CODE_USE_AZURE_OPENAI).toBe('0')
      expect(childEnv.ANTHROPIC_FOUNDRY_RESOURCE).toBeUndefined()
      expect(childEnv.AZURE_OPENAI_BASE_URL).toBeUndefined()
    } finally {
      if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
      for (const key of managedRouteKeys) {
        const value = previousEnv.get(key)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await fs.rm(configDir, { recursive: true, force: true })
    }
  })

  test('writes and removes a session-scoped hidden runtime prompt file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-runtime-prompt-test-'))
    const content = '<expert-runtime>full template and skills</expert-runtime>'

    try {
      const promptFile = await writeSessionRuntimePromptFile('expert-session', content, directory)
      expect(promptFile.startsWith(directory)).toBe(true)
      expect(await fs.readFile(promptFile, 'utf8')).toBe(content)

      await removeSessionRuntimePromptFile(promptFile)
      await expect(fs.access(promptFile)).rejects.toThrow()
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
