import { describe, expect, test } from 'bun:test'
import {
  createExpertOutputTemplateWriteGuard,
  encodeExpertOutputTemplateWriteGuard,
  validateExpertOutputTemplateWrite,
} from './expertOutputTemplateGuard.js'

const template = `<!doctype html>
<html lang="zh-CN" data-template-id="classic-v1">
<head><style>body { color: #111; } table { width: 100%; }</style></head>
<body>
  <h2 id="section1">一、产品定义</h2>
  <table><thead><tr><th>功能</th><th>价值</th></tr></thead><tbody><!-- SLOT: ROWS --></tbody></table>
  <h2 id="sources">信息来源</h2>
  <p>{{SOURCE_NOTE}}</p>
</body>
</html>`

const validReport = `<!doctype html>
<html lang="zh-CN" data-template-id="classic-v1">
<head><style>body { color: #111; } table { width: 100%; }</style></head>
<body>
  <h2 id="section1">一、产品定义</h2>
  <table><thead><tr><th>功能</th><th>价值</th></tr></thead><tbody><tr><td>导入</td><td>节省时间</td></tr></tbody></table>
  <h2 id="sources">信息来源</h2>
  <p>用户提供的资料</p>
</body>
</html>`

function guardValue(): string {
  const guard = createExpertOutputTemplateWriteGuard('commercialization-research-report', 'templates/report.html', template)
  if (!guard) throw new Error('test template should create a guard')
  return encodeExpertOutputTemplateWriteGuard(guard)
}

describe('expert output template Write guard', () => {
  test('accepts an HTML report that preserves the fixed template and fills every slot', () => {
    expect(validateExpertOutputTemplateWrite('/tmp/report.html', validReport, guardValue())).toEqual({ valid: true })
  })

  test('rejects template drift with actionable reasons before Write runs', () => {
    const invalid = validReport
      .replace('body { color: #111; }', 'body { color: #222; }')
      .replace('一、产品定义', '一、全新章节')
      .replace('<th>功能</th><th>价值</th>', '<th>分数</th><th>功能</th>')

    const result = validateExpertOutputTemplateWrite('/tmp/report.html', invalid, guardValue())

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.message).toContain('CSS 与固定 HTML 母版不一致')
      expect(result.message).toContain('一级章节标题或顺序与固定母版不一致')
      expect(result.message).toContain('表格表头或表格顺序与固定母版不一致')
    }
  })

  test('rejects unresolved template slots but leaves non-HTML writes alone', () => {
    const unresolved = validReport.replace('用户提供的资料', '{{SOURCE_NOTE}}')
    const rejected = validateExpertOutputTemplateWrite('/tmp/report.html', unresolved, guardValue())

    expect(rejected.valid).toBe(false)
    if (!rejected.valid) expect(rejected.message).toContain('未填充的 {{...}} 槽位')
    expect(validateExpertOutputTemplateWrite('/tmp/notes.md', '# draft', guardValue())).toEqual({ valid: true })
  })
})
