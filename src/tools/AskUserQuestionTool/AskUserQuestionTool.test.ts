import { describe, expect, test } from 'bun:test'
import type { Tool } from '../../Tool.js'

async function loadTool(): Promise<Tool> {
  const mod = await import('./AskUserQuestionTool.js') as { AskUserQuestionTool?: Tool }
  if (!mod.AskUserQuestionTool) throw new Error('AskUserQuestionTool export is required')
  return mod.AskUserQuestionTool
}

describe('AskUserQuestionTool workflow contract', () => {
  test('requires the top-level questions array so malformed calls remain retryable tool errors', async () => {
    const tool = await loadTool()
    expect(tool.inputSchema.safeParse({}).success).toBe(false)
  })

  test('accepts explicit workflow completion blocking semantics without adding a new tool', async () => {
    const tool = await loadTool()
    expect(tool.inputSchema.safeParse({
      questions: [{
        id: 'status-preference',
        prompt: 'How much status detail would you like?',
        blocksCompletion: false,
        choices: [{ id: 'brief', label: 'Brief summary' }, { id: 'detailed', label: 'Detailed summary' }],
      }],
    }).success).toBe(true)
  })

  test('rejects workflow commands in question options so Ask can only return an answer to the current phase', async () => {
    const tool = await loadTool()
    const base = {
      questions: [{
        id: 'confirm-next-action',
        prompt: 'What should be adjusted?',
        choices: [{ id: 'adjust', label: 'Adjust current work' }, { id: 'continue', label: 'Continue current work' }],
      }],
    }
    expect(tool.inputSchema.safeParse(base).success).toBe(true)
    expect(tool.inputSchema.safeParse({
      ...base,
      questions: [{
        ...base.questions[0],
        choices: [{ id: 'illegal-route', label: 'Go next', action: 'advance_phase' }, base.questions[0].choices[1]],
      }],
    }).success).toBe(false)
    expect(tool.inputSchema.safeParse({
      ...base,
      questions: [{
        ...base.questions[0],
        choices: [{ id: 'illegal-jump', label: 'Jump', targetPhaseId: 'delegate-implement' }, base.questions[0].choices[1]],
      }],
    }).success).toBe(false)
  })

  test('retains ordinary legacy question/options calls without workflow actions', async () => {
    const tool = await loadTool()
    expect(tool.inputSchema.safeParse({
      questions: [{ question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    }).success).toBe(true)
  })
})
