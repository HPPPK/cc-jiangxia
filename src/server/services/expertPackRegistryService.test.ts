import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExpertPackRegistryService, getExpertPackStorageDir, resetExpertPackRegistryForTests } from './expertPackRegistryService.js'
import { ZipPackAdapter } from './zipPackAdapter.js'

const adapter = new ZipPackAdapter()
const tempRoots: string[] = []
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
const previousBundledPacksDir = process.env.CLAUDE_EXPERT_PACKS_DIR

function validPackEntries(overrides: Record<string, unknown> = {}) {
  const manifest = {
    packId: 'custom-expert-pack',
    name: 'Custom Expert Pack',
    version: '1.0.0',
    schemaVersion: 1,
    type: 'expert-pack',
    description: 'Test package',
    entrypoints: {
      experts: ['experts/custom/expert.json'],
      skills: ['custom-guide'],
    },
    hostTools: [{ id: 'AskUserQuestion', name: 'Ask', purpose: 'Confirm the focus.' }],
    permissions: [{ id: 'write-expert-output', description: 'Write only the expert output.' }],
    ...overrides,
  }
  return {
    'manifest.json': JSON.stringify(manifest),
    'experts/custom/expert.json': JSON.stringify({
      id: 'custom-expert',
      name: 'Custom Expert',
      description: 'Test expert',
      statusLabel: 'Ready',
      promptPaths: { system: 'experts/custom/prompts/system.md' },
      skillIds: ['custom-guide'],
      formPaths: ['experts/custom/forms/intake.json'],
    }),
    'experts/custom/prompts/system.md': '# Custom Expert\n\nRead the user-provided material.\n',
    'experts/custom/forms/intake.json': JSON.stringify({ version: 1, steps: [] }),
    'skills/custom-guide/SKILL.md': '# Custom Guide\n\nFollow the package instructions.\n',
  }
}

async function makeService() {
  const root = await mkdtemp(path.join(tmpdir(), 'expert-pack-registry-'))
  tempRoots.push(root)
  process.env.CLAUDE_CONFIG_DIR = root
  process.env.CLAUDE_EXPERT_PACKS_DIR = path.join(root, 'bundled')
  resetExpertPackRegistryForTests()
  return new ExpertPackRegistryService()
}

