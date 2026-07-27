import { afterEach, describe, expect, test } from 'bun:test'
import {
  createExpertOutputTemplateWriteGuard,
  encodeExpertOutputTemplateWriteGuard,
  EXPERT_OUTPUT_TEMPLATE_GUARD_ENV,
} from '../../utils/expertOutputTemplateGuard.js'
import type { ToolUseContext } from '../../Tool.js'
import { FileWriteTool } from './FileWriteTool.js'

const template = '<html data-template-id="classic"><head><style>body{color:#111}</style></head><body><h2 id="section1">一、产品</h2><table><thead><tr><th>字段</th></tr></thead></table><h2 id="sources">来源</h2></body></html>'
const invalidReport = '<html data-template-id="classic"><head><style>body{color:#222}</style></head><body><h2 id="section1">一、产品</h2><table><thead><tr><th>字段</th></tr></thead></table><h2 id="sources">来源</h2></body></html>'
const previousGuard = process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV]

afterEach(() => {
  if (previousGuard === undefined) delete process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV]
  else process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV] = previousGuard
})

describe('FileWriteTool expert template guard', () => {
  test('rejects a drifting commercial-report HTML before filesystem access', async () => {
    const guard = createExpertOutputTemplateWriteGuard('commercialization-research-report', 'templates/report.html', template)
    if (!guard) throw new Error('test template should create a guard')
    process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV] = encodeExpertOutputTemplateWriteGuard(guard)

    const result = await FileWriteTool.validateInput(
      { file_path: 'C:/tmp/commercial-report.html', content: invalidReport },
      {} as ToolUseContext,
    )

    expect(result).toMatchObject({
      result: false,
      message: expect.stringContaining('CSS 与固定 HTML 母版不一致'),
    })
  })
})
