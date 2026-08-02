import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  executeExpertPackAuthoringOperation,
} from './expertPackAuthoringService.js'
import {
  ExpertPackRegistryService,
  getExpertPackStorageDir,
  resetExpertPackRegistryForTests,
} from './expertPackRegistryService.js'
import { ZipPackAdapter } from './zipPackAdapter.js'

const adapter = new ZipPackAdapter()
let configDir = ''
let originalConfigDir: string | undefined

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packId: 'ai-authored-expert',
    name: 'AI Authored Expert',
    version: '1.0.0',
    description: 'An isolated Expert ZIP authoring test package.',
    expert: {
      id: 'ai-authored-expert',
      name: 'AI Authored Expert',
      description: 'Turns a request into a structured answer.',
      systemPromptContent: 'You are a focused Expert. Produce a structured answer and state your evidence limits.',
    },
    ...overrides,
  }
}

function workflowPackDir(): string {
  return path.join(configDir, 'cc-jiangxia', 'workflows', 'packs')
}

beforeEach(async () => {
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-expert-authoring-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  resetExpertPackRegistryForTests()
})

afterEach(async () => {
  resetExpertPackRegistryForTests()
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('Expert ZIP pack authoring service', () => {
  test('guide keeps generic Expert authoring detached from the current workspace until explicit use', async () => {
    const result = await executeExpertPackAuthoringOperation({ operation: 'guide' })

    expect(result).toMatchObject({ operation: 'guide', status: 'succeeded', persisted: false })
    expect(result.guide?.boundaries).toEqual(expect.arrayContaining([
      'When creating a general-purpose Expert, derive the ZIP only from the user-stated requirements.',
      'Do not inspect the current workspace, project directories, attachments, or unrelated files merely to author a general-purpose Expert.',
      'Do not automatically run a newly created Expert or analyze a directory; do so only after the user explicitly asks to use it on a specified directory.',
    ]))
    await expect(fs.stat(getExpertPackStorageDir())).rejects.toThrow()
    await expect(fs.stat(workflowPackDir())).rejects.toThrow()
  })

  test('validates an Expert ZIP candidate without writing Expert or workflow ZIP storage', async () => {
    const result = await executeExpertPackAuthoringOperation({
      operation: 'validate',
      pack: candidate(),
    })

    expect(result).toMatchObject({
      operation: 'validate',
      status: 'validated',
      persisted: false,
      validation: { valid: true, issues: [] },
    })
    await expect(fs.stat(getExpertPackStorageDir())).rejects.toThrow()
    await expect(fs.stat(workflowPackDir())).rejects.toThrow()
  })

  test('rejects an empty system prompt before writing an Expert or Workflow ZIP', async () => {
    const pack = candidate({
      expert: {
        id: 'ai-authored-expert',
        name: 'AI Authored Expert',
        systemPromptContent: '   ',
      },
    })

    const result = await executeExpertPackAuthoringOperation({ operation: 'create', pack })

    expect(result).toMatchObject({
      operation: 'create',
      status: 'rejected',
      persisted: false,
      message: 'Expert ZIP pack candidate is invalid.',
      validation: {
        valid: false,
        issues: [expect.objectContaining({
          code: 'EXPERT_PACK_INVALID',
          message: 'pack.expert.systemPromptContent is required.',
        })],
      },
    })
    await expect(fs.stat(getExpertPackStorageDir())).rejects.toThrow()
    await expect(fs.stat(workflowPackDir())).rejects.toThrow()
  })

  test('creates a standalone Expert ZIP, reloads it, and leaves workflow storage untouched', async () => {
    const result = await executeExpertPackAuthoringOperation({
      operation: 'create',
      pack: candidate(),
    })

    expect(result).toMatchObject({
      operation: 'create',
      status: 'succeeded',
      persisted: true,
      affectedPack: {
        packId: 'ai-authored-expert',
        expertIds: ['ai-authored-expert'],
        zipPath: path.join(getExpertPackStorageDir(), 'ai-authored-expert.zip'),
        basisHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    })

    const zipPath = path.join(getExpertPackStorageDir(), 'ai-authored-expert.zip')
    const zip = await adapter.read(new Uint8Array(await fs.readFile(zipPath)))
    expect(await zip.readJson('manifest.json')).toMatchObject({
      packId: 'ai-authored-expert',
      type: 'expert-pack',
      entrypoints: { experts: ['experts/ai-authored-expert/expert.json'] },
    })
    expect(await zip.readText('experts/ai-authored-expert/prompts/system.md')).toContain('focused Expert')
    await expect(fs.stat(workflowPackDir())).rejects.toThrow()

    resetExpertPackRegistryForTests()
    const persisted = await new ExpertPackRegistryService().listPacks()
    expect(persisted).toContainEqual(expect.objectContaining({
      packId: 'ai-authored-expert',
      storage: expect.objectContaining({ kind: 'zip', path: 'ai-authored-expert.zip' }),
    }))
  })

  test('inspects, updates with a fresh basis hash, and rejects stale deletion', async () => {
    await executeExpertPackAuthoringOperation({ operation: 'create', pack: candidate() })
    const inspected = await executeExpertPackAuthoringOperation({ operation: 'inspect', packId: 'ai-authored-expert' })
    const basisHash = inspected.affectedPack?.basisHash
    expect(basisHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(inspected.draft).toMatchObject({
      packId: 'ai-authored-expert',
      expert: { id: 'ai-authored-expert', systemPromptContent: expect.stringContaining('focused Expert') },
    })

    const updated = await executeExpertPackAuthoringOperation({
      operation: 'update',
      packId: 'ai-authored-expert',
      basisHash: basisHash!,
      patch: {
        name: 'AI Authored Expert Updated',
        version: '1.0.1',
        expert: {
          id: 'ai-authored-expert',
          name: 'AI Authored Expert Updated',
          systemPromptContent: 'You are an updated focused Expert.',
        },
      },
    })
    expect(updated).toMatchObject({
      operation: 'update',
      status: 'succeeded',
      persisted: true,
      affectedPack: { name: 'AI Authored Expert Updated', version: '1.0.1' },
    })

    const stale = await executeExpertPackAuthoringOperation({
      operation: 'delete',
      packId: 'ai-authored-expert',
      basisHash: basisHash!,
    })
    expect(stale).toMatchObject({
      operation: 'delete',
      status: 'rejected',
      persisted: false,
      validation: { valid: false, issues: [expect.objectContaining({ code: 'EXPERT_PACK_STALE' })] },
    })
  })

  test('updates an Expert ZIP with self-contained Skill files through the structured update patch', async () => {
    await executeExpertPackAuthoringOperation({ operation: 'create', pack: candidate() })
    const inspected = await executeExpertPackAuthoringOperation({ operation: 'inspect', packId: 'ai-authored-expert' })
    const basisHash = inspected.affectedPack?.basisHash
    expect(basisHash).toMatch(/^sha256:[a-f0-9]{64}$/)

    const result = await executeExpertPackAuthoringOperation({
      operation: 'update',
      packId: 'ai-authored-expert',
      basisHash: basisHash!,
      patch: {
        expert: { id: 'ai-authored-expert', skillIds: ['project-analysis'] },
        skills: [{
          id: 'project-analysis',
          files: {
            'SKILL.md': '# Project analysis\n\nExplain a user-selected project in plain language.\n',
            'references/checklist.md': '- Find how the project starts.\n',
          },
        }],
      },
    })

    expect(result).toMatchObject({ operation: 'update', status: 'succeeded', persisted: true })
    const zipPath = path.join(getExpertPackStorageDir(), 'ai-authored-expert.zip')
    const zip = await adapter.read(new Uint8Array(await fs.readFile(zipPath)))
    expect(await zip.readJson('manifest.json')).toMatchObject({ entrypoints: { skills: ['project-analysis'] } })
    expect(await zip.readText('skills/project-analysis/SKILL.md')).toContain('user-selected project')
    expect(await zip.readText('skills/project-analysis/references/checklist.md')).toContain('Find how the project starts')

    resetExpertPackRegistryForTests()
    expect(await new ExpertPackRegistryService().getExpert('ai-authored-expert')).toEqual(expect.objectContaining({
      skillIds: ['project-analysis'],
      skillContents: expect.objectContaining({ 'project-analysis': expect.stringContaining('user-selected project') }),
    }))
  })

  test('rejects conflicting creates without overwriting the stored Expert ZIP', async () => {
    await executeExpertPackAuthoringOperation({ operation: 'create', pack: candidate() })
    const zipPath = path.join(getExpertPackStorageDir(), 'ai-authored-expert.zip')
    const before = await fs.readFile(zipPath)
    const result = await executeExpertPackAuthoringOperation({
      operation: 'create',
      pack: candidate({ name: 'Different name', expert: { id: 'ai-authored-expert', name: 'Different Expert', systemPromptContent: 'Different prompt.' } }),
    })

    expect(result).toMatchObject({
      operation: 'create',
      status: 'rejected',
      persisted: false,
      validation: { valid: false, issues: [expect.objectContaining({ code: 'EXPERT_PACK_CONFLICT' })] },
    })
    expect(await fs.readFile(zipPath)).toEqual(before)
  })
})
