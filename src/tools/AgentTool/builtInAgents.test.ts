import { afterEach, describe, expect, test } from 'bun:test'
import {
  setIsInteractive,
} from '../../bootstrap/state.js'
import {
  areExplorePlanAgentsEnabled,
  getBuiltInAgents,
} from './builtInAgents.js'

const originalDisableBuiltIns =
  process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS
const originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

afterEach(() => {
  if (originalDisableBuiltIns === undefined) {
    delete process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS
  } else {
    process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS =
      originalDisableBuiltIns
  }

  if (originalEntrypoint === undefined) {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  } else {
    process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint
  }

  setIsInteractive(false)
})

describe('built-in agents', () => {
  test('enables public built-in agents in external builds', () => {
    setIsInteractive(true)

    expect(areExplorePlanAgentsEnabled()).toBe(true)

    const agentTypes = getBuiltInAgents().map(agent => agent.agentType)

    expect(agentTypes).toContain('Explore')
    expect(agentTypes).toContain('Plan')
    expect(agentTypes).toContain('verification')
  })

  test('preserves SDK opt-out in noninteractive sessions', () => {
    setIsInteractive(false)
    process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS = 'true'

    expect(getBuiltInAgents()).toEqual([])
  })
})


test('includes the read-only Expert evidence research role', () => {
  const agent = getBuiltInAgents().find((candidate) => candidate.agentType === 'expert-evidence-researcher')
  expect(agent?.tools).toEqual(['BrowserResearch', 'Read'])
  const prompt = agent?.getSystemPrompt() ?? ''
  expect(prompt).toContain('must make at least one real BrowserResearch call')
  expect(prompt).toContain('search_engine: google')
  expect(prompt).toContain('search_engine: baidu')
  expect(prompt).toContain('search_engine: 360')
  expect(prompt).toContain('Do not hand-build search-engine URLs')
  expect(prompt).toContain('official evidence missing')
  expect(prompt).toContain('open at least one specific candidate page')
})

test('includes the independent Expert evidence review role', () => {
  const agent = getBuiltInAgents().find((candidate) => candidate.agentType === 'expert-evidence-reviewer')
  expect(agent?.tools).toEqual(['BrowserResearch', 'Read'])
  const prompt = agent?.getSystemPrompt() ?? ''
  expect(prompt).toContain('N keyword snapshots')
  expect(prompt).toContain('direct-competitor price gap')
  expect(prompt).toContain('actual [engine=...]')
})
