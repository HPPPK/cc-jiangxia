import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildBundledExpertPacks } from './build-expert-packs.js'
import { ZipPackAdapter } from '../src/server/services/zipPackAdapter.js'

const roots: string[] = []
const adapter = new ZipPackAdapter()

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('buildBundledExpertPacks', () => {
  it('builds a self-contained ZIP with manifest, expert resources, skills, and declarative tools', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'build-expert-packs-'))
    roots.push(root)
    const sourceDir = path.join(root, 'experts')
    const packDir = path.join(sourceDir, 'research-pack')
    const outputDir = path.join(root, 'out')
    await mkdir(path.join(packDir, 'skills', 'research'), { recursive: true })
    await mkdir(path.join(packDir, 'tools', 'write'), { recursive: true })
    await mkdir(path.join(packDir, 'prompts'), { recursive: true })
    await writeFile(path.join(packDir, 'manifest.json'), JSON.stringify({
      packId: 'research-pack',
      name: 'Research Pack',
      version: '1.0.0',
      schemaVersion: 1,
      type: 'expert-pack',
      entrypoints: {
        experts: ['experts/research-pack/expert.json'],
        skills: ['research'],
        tools: ['tools/write/tool.json'],
      },
    }))
    await writeFile(path.join(packDir, 'expert.json'), JSON.stringify({ id: 'research-pack' }))
    await writeFile(path.join(packDir, 'prompts', 'system.md'), '# System')
    await writeFile(path.join(packDir, 'skills', 'research', 'SKILL.md'), '# Research')
    await writeFile(path.join(packDir, 'tools', 'write', 'tool.json'), JSON.stringify({ id: 'write' }))

    const outputs = await buildBundledExpertPacks({ sourceDir, outputDir })
    expect(outputs).toEqual([path.join(outputDir, 'research-pack.zip')])

    const zip = await adapter.read(new Uint8Array(await readFile(outputs[0]!)))
    expect(zip.has('manifest.json')).toBe(true)
    expect(zip.has('experts/research-pack/expert.json')).toBe(true)
    expect(zip.has('experts/research-pack/prompts/system.md')).toBe(true)
    expect(zip.has('skills/research/SKILL.md')).toBe(true)
    expect(zip.has('tools/write/tool.json')).toBe(true)
  })
  it('rejects a source pack that declares a missing Skill before writing a ZIP', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'incomplete-expert-pack-'))
    roots.push(root)
    const sourceDir = path.join(root, 'experts')
    const packDir = path.join(sourceDir, 'incomplete-pack')
    await mkdir(packDir, { recursive: true })
    await writeFile(path.join(packDir, 'manifest.json'), JSON.stringify({
      packId: 'incomplete-pack',
      name: 'Incomplete Pack',
      version: '1.0.0',
      schemaVersion: 1,
      type: 'expert-pack',
      entrypoints: { experts: ['experts/incomplete-pack/expert.json'], skills: ['missing-skill'] },
    }))

    await expect(buildBundledExpertPacks({ sourceDir, outputDir: path.join(root, 'out') })).rejects.toThrow(
      'Expert Pack is missing declared Skill file: skills/missing-skill/SKILL.md',
    )
  })

  it('bundles the commercialization pack external-demand skill and its runtime priority', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'commercialization-expert-pack-'))
    roots.push(root)
    const sourceDir = path.resolve(import.meta.dir, '..', 'experts')
    const outputDir = path.join(root, 'out')

    const outputs = await buildBundledExpertPacks({ sourceDir, outputDir })
    const output = outputs.find((candidate) => path.basename(candidate) === 'commercialization-research-report.zip')
    expect(output).toBeDefined()

    const zip = await adapter.read(new Uint8Array(await readFile(output!)))
    const manifest = JSON.parse(await zip.readText('manifest.json'))
    const expert = JSON.parse(await zip.readText('experts/commercialization-research-report/expert.json'))
    const skillPath = 'skills/external-demand-evidence/SKILL.md'
    const systemPrompt = await zip.readText('experts/commercialization-research-report/prompts/system.md')

    expect(manifest.version).toBe('0.10.9-local')
    expect(manifest.entrypoints.skills.slice(0, 3)).toEqual([
      'commercialization-research-method',
      'source-graph-research',
      'external-demand-evidence',
    ])
    expect(expert.skillIds.slice(0, 3)).toEqual(manifest.entrypoints.skills.slice(0, 3))
    expect(expert.skillIds.every((skillId: string) => manifest.entrypoints.skills.includes(skillId))).toBe(true)
    for (const skillId of manifest.entrypoints.skills) {
      expect(zip.has(`skills/${skillId}/SKILL.md`)).toBe(true)
    }
    expect(zip.has('skills/commercialization-research-method/SKILL.md')).toBe(true)
    expect(zip.has(skillPath)).toBe(true)
    expect(await zip.readText(skillPath)).toContain('BrowserResearch')
    expect(systemPrompt).toContain('external-demand-evidence')
  })
})
