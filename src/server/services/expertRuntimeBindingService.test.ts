import { describe, expect, test } from 'bun:test'
import type { ExpertRuntimeBinding, ExpertSessionMetadata } from './expertPackRegistryService.js'
import {
  buildExpertOutputTemplateWriteGuard,
  buildExpertRuntimeTurnInstruction,
  resolveCurrentExpertRuntimeToolNames,
  resolveExpertRuntimeToolAvailability,
  resolveExpertRuntimeToolPolicy,
} from './expertRuntimeBindingService.js'

function binding(): ExpertRuntimeBinding {
  return {
    schemaVersion: 1,
    active: true,
    expertId: 'commercialization-research-report',
    expertName: 'Commercialization research report expert',
    packId: 'commercialization-research-report',
    packVersion: '1.0.0',
    promptSnapshot: 'Research public evidence before making a recommendation.',
    skills: [{
      skillId: 'research-method',
      title: 'Research method',
      path: 'skills/research-method/SKILL.md',
      sha256: 'test',
      content: 'Use WebSearchTool to discover competitor evidence, then use WebFetch for the source page.',
    }],
    hostTools: [
      { id: 'AskUserQuestion', name: 'Ask', purpose: 'Gather missing input.' },
      { id: 'Read', name: 'Read', purpose: 'Read supplied files.' },
      { id: 'WebSearch', name: 'Web Search', purpose: 'Discover public sources.' },
      { id: 'WebFetch', name: 'Web Fetch', purpose: 'Fetch user-provided URLs.' },
      { id: 'ExpertMaterialWriter', name: 'Write material', purpose: 'Write a material package.' },
    ],
    tools: [
      { id: 'ask', name: 'Ask', type: 'hostBuiltinRef', entrypoint: 'tools/ask.json', hostToolId: 'AskUserQuestion', permissions: [] },
      { id: 'read', name: 'Read', type: 'hostBuiltinRef', entrypoint: 'tools/read.json', hostToolId: 'Read', permissions: [] },
      { id: 'search', name: 'Web Search', type: 'hostBuiltinRef', entrypoint: 'tools/search.json', hostToolId: 'WebSearch', permissions: [] },
      { id: 'fetch', name: 'Web Fetch', type: 'hostBuiltinRef', entrypoint: 'tools/fetch.json', hostToolId: 'WebFetch', permissions: [] },
      { id: 'writer', name: 'Write material', type: 'hostBuiltinRef', entrypoint: 'tools/write.json', hostToolId: 'ExpertMaterialWriter', permissions: [] },
    ],
    permissions: [],
    activatedAt: '2026-07-22T00:00:00.000Z',
  }
}

function activeSession(runtimeBinding: ExpertRuntimeBinding): ExpertSessionMetadata {
  return {
    mode: 'expert',
    expertId: runtimeBinding.expertId,
    expertName: runtimeBinding.expertName,
    packId: runtimeBinding.packId,
    packVersion: runtimeBinding.packVersion,
    status: 'active',
    runtimeBinding,
    materialRefs: [],
    startedAt: runtimeBinding.activatedAt,
    updatedAt: runtimeBinding.activatedAt,
  }
}

