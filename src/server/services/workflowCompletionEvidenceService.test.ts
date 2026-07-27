import { expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { collectRuntimeVerifiedOutputEvidence, getRuntimeResolvableAnsweredIssueIds } from './workflowCompletionEvidenceService.js'
import { rebuildWorkflowCompletionContract, recordAskUserQuestionAnswer, recordAskUserQuestionIssue } from './workflowCompletionGate.js'
import type { WorkflowSessionState, WorkflowTemplate } from './workflowTypes.js'

function stateFor(workspaceRoot: string): WorkflowSessionState {
  return {
    schemaVersion: 1,
    sessionId: 'session-evidence-test',
    mode: 'workflow',
    workspaceRoot,
    activePhaseId: 'planning',
    activeWorkflowRunId: 'run-001',
    labels: ['new-product'],
    stateVersion: 1,
    revision: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    phases: [{ id: 'planning', index: 0, status: 'running', artifactPointers: [] }],
    phaseRuns: [{
      phaseId: 'planning',
      index: 0,
      status: 'running',
      startedAt: null,
      completedAt: null,
      instructionsProvenance: { templateId: 'test-template', templateVersion: '1', phaseId: 'planning' },
      inputArtifactRefs: [],
      outputArtifactRefs: [],
      completionChecks: [],
      modelResolution: null,
      skillProvenance: [],
      blockedReason: null,
    }],
    artifactIndex: [],
    template: {
      schemaVersion: 1,
      id: 'test-template',
      source: 'user',
      version: '1',
      displayName: 'Test',
      description: 'Test',
      registryKey: 'user:test-template',
      phases: [{
        id: 'planning',
        label: 'Planning',
        instructions: 'Write declared workflow outputs.',
        skills: [],
        skillDeclarations: [],
        requiredArtifacts: [],
        completionCriteria: [],
        transitionAuthority: 'user-confirmation',
        evidencePolicy: {
          outputArtifact: { id: 'planning-output', name: 'Planning output', description: 'All declared planning files.', required: true },
          requiredArtifacts: [],
          completionCriteria: { type: 'manual-checklist', description: 'test' },
          handoffRules: [],
        },
        outputArtifacts: [
          { id: 'context', filename: '.workflow/project-context.md', kind: 'markdown', required: true },
          { id: 'run-plan', filename: '.workflow/runs/<runId>/plan.md', kind: 'markdown', required: true },
        ],
      }],
    },
  } as WorkflowSessionState
}

test('collects only declared current-phase .workflow files as auditable runtime evidence', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-runtime-evidence-'))
  try {
    await fs.mkdir(path.join(workspaceRoot, '.workflow', 'runs', 'run-001'), { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, '.workflow', 'project-context.md'), '# Context\n', 'utf8')
    await fs.writeFile(path.join(workspaceRoot, '.workflow', 'runs', 'run-001', 'plan.md'), '# Plan\n', 'utf8')
    await fs.writeFile(path.join(workspaceRoot, 'unrelated.md'), '# Not workflow evidence\n', 'utf8')

    const written: unknown[] = []
    const state = stateFor(workspaceRoot)
    const result = await collectRuntimeVerifiedOutputEvidence({
      sessionId: state.sessionId,
      state,
      workspaceRoot,
      requestedAt: '2026-07-24T00:01:00.000Z',
      stateService: {
        async writePhaseArtifact(_sessionId: string, artifact: unknown) {
          written.push(artifact)
          const record = artifact as { artifactId: string; sessionId: string; schemaVersion: number; createdAt: string; title: string }
          return {
            artifact: artifact as never,
            pointer: {
              kind: 'phase-artifact' as const,
              sessionId: record.sessionId,
              artifactId: record.artifactId,
              schemaVersion: record.schemaVersion,
              createdAt: record.createdAt,
              label: record.title,
            },
          }
        },
      } as never,
    })

    expect(result?.phaseId).toBe('planning')
    expect(result?.evidenceOutputArtifactId).toBe('planning-output')
    expect([...result!.outputPointersById.keys()]).toEqual(['context', 'run-plan'])
    expect(written).toHaveLength(2)
    expect((written[0] as { content: { workspaceRelativePath: string } }).content.workspaceRelativePath).toBe('.workflow/project-context.md')
    expect((written[1] as { content: { workspaceRelativePath: string } }).content.workspaceRelativePath).toBe('.workflow/runs/run-001/plan.md')
    expect(result?.state.artifactIndex).toHaveLength(2)
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('fails closed when a required declared workflow output is absent', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-runtime-evidence-'))
  try {
    await fs.mkdir(path.join(workspaceRoot, '.workflow'), { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, '.workflow', 'project-context.md'), '# Context\n', 'utf8')
    const state = stateFor(workspaceRoot)
    const result = await collectRuntimeVerifiedOutputEvidence({
      sessionId: state.sessionId,
      state,
      workspaceRoot,
      requestedAt: '2026-07-24T00:01:00.000Z',
      stateService: { async writePhaseArtifact() { throw new Error('must not persist partial evidence') } } as never,
    })
    expect(result).toBeNull()
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})


async function collectForAnsweredIssue(input: {
  workspaceRoot: string
  answerAt: string
  requestedAt: string
}): Promise<ReturnType<typeof collectRuntimeVerifiedOutputEvidence> extends Promise<infer Result> ? Result : never> {
  let state = stateFor(input.workspaceRoot)
  state = rebuildWorkflowCompletionContract(state, state.template as WorkflowTemplate, input.answerAt, 'Prepared current phase completion contract.')
  state = recordAskUserQuestionIssue(state, {
    requestId: 'question-after-output',
    questions: [{ id: 'framing', question: 'Use the proposed framing?' }],
    now: input.answerAt,
  })
  state = recordAskUserQuestionAnswer(state, {
    requestId: 'question-after-output',
    answers: { framing: 'Use the proposed framing.' },
    now: input.answerAt,
  })
  return await collectRuntimeVerifiedOutputEvidence({
    sessionId: state.sessionId,
    state,
    workspaceRoot: input.workspaceRoot,
    requestedAt: input.requestedAt,
    stateService: {
      async writePhaseArtifact(_sessionId: string, artifact: unknown) {
        const record = artifact as { artifactId: string; sessionId: string; schemaVersion: number; createdAt: string; title: string }
        return {
          artifact: artifact as never,
          pointer: {
            kind: 'phase-artifact' as const,
            sessionId: record.sessionId,
            artifactId: record.artifactId,
            schemaVersion: record.schemaVersion,
            createdAt: record.createdAt,
            label: record.title,
          },
        }
      },
    } as never,
  })
}

test('does not resolve an answered blocking question from files that predate its answer or from an unrelated file', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-runtime-evidence-'))
  try {
    const answerAt = '2026-07-24T00:01:00.000Z'
    const beforeAnswer = new Date('2026-07-24T00:00:00.000Z')
    await fs.mkdir(path.join(workspaceRoot, '.workflow', 'runs', 'run-001'), { recursive: true })
    const contextPath = path.join(workspaceRoot, '.workflow', 'project-context.md')
    const planPath = path.join(workspaceRoot, '.workflow', 'runs', 'run-001', 'plan.md')
    await fs.writeFile(contextPath, '# Context before answer\n', 'utf8')
    await fs.writeFile(planPath, '# Plan before answer\n', 'utf8')
    await fs.utimes(contextPath, beforeAnswer, beforeAnswer)
    await fs.utimes(planPath, beforeAnswer, beforeAnswer)
    await fs.writeFile(path.join(workspaceRoot, 'unrelated.md'), '# Changed after answer\n', 'utf8')

    const result = await collectForAnsweredIssue({ workspaceRoot, answerAt, requestedAt: '2026-07-24T00:03:00.000Z' })
    expect(result).not.toBeNull()
    expect(getRuntimeResolvableAnsweredIssueIds(result!.state, result!)).toEqual([])
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('resolves an answered blocking question when verified post-answer work exists without rewriting pre-execution planning artifacts', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-runtime-evidence-'))
  try {
    const answerAt = '2026-07-24T00:01:00.000Z'
    const beforeAnswer = new Date('2026-07-24T00:00:00.000Z')
    const afterAnswer = new Date('2026-07-24T00:02:00.000Z')
    await fs.mkdir(path.join(workspaceRoot, '.workflow', 'runs', 'run-001'), { recursive: true })
    const contextPath = path.join(workspaceRoot, '.workflow', 'project-context.md')
    const planPath = path.join(workspaceRoot, '.workflow', 'runs', 'run-001', 'plan.md')
    await fs.writeFile(contextPath, '# Context applied after answer\n', 'utf8')
    await fs.writeFile(planPath, '# Plan still before answer\n', 'utf8')
    await fs.utimes(contextPath, afterAnswer, afterAnswer)
    await fs.utimes(planPath, beforeAnswer, beforeAnswer)

    const partial = await collectForAnsweredIssue({ workspaceRoot, answerAt, requestedAt: '2026-07-24T00:03:00.000Z' })
    expect(partial).not.toBeNull()
    expect(getRuntimeResolvableAnsweredIssueIds(partial!.state, partial!)).toEqual(['ask:question-after-output:0'])
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('does not resolve an answered question when the evidence belongs to a no-longer-active phase', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-jiangxia-runtime-evidence-'))
  try {
    const answerAt = '2026-07-24T00:01:00.000Z'
    const afterAnswer = new Date('2026-07-24T00:02:00.000Z')
    await fs.mkdir(path.join(workspaceRoot, '.workflow', 'runs', 'run-001'), { recursive: true })
    const contextPath = path.join(workspaceRoot, '.workflow', 'project-context.md')
    const planPath = path.join(workspaceRoot, '.workflow', 'runs', 'run-001', 'plan.md')
    await fs.writeFile(contextPath, '# Context after answer\n', 'utf8')
    await fs.writeFile(planPath, '# Plan after answer\n', 'utf8')
    await fs.utimes(contextPath, afterAnswer, afterAnswer)
    await fs.utimes(planPath, afterAnswer, afterAnswer)

    const result = await collectForAnsweredIssue({ workspaceRoot, answerAt, requestedAt: '2026-07-24T00:03:00.000Z' })
    expect(result).not.toBeNull()
    expect(getRuntimeResolvableAnsweredIssueIds({ ...result!.state, activePhaseId: 'other-phase' }, result!)).toEqual([])
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})
