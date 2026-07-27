import { afterEach, describe, expect, test } from 'bun:test'
import {
  createExpertOutputTemplateWriteGuard,
  encodeExpertOutputTemplateWriteGuard,
  EXPERT_OUTPUT_TEMPLATE_GUARD_ENV,
} from '../../utils/expertOutputTemplateGuard.js'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { FileWriteTool } from './FileWriteTool.js'

const template = '<html data-template-id="classic"><head><style>body{color:#111}</style></head><body><h2 id="section1">一、产品</h2><table><thead><tr><th>字段</th></tr></thead></table><h2 id="sources">来源</h2></body></html>'
const driftingReport = '<html data-template-id="classic"><head><style>body{color:#222}</style></head><body><h2 id="section1">一、产品</h2><table><thead><tr><th>字段</th></tr></thead></table><h2 id="sources">来源</h2></body></html>'
const previousGuard = process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV]

afterEach(() => {
  if (previousGuard === undefined) delete process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV]
  else process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV] = previousGuard
})

describe('FileWriteTool stays generic when Expert output policy is active', () => {
  test('does not apply an Expert HTML template rule inside the shared Write tool', async () => {
    const guard = createExpertOutputTemplateWriteGuard('commercialization-research-report', 'templates/report.html', template)
    if (!guard) throw new Error('test template should create a guard')
    process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV] = encodeExpertOutputTemplateWriteGuard(guard)

    const result = await FileWriteTool.validateInput(
      { file_path: 'C:/tmp/commercial-report.html', content: driftingReport },
      {
        getAppState: () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), mode: 'acceptEdits' } }),
        readFileState: new Map(),
      } as unknown as ToolUseContext,
    )

    expect(result).toEqual({ result: true })
  })
})
