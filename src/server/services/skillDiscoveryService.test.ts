import { describe, expect, it } from 'bun:test'
import {
  SkillDiscoveryConfigurationError,
  SkillDiscoveryService,
} from './skillDiscoveryService.js'

function searchOutput(hits: Array<{ title: string; url: string }>) {
  return {
    query: 'test',
    durationSeconds: 0.01,
    results: [
      'Search provider: tavily',
      { tool_use_id: 'tavily-web-search', content: hits },
    ],
  }
}

describe('SkillDiscoveryService', () => {
  it('searches both public Web and QClaw, labels the links, and deduplicates URLs', async () => {
    const calls: Array<{ query: string; allowed_domains?: string[] }> = []
    const service = new SkillDiscoveryService({
      getSettings: () => ({ tavilyApiKey: 'test-key' }),
      getProvider: () => 'tavily',
      getApiKey: () => 'test-key',
      search: async (_provider, input) => {
        calls.push(input)
        return input.allowed_domains
          ? searchOutput([
              { title: 'QClaw Skill', url: 'https://qclaw.qq.com/as/abc' },
              { title: 'QClaw Skill', url: 'https://qclaw.qq.com/as/abc' },
              { title: 'Unexpected domain', url: 'https://example.com/should-not-appear' },
            ])
          : searchOutput([
              { title: 'Public Skill', url: 'https://example.com/skill' },
              { title: 'QClaw duplicate', url: 'https://qclaw.qq.com/as/abc#details' },
              { title: 'Unsafe', url: 'file:///local-skill' },
            ])
      },
    })

    const response = await service.searchSkills('  market research  ', 'all')

    expect(calls).toEqual([
      { query: 'market research' },
      { query: 'market research', allowed_domains: ['qclaw.qq.com'] },
    ])
    expect(response).toEqual({
      query: 'market research',
      source: 'all',
      provider: 'tavily',
      results: [
        { title: 'Public Skill', url: 'https://example.com/skill', source: 'web' },
        { title: 'QClaw Skill', url: 'https://qclaw.qq.com/as/abc', source: 'qclaw' },
      ],
    })
  })

  it('reports a configuration problem instead of claiming that discovery succeeded without a provider', async () => {
    const service = new SkillDiscoveryService({
      getSettings: () => ({}),
      getProvider: () => null,
    })

    await expect(service.searchSkills('product research', 'web')).rejects.toBeInstanceOf(
      SkillDiscoveryConfigurationError,
    )
  })
})
