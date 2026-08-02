import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import { IDLE_SPECULATION_STATE } from '../../state/AppStateStore.js'
import { createTaskStateBase } from '../../Task.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { Message } from '../../types/message.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  getCommandQueue,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import { createAssistantMessage, createUserMessage } from '../../utils/messages.js'
import {
  buildBrowserResearchAudit,
  countToolUsesByName,
  formatBrowserResearchAudit,
  finalizeAgentTool,
  runAsyncAgentLifecycle,
} from './agentToolUtils.js'


describe('Expert BrowserResearch audit', () => {
  const evidenceResearchMetadata = () => ({
    prompt: 'Research public evidence for the assigned report section.',
    resolvedAgentModel: 'test-model',
    isBuiltInAgent: true,
    startTime: Date.now(),
    agentType: 'expert-evidence-researcher',
    isAsync: false,
  })

  test('counts BrowserResearch from real assistant tool_use blocks only', () => {
    const message = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_browser',
          name: 'BrowserResearch',
          input: { url: 'https://example.com' },
        },
        {
          type: 'tool_use',
          id: 'toolu_read',
          name: 'Read',
          input: { file_path: 'notes.md' },
        },
        { type: 'text', text: 'I listed BrowserResearch in prose too.' },
      ],
    }) as Message

    expect(countToolUsesByName([message], 'BrowserResearch')).toBe(1)
    expect(countToolUsesByName([message], 'WebFetch')).toBe(0)
  })

  test('builds a real BrowserResearch audit from paired tool result ledgers, not subagent prose', () => {
    const openedToolUse = createAssistantMessage({
      content: [{
        type: 'tool_use',
        id: 'toolu_opened',
        name: 'BrowserResearch',
        input: { url: 'https://zh.mweb.im/' },
      }],
    }) as Message
    const unavailableSearchToolUse = createAssistantMessage({
      content: [{
        type: 'tool_use',
        id: 'toolu_search',
        name: 'BrowserResearch',
        input: { search_query: 'MWeb markdown reader pricing', search_engine: 'baidu' },
      }, {
        type: 'text',
        text: 'I definitely opened a pricing page, even though that is not true.',
      }],
    }) as Message
    const openedLedger = Buffer.from(JSON.stringify({
      url: 'https://zh.mweb.im/',
      attempts: [{ url: 'https://zh.mweb.im/', outcome: 'success' }],
    }), 'utf8').toString('base64')
    const unavailableLedger = Buffer.from(JSON.stringify({
      url: 'https://www.bing.com/',
      attempts: [{
        url: 'https://www.bing.com/',
        outcome: 'failed',
        failureKind: 'search_irrelevant',
        searchEngine: 'bing',
        error: 'SEARCH_DISCOVERY_IRRELEVANT: rendered links did not match the query.',
      }],
    }), 'utf8').toString('base64')
    const resultMessage = createUserMessage({
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_opened',
        content: `<browser-research-ledger encoding="base64">${openedLedger}</browser-research-ledger>`,
      }, {
        type: 'tool_result',
        tool_use_id: 'toolu_search',
        content: `<browser-research-ledger encoding="base64">${unavailableLedger}</browser-research-ledger>`,
      }],
    }) as Message

    expect(buildBrowserResearchAudit([
      openedToolUse,
      resultMessage,
      unavailableSearchToolUse,
    ])).toEqual([
      {
        target: 'https://zh.mweb.im/',
        kind: 'url',
        status: 'opened',
        finalUrl: 'https://zh.mweb.im/',
      },
      {
        target: 'MWeb markdown reader pricing',
        kind: 'search',
        searchEngine: 'bing',
        status: 'search_irrelevant',
        finalUrl: 'https://www.bing.com/',
        detail: 'SEARCH_DISCOVERY_IRRELEVANT: rendered links did not match the query.',
      },
    ])
    expect(formatBrowserResearchAudit(buildBrowserResearchAudit([
      openedToolUse,
      resultMessage,
      unavailableSearchToolUse,
    ]))).toContain('query "MWeb markdown reader pricing" [engine=bing]')
  })

  test('classifies access-limited and missing-target BrowserResearch results without expanding them into product conclusions', () => {
    const accessToolUse = createAssistantMessage({
      content: [{
        type: 'tool_use',
        id: 'toolu_baidu',
        name: 'BrowserResearch',
        input: { url: 'https://www.baidu.com/s?wd=mweb' },
      }],
    }) as Message
    const missingTargetToolUse = createAssistantMessage({
      content: [{
        type: 'tool_use',
        id: 'toolu_store',
        name: 'BrowserResearch',
        input: { url: 'https://apps.apple.com/us/app/missing/id1' },
      }],
    }) as Message
    const ledger = (url: string, failureKind: string, error: string): string => Buffer.from(JSON.stringify({
      url,
      attempts: [{ url, outcome: 'failed', failureKind, error }],
    }), 'utf8').toString('base64')
    const resultMessage = createUserMessage({
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_baidu',
        content: `<browser-research-ledger encoding="base64">${ledger('https://www.baidu.com/s?wd=mweb', 'access_limited', 'Baidu CAPTCHA')}</browser-research-ledger>`,
      }, {
        type: 'tool_result',
        tool_use_id: 'toolu_store',
        content: `<browser-research-ledger encoding="base64">${ledger('https://apps.apple.com/us/app/missing/id1', 'target_unavailable', 'The requested App Store target was not found.')}</browser-research-ledger>`,
      }],
    }) as Message

    const audit = buildBrowserResearchAudit([accessToolUse, missingTargetToolUse, resultMessage])
    expect(audit.map(entry => entry.status)).toEqual([
      'access_limited',
      'target_unavailable',
    ])
    const trailer = formatBrowserResearchAudit(audit)
    expect(trailer).toContain('access_limited: https://www.baidu.com/s?wd=mweb')
    expect(trailer).toContain('target_unavailable: https://apps.apple.com/us/app/missing/id1')
    expect(trailer).not.toContain('product is unavailable')
  })

  test('keeps a complete bounded audit for a normal deep-research worker rather than hiding later source URLs', () => {
    const audit = Array.from({ length: 24 }, (_, index) => ({
      target: `https://example.com/source-${index + 1}` ,
      kind: 'url' as const,
      status: 'opened' as const,
    }))

    const trailer = formatBrowserResearchAudit(audit)
    expect(trailer).toContain('https://example.com/source-24')
    expect(trailer).not.toContain('truncated:')
  })

  test('rejects an Expert evidence researcher that returns without BrowserResearch', () => {
    const message = createAssistantMessage({
      content: 'I researched this from general knowledge and some URLs in text.',
    }) as Message

    expect(() => finalizeAgentTool(
      [message],
      'expert-researcher-without-browser',
      evidenceResearchMetadata(),
    )).toThrow('EXPERT_BROWSER_RESEARCH_REQUIRED')
  })

  test('returns the BrowserResearch audit count for an Expert evidence researcher', () => {
    const message = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_browser',
          name: 'BrowserResearch',
          input: { url: 'https://example.com/evidence' },
        },
        { type: 'text', text: 'Evidence ledger complete.' },
      ],
    }) as Message

    const result = finalizeAgentTool(
      [message],
      'expert-researcher-with-browser',
      evidenceResearchMetadata(),
    )

    expect(result.browserResearchToolUseCount).toBe(1)
    expect(result.totalToolUseCount).toBe(1)
  })
})