describe('Expert Runtime tool availability', () => {
  test('only injects host tools enabled by the actual runtime and substitutes the DeepSeek no-search path', () => {
    const runtimeBinding = binding()
    const availability = resolveExpertRuntimeToolAvailability(runtimeBinding, ['AskUserQuestion', 'Read', 'WebFetch'])
    expect(availability.toolNames).toEqual(['AskUserQuestion', 'Read', 'WebFetch'])
    expect(availability.webSearchUnavailable).toBe(true)

    const instruction = buildExpertRuntimeTurnInstruction(activeSession(runtimeBinding), { enabledToolNames: ['AskUserQuestion', 'Read', 'WebFetch'] })
    expect(instruction).toContain('- AskUserQuestion')
    expect(instruction).toContain('- Read')
    expect(instruction).toContain('- WebFetch')
    expect(instruction).not.toContain('- WebSearch')
    expect(instruction).not.toContain('- ExpertMaterialWriter')
    expect(instruction).toContain('Ask the user for URLs, screenshots, copied page text, exported pages, or files')
    expect(instruction).toContain('[public web search is unavailable: ask the user for URLs, screenshots, copied page text, or source files instead]')
  })

  test('keeps WebSearch in the injected tool list only when the active runtime enables it', () => {
    const instruction = buildExpertRuntimeTurnInstruction(activeSession(binding()), { enabledToolNames: ['AskUserQuestion', 'Read', 'WebSearch', 'WebFetch'] })
    expect(instruction).toContain('- WebSearch')
    expect(instruction).not.toContain('Public research fallback: web discovery is unavailable')
    expect(instruction).toContain('Use WebSearchTool to discover competitor evidence')
  })
  test('shows BrowserResearch only when the locally installed browser is actually enabled for the expert turn', () => {
    const runtimeBinding = binding()
    runtimeBinding.hostTools = [
      { id: 'AskUserQuestion', name: 'Ask', purpose: 'Gather missing input.' },
      { id: 'BrowserResearch', name: 'Browser research', purpose: 'Read a confirmed rendered public page.' },
    ]
    runtimeBinding.tools = [
      { id: 'ask', name: 'Ask', type: 'hostBuiltinRef', entrypoint: 'tools/ask.json', hostToolId: 'AskUserQuestion', permissions: [] },
      { id: 'browser', name: 'Browser research', type: 'hostBuiltinRef', entrypoint: 'tools/browser.json', hostToolId: 'BrowserResearch', permissions: [] },
    ]

    const unavailable = buildExpertRuntimeTurnInstruction(activeSession(runtimeBinding), { enabledToolNames: ['AskUserQuestion'] })
    expect(unavailable).not.toContain('- BrowserResearch')

    const available = buildExpertRuntimeTurnInstruction(activeSession(runtimeBinding), { enabledToolNames: ['AskUserQuestion', 'BrowserResearch'] })
    expect(available).toContain('- BrowserResearch')
    expect(available).not.toContain('- WebSearch')
    expect(available).not.toContain('- WebFetch')
  })
  test('uses the session-selected model to remove WebSearch even when the default tool list contains it', () => {
    expect(resolveCurrentExpertRuntimeToolNames('deepseek-chat', ['Read', 'WebSearch'], () => false)).toEqual(['Read'])
    expect(resolveCurrentExpertRuntimeToolNames('claude-sonnet-4-6', ['Read'], () => true)).toEqual(['Read', 'WebSearch'])
  })


  test('injects a declared HTML output template as the mandatory final-document base', () => {
    const runtimeBinding = binding()
    runtimeBinding.outputTemplate = {
      path: 'experts/commercialization/templates/report.html',
      content: '<html><head><style>body{color:#111}</style></head><body><h1>{{REPORT_TITLE}}</h1><!-- SLOT: SOURCE_ROWS --></body></html>',
    }

    const instruction = buildExpertRuntimeTurnInstruction(activeSession(runtimeBinding), { enabledToolNames: ['AskUserQuestion', 'Read'] })
    expect(instruction).toContain('Mandatory expert output template:')
    expect(instruction).toContain('experts/commercialization/templates/report.html')
    expect(instruction).toContain('Preserve its CSS, heading hierarchy, table headers, anchors, and all non-slot structure.')
    expect(instruction).toContain('{{REPORT_TITLE}}')
    expect(instruction).toContain('no unresolved {{...}} placeholder or SLOT comment remains')
  })

  test('exposes a per-session Write guard for a declared HTML output template', () => {
    const runtimeBinding = binding()
    runtimeBinding.outputTemplate = {
      path: 'experts/commercialization/templates/report.html',
      content: '<html data-template-id="classic-v1"><head><style>body{color:#111}</style></head><body><h2 id="section1">一、产品</h2><table><thead><tr><th>字段</th></tr></thead></table><h2 id="sources">来源</h2></body></html>',
    }

    const encoded = buildExpertOutputTemplateWriteGuard(activeSession(runtimeBinding))

    expect(encoded).toBeTruthy()
  })

  test('uses the global enabled tool pool for experts and only disables Edit globally', () => {
    const runtimeBinding = binding()
    runtimeBinding.hostTools = [{ id: 'Read', name: 'Read', purpose: 'Read supplied files.' }]
    runtimeBinding.tools = []

    const availability = resolveExpertRuntimeToolAvailability(runtimeBinding, ['Read', 'Write', 'Bash', 'Glob', 'Agent', 'Edit'])
    expect(availability.toolNames).toEqual(['Read', 'Write', 'Bash', 'Glob', 'Agent'])

    const policy = resolveExpertRuntimeToolPolicy(activeSession(runtimeBinding), { enabledToolNames: ['Read', 'Write', 'Bash', 'Glob', 'Agent', 'Edit'] })
    expect(policy.allowedTools).toEqual(['Read', 'Write', 'Bash', 'Glob', 'Agent'])
    expect(policy.disallowedTools).toEqual(['Edit'])
  })


})

