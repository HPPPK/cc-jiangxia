import { extname } from 'node:path'

export const EXPERT_OUTPUT_TEMPLATE_GUARD_ENV = 'CC_JIANGXIA_EXPERT_OUTPUT_TEMPLATE_GUARD'

export type ExpertOutputTemplateWriteGuard = {
  version: 1
  expertId: string
  templatePath: string
  templateId: string
  styleContent: string
  anchorIds: string[]
  h2Headings: string[]
  tableHeaderSignatures: string[]
}

export type ExpertOutputTemplateValidation =
  | { valid: true }
  | { valid: false; message: string }

function normalize(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

function textContent(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function matches(content: string, expression: RegExp): string[] {
  return [...content.matchAll(expression)].map((match) => match[1] ?? '')
}

function firstMatch(content: string, expression: RegExp): string | null {
  return content.match(expression)?.[1] ?? null
}

export function createExpertOutputTemplateWriteGuard(
  expertId: string,
  templatePath: string,
  templateContent: string,
): ExpertOutputTemplateWriteGuard | null {
  const templateId = firstMatch(templateContent, /<html\b[^>]*\bdata-template-id\s*=\s*["']([^"']+)["']/i)
  const styleContent = firstMatch(templateContent, /<style\b[^>]*>([\s\S]*?)<\/style>/i)
  const anchorIds = matches(templateContent, /\bid\s*=\s*["']([^"']+)["']/gi)
  const h2Headings = matches(templateContent, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi).map(textContent)
  const tableHeaderSignatures = matches(templateContent, /<thead\b[^>]*>([\s\S]*?)<\/thead>/gi)
    .map((thead) => matches(thead, /<th\b[^>]*>([\s\S]*?)<\/th>/gi).map(textContent).join('|'))

  if (!templateId || styleContent === null || anchorIds.length === 0 || h2Headings.length === 0 || tableHeaderSignatures.length === 0) {
    return null
  }

  return {
    version: 1,
    expertId,
    templatePath,
    templateId,
    styleContent: normalize(styleContent),
    anchorIds,
    h2Headings,
    tableHeaderSignatures,
  }
}

export function encodeExpertOutputTemplateWriteGuard(guard: ExpertOutputTemplateWriteGuard): string {
  return Buffer.from(JSON.stringify(guard), 'utf8').toString('base64url')
}

export function decodeExpertOutputTemplateWriteGuard(value: string | undefined): ExpertOutputTemplateWriteGuard | null {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ExpertOutputTemplateWriteGuard>
    if (
      parsed.version !== 1 ||
      typeof parsed.expertId !== 'string' ||
      typeof parsed.templatePath !== 'string' ||
      typeof parsed.templateId !== 'string' ||
      typeof parsed.styleContent !== 'string' ||
      !Array.isArray(parsed.anchorIds) ||
      !Array.isArray(parsed.h2Headings) ||
      !Array.isArray(parsed.tableHeaderSignatures)
    ) return null
    return parsed as ExpertOutputTemplateWriteGuard
  } catch {
    return null
  }
}

export function validateExpertOutputTemplateWrite(
  filePath: string,
  content: string,
  encodedGuard = process.env[EXPERT_OUTPUT_TEMPLATE_GUARD_ENV],
): ExpertOutputTemplateValidation {
  const guard = decodeExpertOutputTemplateWriteGuard(encodedGuard)
  if (!guard || !/\.html?$/i.test(extname(filePath))) return { valid: true }

  const issues: string[] = []
  const actualTemplateId = firstMatch(content, /<html\b[^>]*\bdata-template-id\s*=\s*["']([^"']+)["']/i)
  if (actualTemplateId !== guard.templateId) {
    issues.push(`缺少或改动了 data-template-id="${guard.templateId}"`)
  }

  const actualStyle = firstMatch(content, /<style\b[^>]*>([\s\S]*?)<\/style>/i)
  if (actualStyle === null || normalize(actualStyle) !== guard.styleContent) {
    issues.push('CSS 与固定 HTML 母版不一致')
  }

  const actualAnchors = matches(content, /\bid\s*=\s*["']([^"']+)["']/gi)
  if (guard.anchorIds.some((anchor, index) => actualAnchors[index] !== anchor)) {
    issues.push(`章节锚点必须按母版保留：${guard.anchorIds.join('、')}`)
  }

  const actualH2 = matches(content, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi).map(textContent)
  if (guard.h2Headings.some((heading, index) => actualH2[index] !== heading)) {
    issues.push('一级章节标题或顺序与固定母版不一致')
  }

  const actualHeaderSignatures = matches(content, /<thead\b[^>]*>([\s\S]*?)<\/thead>/gi)
    .map((thead) => matches(thead, /<th\b[^>]*>([\s\S]*?)<\/th>/gi).map(textContent).join('|'))
  if (guard.tableHeaderSignatures.some((signature, index) => actualHeaderSignatures[index] !== signature)) {
    issues.push('至少一个表格表头或表格顺序与固定母版不一致')
  }

  if (/\{\{[^}]+\}\}/.test(content) || /<!--\s*SLOT:/i.test(content)) {
    issues.push('仍有未填充的 {{...}} 槽位或 SLOT 注释')
  }

  if (issues.length === 0) return { valid: true }
  return {
    valid: false,
    message: `固定 HTML 母版校验未通过（${guard.expertId}）：${issues.join('；')}。请从已注入的母版复制后，仅替换槽位内容再调用 Write。`,
  }
}