describe('runAsyncAgentLifecycle', () => {
  afterEach(() => {
    resetCommandQueue()
  })

  test('notifies the parent before post-completion cleanup finishes', async () => {
    const taskId = 'agent-notify-first'
    const abortController = new AbortController()
    const task: LocalAgentTaskState = {
      ...createTaskStateBase(taskId, 'local_agent', 'Review code', 'toolu_agent'),
      status: 'running',
      agentId: taskId,
      prompt: 'Review code',
      agentType: 'general-purpose',
      abortController,
      retrieved: false,
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
      isBackgrounded: true,
      pendingMessages: [],
      retain: false,
      diskLoaded: false,
    }
    let appState = {
      tasks: { [taskId]: task },
      toolPermissionContext: getEmptyToolPermissionContext(),
      speculation: IDLE_SPECULATION_STATE,
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState): void => {
      appState = updater(appState)
    }
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'Review complete.' }],
    }) as Message
    let cleanupStarted = false

    async function* makeStream(): AsyncGenerator<Message, void> {
      yield message
    }

    const result = await Promise.race([
      runAsyncAgentLifecycle({
        taskId,
        abortController,
        makeStream,
        metadata: {
          prompt: 'Review code',
          resolvedAgentModel: 'test-model',
          isBuiltInAgent: true,
          startTime: Date.now(),
          agentType: 'general-purpose',
          isAsync: true,
        },
        description: 'Review code',
        toolUseContext: {
          options: { tools: [] },
          toolUseId: 'toolu_agent',
          getAppState: () => appState,
        } as unknown as ToolUseContext,
        rootSetAppState: setAppState,
        agentIdForCleanup: taskId,
        enableSummarization: false,
        getWorktreeResult: () => {
          cleanupStarted = true
          return new Promise(() => {})
        },
      }),
      new Promise(resolve => setTimeout(() => resolve('timed-out'), 50)),
    ])

    expect(result).toEqual({ status: 'succeeded' })
    expect(cleanupStarted).toBe(true)
    expect(appState.tasks[taskId]?.status).toBe('completed')
    expect(getCommandQueue()).toHaveLength(1)
    expect(String(getCommandQueue()[0]?.value)).toContain(
      '<status>completed</status>',
    )
    expect(String(getCommandQueue()[0]?.value)).toContain('Review complete.')
  })

  test('returns a failed outcome when the background agent stream fails', async () => {
    const taskId = 'agent-failure-outcome'
    const abortController = new AbortController()
    const task: LocalAgentTaskState = {
      ...createTaskStateBase(taskId, 'local_agent', 'Failing agent', 'toolu_failure'),
      status: 'running',
      agentId: taskId,
      prompt: 'Fail deliberately',
      agentType: 'general-purpose',
      abortController,
      retrieved: false,
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
      isBackgrounded: true,
      pendingMessages: [],
      retain: false,
      diskLoaded: false,
    }
    let appState = {
      tasks: { [taskId]: task },
      toolPermissionContext: getEmptyToolPermissionContext(),
      speculation: IDLE_SPECULATION_STATE,
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState): void => {
      appState = updater(appState)
    }

    async function* makeStream(): AsyncGenerator<Message, void> {
      throw new Error('stream failed')
    }

    await expect(runAsyncAgentLifecycle({
      taskId,
      abortController,
      makeStream,
      metadata: {
        prompt: 'Fail deliberately',
        resolvedAgentModel: 'test-model',
        isBuiltInAgent: true,
        startTime: Date.now(),
        agentType: 'general-purpose',
        isAsync: true,
      },
      description: 'Failing agent',
      toolUseContext: {
        options: { tools: [] },
        toolUseId: 'toolu_failure',
        getAppState: () => appState,
      } as unknown as ToolUseContext,
      rootSetAppState: setAppState,
      agentIdForCleanup: taskId,
      enableSummarization: false,
      getWorktreeResult: async () => ({}),
    })).resolves.toEqual({ status: 'failed', reason: 'stream failed' })
    expect(appState.tasks[taskId]?.status).toBe('failed')
  })
})