describe('ExpertPackRegistryService', () => {
  afterEach(async () => {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    resetExpertPackRegistryForTests()
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('only loads experts from the canonical ZIP directory', async () => {
    const service = await makeService()

    expect(await service.listExperts()).toEqual([])
    expect(getExpertPackStorageDir()).toBe(path.join(process.env.CLAUDE_CONFIG_DIR!, 'cc-jiangxia', 'experts', 'packs'))
  })

  it('seeds a bundled Expert ZIP into user configuration on first load, then keeps it as the local override', async () => {
    const service = await makeService()
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'bundled-expert-pack-'))
    tempRoots.push(bundleDir)
    await mkdir(bundleDir, { recursive: true })
    await writeFile(path.join(bundleDir, 'custom-expert-pack.zip'), await adapter.write(validPackEntries()))
    process.env.CLAUDE_EXPERT_PACKS_DIR = bundleDir
    resetExpertPackRegistryForTests()

    expect(await service.getExpert('custom-expert')).toEqual(expect.objectContaining({ id: 'custom-expert' }))
    expect(await service.readPackText('custom-expert-pack', 'experts/custom/prompts/system.md')).toContain('Custom Expert')
    expect(await service.exportExpertPackZip('custom-expert-pack')).toEqual(expect.objectContaining({ filename: 'custom-expert-pack.zip' }))
    expect((await service.listPacks()).find((pack) => pack.packId === 'custom-expert-pack')).toEqual(expect.objectContaining({
      storage: expect.objectContaining({ source: 'stored', path: 'custom-expert-pack.zip' }),
    }))

    await service.updateExpertPack('custom-expert-pack', { name: 'Local override' })
    expect((await service.listPacks()).find((pack) => pack.packId === 'custom-expert-pack')).toEqual(expect.objectContaining({
      name: 'Local override',
      storage: expect.objectContaining({ source: 'stored' }),
    }))
  })

  it('exposes and updates portable expert category metadata from the ZIP manifest', async () => {
    const service = await makeService()
    await service.importExpertPackZip(await adapter.write(validPackEntries({
      catalog: { categoryId: 'product', tags: ['research', 'commercialization'] },
    })))

    expect(await service.getExpert('custom-expert')).toEqual(expect.objectContaining({
      categoryId: 'product',
      tags: ['research', 'commercialization'],
    }))

    await service.updateExpertPack('custom-expert-pack', {
      catalog: { categoryId: 'development', tags: ['migration'] },
    })

    expect(await service.getExpert('custom-expert')).toEqual(expect.objectContaining({
      categoryId: 'development',
      tags: ['migration'],
    }))
  })

  it('imports and exports the same ZIP-backed expert package without extraction', async () => {
    const service = await makeService()
    const input = await adapter.write(validPackEntries())

    await service.importExpertPackZip(input)
    const exported = await service.exportExpertPackZip('custom-expert-pack')
    const zip = await adapter.read(Buffer.from(exported.dataBase64, 'base64'))

    expect(zip.has('manifest.json')).toBe(true)
    expect(zip.has('experts/custom/expert.json')).toBe(true)
    expect(zip.has('experts/custom/prompts/system.md')).toBe(true)
    expect(zip.has('skills/custom-guide/SKILL.md')).toBe(true)
  })

  it('updates an expert package in place and copies it into a new ZIP', async () => {
    const service = await makeService()
    await service.importExpertPackZip(await adapter.write(validPackEntries()))

    await service.updateExpertPack('custom-expert-pack', {
      name: 'Updated package',
      experts: [{ id: 'custom-expert', name: 'Updated expert', description: 'Updated description' }],
    })
    expect(await service.getExpert('custom-expert')).toEqual(expect.objectContaining({
      name: 'Updated expert',
      description: 'Updated description',
    }))

    const copied = await service.copyExpertPack('custom-expert-pack')
    expect(copied.pack.packId).not.toBe('custom-expert-pack')
    expect(copied.experts[0]?.id).not.toBe('custom-expert')
    expect((await service.listPacks()).map((pack) => pack.packId)).toEqual(expect.arrayContaining(['custom-expert-pack', copied.pack.packId]))
  })

  it('updates the complete single-expert ZIP contract without extracting it', async () => {
    const service = await makeService()
    const inputEntries = validPackEntries({
      entrypoints: {
        experts: ['experts/custom/expert.json'],
        skills: ['custom-guide'],
        tools: ['tools/local/tool.json'],
      },
    })
    inputEntries['tools/local/tool.json'] = JSON.stringify({
      id: 'local-tool',
      name: 'Local Tool',
      type: 'packageLocalDeclarative',
      purpose: 'Run the expert local capability.',
      entrypoint: 'tools/local/tool.json',
      permissions: [],
      network: 'none',
    })
    await service.importExpertPackZip(await adapter.write(inputEntries))

    const updated = await service.updateExpertPack('custom-expert-pack', {
      name: 'Updated Expert',
      version: '2.0.0',
      description: 'Updated package description',
      minHostVersion: '1.2.3',
      hostTools: [{ id: 'Read', name: 'Read', purpose: 'Read workspace files.' }],
      permissions: [{ id: 'read-workspace', description: 'Read workspace files.' }],
      portability: { selfContained: true, notes: 'Portable expert.' },
      expert: {
        id: 'custom-expert',
        name: 'Updated expert',
        description: 'Updated expert description',
        statusLabel: 'Ready for review',
        systemPromptContent: '# Updated prompt',
        skillIds: ['custom-guide'],
        intakeFlow: { version: 1, steps: [{ type: 'message', id: 'welcome', markdown: 'Welcome.' }] },
        outputProtocolContent: '{"status":"ok"}',
      },
      tools: [{
        id: 'local-tool',
        name: 'Updated Local Tool',
        type: 'packageLocalDeclarative',
        purpose: 'Updated purpose.',
        entrypoint: 'tools/local/tool.json',
        permissions: [],
        network: 'none',
      }],
    })

    expect(updated).toEqual(expect.objectContaining({
      name: 'Updated Expert',
      version: '2.0.0',
      description: 'Updated package description',
    }))
    expect(updated.manifest.minHostVersion).toBe('1.2.3')
    expect(updated.manifest.hostTools?.[0]?.id).toBe('Read')
    expect(updated.experts[0]).toEqual(expect.objectContaining({
      name: 'Updated expert',
      description: 'Updated expert description',
      statusLabel: 'Ready for review',
      skillIds: ['custom-guide'],
      intakeFlow: { version: 1, steps: [{ type: 'message', id: 'welcome', markdown: 'Welcome.' }] },
    }))
    expect(updated.tools[0]).toEqual(expect.objectContaining({ name: 'Updated Local Tool' }))
    const exported = await service.exportExpertPackZip('custom-expert-pack')
    const zip = await adapter.read(Buffer.from(exported.dataBase64, 'base64'))
    expect(await zip.readText('experts/custom/prompts/system.md')).toBe('# Updated prompt')
    expect(await zip.readText('experts/custom/forms/intake.json')).toContain('welcome')
    expect(await zip.readText('experts/custom-expert/output-protocol.json')).toBe('{"status":"ok"}')
  })

  it('rejects a ZIP that contains more than one expert definition', async () => {
    const service = await makeService()
    const entries = validPackEntries({
      entrypoints: {
        experts: ['experts/custom/expert.json', 'experts/second/expert.json'],
        skills: ['custom-guide'],
      },
    })
    entries['experts/second/expert.json'] = JSON.stringify({
      id: 'second-expert',
      name: 'Second Expert',
      description: 'Second expert',
      promptPaths: { system: 'experts/second/system.md' },
      skillIds: ['custom-guide'],
      formPaths: [],
    })
    entries['experts/second/system.md'] = '# Second'

    await expect(service.previewExpertPackZip(await adapter.write(entries))).rejects.toThrow(/exactly one expert/i)
  })
  it('deletes only the selected expert ZIP', async () => {
    const service = await makeService()
    await service.importExpertPackZip(await adapter.write(validPackEntries()))

    await service.deleteExpertPack('custom-expert-pack')

    await expect(service.getExpert('custom-expert')).resolves.toBeNull()
    await expect(service.listPacks()).resolves.toEqual([])
  })

  it('imports a valid package and shows it in installed experts', async () => {
    const service = await makeService()
    const preview = await service.importExpertPackZip(await adapter.write(validPackEntries()))

    expect(preview.experts[0]?.id).toBe('custom-expert')
    expect((await service.listExperts()).some((expert) => expert.id === 'custom-expert')).toBe(true)
  })

  it('uses the newest imported definition when different packs declare the same expert ID', async () => {
    const service = await makeService()
    const firstEntries = validPackEntries({ packId: 'first-custom-pack', name: 'First package' })
    firstEntries['experts/custom/expert.json'] = JSON.stringify({
      ...JSON.parse(firstEntries['experts/custom/expert.json']),
      id: 'shared-expert',
      name: 'First expert',
    })
    const replacementEntries = validPackEntries({ packId: 'replacement-custom-pack', name: 'Replacement package' })
    replacementEntries['experts/custom/expert.json'] = JSON.stringify({
      ...JSON.parse(replacementEntries['experts/custom/expert.json']),
      id: 'shared-expert',
      name: 'Replacement expert',
    })

    await service.importExpertPackZip(await adapter.write(firstEntries))
    const preview = await service.previewExpertPackZip(await adapter.write(replacementEntries))
    await service.importExpertPackZip(await adapter.write(replacementEntries))

    const matchingExperts = (await service.listExperts()).filter((expert) => expert.id === 'shared-expert')
    expect(preview.overwrite).toBe(true)
    expect(matchingExperts).toEqual([expect.objectContaining({
      id: 'shared-expert',
      name: 'Replacement expert',
      packId: 'replacement-custom-pack',
    })])
  })

  it('rejects packages without a manifest', async () => {
    const service = await makeService()
    await expect(service.previewExpertPackZip(await adapter.write({ 'README.md': 'missing manifest' }))).rejects.toThrow(/manifest.json/)
  })

  it('accepts host skill bindings without copying SKILL.md into the expert ZIP', async () => {
    const service = await makeService()
    const entries = validPackEntries()
    delete entries['skills/custom-guide/SKILL.md']
    const preview = await service.previewExpertPackZip(await adapter.write(entries))
    expect(preview.canImport).toBe(true)
    expect(preview.experts[0]?.skillIds).toEqual(['custom-guide'])
    expect(preview.experts[0]?.skillContents).toEqual({})
  })

  it('rejects unsafe zip entry paths before import', async () => {
    const service = await makeService()
    const zipData = await adapter.write({ ...validPackEntries(), '../evil.txt': 'unsafe' }, { validatePaths: false })
    await expect(service.previewExpertPackZip(zipData)).rejects.toThrow(/Unsafe ZIP entry path/)
  })
  it('loads an optional declared output template from a self-contained ZIP', async () => {
    const service = await makeService()
    const entries = validPackEntries()
    entries['experts/custom/expert.json'] = JSON.stringify({
      id: 'custom-expert',
      name: 'Custom expert',
      description: 'Custom expert package',
      promptPaths: { system: 'experts/custom/prompts/system.md' },
      outputTemplatePath: 'experts/custom/templates/report.html',
      skillIds: ['custom-guide'],
      formPaths: [],
    })
    entries['experts/custom/templates/report.html'] = '<html>{{REPORT_TITLE}}</html>'

    const preview = await service.previewExpertPackZip(await adapter.write(entries))
    expect(preview.experts[0]).toEqual(expect.objectContaining({
      outputTemplatePath: 'experts/custom/templates/report.html',
      outputTemplateContent: '<html>{{REPORT_TITLE}}</html>',
    }))
  })

})
