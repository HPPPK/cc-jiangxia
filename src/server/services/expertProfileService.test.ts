import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExpertPackRegistryService, resetExpertPackRegistryForTests } from './expertPackRegistryService.js'
import { ExpertProfileService, getExpertProfileStorageDir } from './expertProfileService.js'
import { ZipPackAdapter } from './zipPackAdapter.js'

const adapter = new ZipPackAdapter()
const tempRoots: string[] = []
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR

async function makeService() {
  const root = await mkdtemp(path.join(tmpdir(), 'expert-profile-service-'))
  tempRoots.push(root)
  process.env.CLAUDE_CONFIG_DIR = root
  resetExpertPackRegistryForTests()
  const registry = new ExpertPackRegistryService()
  await registry.importExpertPackZip(await adapter.write({
    'manifest.json': JSON.stringify({
      packId: 'profile-pack', name: 'Profile Pack', version: '1.0.0', schemaVersion: 1, type: 'expert-pack',
      entrypoints: { experts: ['experts/profile/expert.json'], skills: [], tools: [] }, portability: { selfContained: true },
    }),
    'experts/profile/expert.json': JSON.stringify({
      id: 'profile-expert', name: 'Profile Expert', description: 'Profile test', statusLabel: 'Ready',
      promptPaths: { system: 'experts/profile/prompts/system.md' }, formPaths: [], skillIds: [],
      profile: {
        tagline: 'Base tagline',
        soul: { whoIAm: 'Base identity', howITalk: 'Clear and direct', boundaries: ['No made-up facts'] },
        workflow: [{ id: 'discover', title: 'Discover', description: 'Understand context' }],
      },
    }),
    'experts/profile/prompts/system.md': '# Profile Expert',
  }))
  return new ExpertProfileService(registry)
}

describe('ExpertProfileService', () => {
  afterEach(async () => {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    resetExpertPackRegistryForTests()
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('merges a local editable override with the profile packaged in the ZIP', async () => {
    const service = await makeService()
    const initial = await service.getProfile('profile-expert')
    expect(initial.profile.tagline).toBe('Base tagline')
    expect(initial.profile.workflow?.[0]?.title).toBe('Discover')

    const updated = await service.updateProfile('profile-expert', {
      tagline: 'Personalized tagline',
      soul: { whoIAm: 'Personal identity', howITalk: 'Practical', boundaries: ['Ask for constraints'] },
      memories: [{ id: 'memory-1', content: 'Use the product vocabulary from the team.', createdAt: '2026-07-22T00:00:00.000Z' }],
    })

    expect(updated.profile.tagline).toBe('Personalized tagline')
    expect(updated.profile.soul?.whoIAm).toBe('Personal identity')
    expect(updated.profile.workflow?.[0]?.title).toBe('Discover')
    expect(updated.profile.memories?.[0]?.content).toContain('product vocabulary')
    expect(getExpertProfileStorageDir()).toBe(path.join(process.env.CLAUDE_CONFIG_DIR!, 'cc-jiangxia', 'experts', 'state'))
  })
})
