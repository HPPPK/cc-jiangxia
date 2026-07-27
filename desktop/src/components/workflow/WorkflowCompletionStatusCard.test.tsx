// @vitest-environment jsdom
// @ts-expect-error jsdom is installed in this workspace without local type declarations
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowSessionSummary } from '../../types/session'

if (typeof document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  const { window } = dom
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
}

const { act, fireEvent, render, screen } = await import('@testing-library/react')
await import('@testing-library/jest-dom/vitest')
const { WorkflowCompletionStatusCard } = await import('./WorkflowCompletionStatusCard')

function workflow(overrides: Partial<WorkflowSessionSummary> = {}): WorkflowSessionSummary {
  return {
    mode: 'workflow',
    templateId: 'generic-completion-contract',
    templateVersion: '1',
    templateSource: 'builtin',
    templateSnapshotId: 'fixture',
    status: 'running',
    activePhaseId: 'analysis',
    activePhaseIndex: 0,
    phaseCount: 1,
    stateVersion: 7,
    pendingConfirmation: false,
    statePointer: { kind: 'workflow-state', sessionId: 'test', artifactId: 'state', schemaVersion: 1, createdAt: '2026-07-23T00:00:00.000Z' },
    completion: {
      migrationStatus: 'needs-rebuild',
      phaseId: 'analysis',
      eligibility: 'ineligible',
      workStatus: 'in-progress',
      blockerReasons: ['Workflow state must be rebuilt and re-evaluated after migration.'],
      issues: [{
        id: 'ask:1:0',
        status: 'answered-pending-processing',
        blocksCompletion: true,
        question: 'Which option should the phase use?',
        blockingReason: 'A workflow question requires explicit processing.',
      }],
      artifactRequirements: [{ id: 'decision-record', required: true, status: 'pending', artifactIds: [], updatedAt: '2026-07-23T00:00:00.000Z' }],
      checks: [{ id: 'completion-criteria:0', required: true, status: 'pending', evidenceArtifactIds: [], updatedAt: '2026-07-23T00:00:00.000Z' }],
    },
    ...overrides,
  }
}

describe('WorkflowCompletionStatusCard', () => {
  it('requires an explicit rationale before rebuilding a migrated completion contract', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowCompletionStatusCard workflow={workflow()} onUpdate={onUpdate} />)

    const rebuild = screen.getByRole('button', { name: '重建并重新评估' })
    expect(rebuild).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('说明已核实的工作、证据或问题处理结果'), {
      target: { value: 'Verified the current phase inputs before rebuilding.' },
    })
    await act(async () => { fireEvent.click(rebuild) })

    expect(onUpdate).toHaveBeenCalledWith({
      type: 'rebuild',
      actor: 'user',
      rationale: 'Verified the current phase inputs before rebuilding.',
    })
  })

  it('keeps a answered question visible and sends an explicit processing decision', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowCompletionStatusCard workflow={workflow({
      completion: {
        ...workflow().completion!,
        migrationStatus: 'current',
      },
    })} onUpdate={onUpdate} />)

    expect(screen.getByText('Which option should the phase use?')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('说明已核实的工作、证据或问题处理结果'), {
      target: { value: 'Applied the selected option to the decision record.' },
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认已处理' })) })

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'process-issue',
      actor: 'user',
      issueId: 'ask:1:0',
      status: 'resolved',
      rationale: 'Applied the selected option to the decision record.',
    }))
  })

  it('summarizes internal runtime blockers instead of rendering raw diagnostics', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowCompletionStatusCard workflow={workflow({
      completion: {
        ...workflow().completion!,
        migrationStatus: 'current',
        blockerReasons: [
          'Phase work is not ready for completion review.',
          'Required artifact is not verified: decision-record',
          'Required completion check is not passed: completion-criteria:0',
        ],
        artifactRequirements: [{
          id: 'decision-record',
          required: true,
          description: 'Internal contract text that should not be presented as normal workflow content.',
          status: 'pending',
          artifactIds: [],
          updatedAt: '2026-07-24T00:00:00.000Z',
        }],
        checks: [{
          id: 'completion-criteria:0',
          required: true,
          description: 'Internal completion criteria text that should stay out of the user-facing summary.',
          status: 'pending',
          evidenceArtifactIds: [],
          updatedAt: '2026-07-24T00:00:00.000Z',
        }],
      },
    })} onUpdate={onUpdate} />)

    const completionCard = screen.getByTestId('workflow-completion-status-card')
    expect(completionCard).toHaveTextContent('当前阶段尚未标记为可复核。')
    expect(completionCard).toHaveTextContent('当前阶段还需要登记并验证工作证据。')
    expect(completionCard).toHaveTextContent('当前阶段的完成核验尚未记录通过。')
    expect(completionCard).toHaveTextContent('阶段工作证据')
    expect(completionCard).toHaveTextContent('阶段完成核验')
    expect(completionCard).not.toHaveTextContent(/Required artifact is not verified/i)
    expect(completionCard).not.toHaveTextContent(/Internal contract text/i)
  })
})
