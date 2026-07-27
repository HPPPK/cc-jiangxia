import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
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
    },
  ): string[]
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
