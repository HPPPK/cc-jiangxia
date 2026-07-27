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
    expect(zip.has('experts/research-pack/skills/research/SKILL.md')).toBe(true)
    expect(zip.has('tools/write/tool.json')).toBe(true)
  })
})
