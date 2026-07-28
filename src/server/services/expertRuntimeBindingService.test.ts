import { describe, expect, test } from 'bun:test'
import type { ExpertRuntimeBinding, ExpertSessionMetadata } from './expertPackRegistryService.js'
import {
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
    // This deliberately simulates an older imported pack. The runtime must not
    // expose obsolete research instructions to the model.
    skills: [{
      skillId: 'research-method',
      title: 'Research method',
      path: 'skills/research-method/SKILL.md',
      sha256: 'test',
      content: 'Use WebSearchTool to discover competitor evidence, then use BrowserResearch for the source page.',
    }],
    hostTools: [
      { id: 'AskUserQuestion', name: 'Ask', purpose: 'Gather missing input.' },
      { id: 'Read', name: 'Read', purpose: 'Read supplied files.' },
      { id: 'BrowserResearch', name: 'Browser research', purpose: 'Open and inspect a rendered public page.' },
      { id: 'WebSearch', name: 'Legacy web discovery', purpose: 'Must not be exposed in Expert Mode.' },
      { id: 'WebFetch', name: 'Web Fetch', purpose: 'Fetch a user-confirmed URL only when explicitly authorized.' },
      { id: 'ExpertMaterialWriter', name: 'Write material', purpose: 'Write a material package.' },
    ],
    tools: [
      { id: 'ask', name: 'Ask', type: 'hostBuiltinRef', entrypoint: 'tools/ask.json', hostToolId: 'AskUserQuestion', permissions: [] },
      { id: 'read', name: 'Read', type: 'hostBuiltinRef', entrypoint: 'tools/read.json', hostToolId: 'Read', permissions: [] },
      { id: 'browser', name: 'Browser research', type: 'hostBuiltinRef', entrypoint: 'tools/browser.json', hostToolId: 'BrowserResearch', permissions: [] },
      { id: 'legacy-search', name: 'Legacy web discovery', type: 'hostBuiltinRef', entrypoint: 'tools/search.json', hostToolId: 'WebSearch', permissions: [] },
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
  test('removes the obsolete web-discovery tool and injects candidate-URL browser research instead', () => {
    const runtimeBinding = binding()
    const enabledToolNames = ['AskUserQuestion', 'Read', 'BrowserResearch', 'WebSearch', 'WebFetch']
    const availability = resolveExpertRuntimeToolAvailability(runtimeBinding, enabledToolNames)

    expect(availability.toolNames).toEqual(['AskUserQuestion', 'Read', 'BrowserResearch', 'WebFetch'])
    expect(availability.hostTools.map((tool) => tool.id)).toEqual(['AskUserQuestion', 'Read', 'BrowserResearch', 'WebFetch'])

    const instruction = buildExpertRuntimeTurnInstruction(activeSession(runtimeBinding), { enabledToolNames })
    expect(instruction).toContain('- BrowserResearch')
    expect(instruction).toContain('- WebFetch')
    expect(instruction).not.toContain('WebSearch')
    expect(instruction).not.toContain('web discovery is unavailable')
    expect(instruction).toContain('construct candidate URLs from trusted domains')
    expect(instruction).toContain('Use BrowserResearch to open each candidate')
    expect(instruction).toContain('A candidate URL is not evidence')
    expect(instruction).toContain('after reasonable attempts')
  })

  test('asks for user material only when BrowserResearch is unavailable for the turn', () => {
    const instruction = buildExpertRuntimeTurnInstruction(activeSession(binding()), {
      enabledToolNames: ['AskUserQuestion', 'Read', 'WebSearch', 'WebFetch'],
    })

    expect(instruction).not.toContain('- BrowserResearch')
    expect(instruction).not.toContain('WebSearch')
    expect(instruction).toContain('Public research limitation: BrowserResearch is not available for this turn.')
    expect(instruction).toContain('Use AskUserQuestion to request a link, screenshot, copied page text, exported page, source file, or permission to retain an evidence gap.')
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
    expect(available).toContain('construct candidate URLs from trusted domains')
  })

  test('excludes the obsolete web-discovery tool for every selected model', () => {
    expect(resolveCurrentExpertRuntimeToolNames('deepseek-chat', ['Read', 'WebSearch'])).toEqual(['Read'])
    expect(resolveCurrentExpertRuntimeToolNames('gpt-5.6', ['Read', 'WebSearch', 'BrowserResearch'])).toEqual(['Read', 'BrowserResearch'])
  })

  test('instructs a template-fill expert to submit field JSON without injecting the complete HTML document', () => {
    const runtimeBinding = binding()
    runtimeBinding.outputMode = 'template-fill'
    runtimeBinding.outputTemplate = {
      path: 'experts/commercialization/templates/report.html',
      content: '<html data-template-id="classic-v1"><head><style>body{color:#111}</style></head><body><h1>{{REPORT_TITLE}}</h1><table><thead><tr><th>编号</th><th>链接（URL）</th></tr></thead><tbody><!-- SLOT: SOURCE_ROWS --></tbody></table></body></html>',
    }

    const instruction = buildExpertRuntimeTurnInstruction(activeSession(runtimeBinding), { enabledToolNames: ['AskUserQuestion', 'Read', 'Write'] })
    expect(instruction).toContain('Final report delivery uses server-rendered template filling:')
    expect(instruction).toContain('cc-jiangxia-expert-template-fill/v1')
    expect(instruction).toContain('REPORT_TITLE')
    expect(instruction).toContain('SOURCE_ROWS')
    expect(instruction).toContain('table-rows')
    expect(instruction).not.toContain('<style>body{color:#111}</style>')
    expect(instruction).not.toContain('Mandatory expert output template:')
  })

  test('uses the global enabled tool pool for experts and disables Edit plus obsolete web discovery', () => {
    const runtimeBinding = binding()
    runtimeBinding.hostTools = [{ id: 'Read', name: 'Read', purpose: 'Read supplied files.' }]
    runtimeBinding.tools = []
    const enabledToolNames = ['Read', 'Write', 'Bash', 'Glob', 'Agent', 'WebSearch', 'Edit']

    const availability = resolveExpertRuntimeToolAvailability(runtimeBinding, enabledToolNames)
    expect(availability.toolNames).toEqual(['Read', 'Write', 'Bash', 'Glob', 'Agent'])

    const policy = resolveExpertRuntimeToolPolicy(activeSession(runtimeBinding), { enabledToolNames })
    expect(policy.allowedTools).toEqual(['Read', 'Write', 'Bash', 'Glob', 'Agent'])
    expect(policy.disallowedTools).toEqual(['WebSearch', 'Edit'])
  })
})
