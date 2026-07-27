import { describe, expect, test } from 'bun:test'
import {
  createExpertOutputTemplateWriteGuard,
  encodeExpertOutputTemplateWriteGuard,
} from '../../utils/expertOutputTemplateGuard.js'
import { getExpertOutputTemplateToolPolicyViolation } from './expertOutputTemplateToolPolicy.js'

const template = '<html data-template-id="classic"><head><style>body{color:#111}</style></head><body><h2 id="section1">一、产品</h2><table><thead><tr><th>字段</th></tr></thead></table><h2 id="sources">来源</h2></body></html>'

describe('Expert output template tool policy', () => {
  test('only rejects an HTML Write that drifts from this Expert session template', () => {
    const guard = createExpertOutputTemplateWriteGuard('commercialization-research-report', 'templates/report.html', template)
    if (!guard) throw new Error('test template should create a guard')
    const encodedGuard = encodeExpertOutputTemplateWriteGuard(guard)
    const driftingReport = template.replace('color:#111', 'color:#222')

    expect(getExpertOutputTemplateToolPolicyViolation('Write', { file_path: '/tmp/report.html', content: driftingReport }, encodedGuard)).toContain('EXPERT_OUTPUT_TEMPLATE_REJECTED')
    expect(getExpertOutputTemplateToolPolicyViolation('Bash', { command: 'echo ok' }, encodedGuard)).toBeNull()
    expect(getExpertOutputTemplateToolPolicyViolation('Write', { file_path: '/tmp/report.html', content: template }, encodedGuard)).toBeNull()
  })
})
