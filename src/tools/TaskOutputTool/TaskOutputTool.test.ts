import { expect, test } from 'bun:test'
import { TaskOutputTool } from './TaskOutputTool.js'

test('returns the real BrowserResearch audit with an async Agent TaskOutput', () => {
  const result = TaskOutputTool.mapToolResultToToolResultBlockParam({
    retrieval_status: 'success',
    task: {
      task_id: 'expert-evidence-agent',
      task_type: 'local_agent',
      status: 'completed',
      description: 'Research external demand evidence',
      output: 'Evidence ledger complete.',
      toolAudit: { browserResearch: 3 },
    },
  } as never, 'toolu_task_output')

  expect(result.content).toContain('<tool-audit>')
  expect(result.content).toContain('BrowserResearch: 3')
})

test('does not invent a BrowserResearch audit for a legacy Agent TaskOutput', () => {
  const result = TaskOutputTool.mapToolResultToToolResultBlockParam({
    retrieval_status: 'success',
    task: {
      task_id: 'legacy-agent',
      task_type: 'local_agent',
      status: 'completed',
      description: 'Legacy agent task',
      output: 'Legacy output.',
    },
  } as never, 'toolu_task_output')

  expect(result.content).not.toContain('<tool-audit>')
})
