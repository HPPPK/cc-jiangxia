import { getJiangxiaEnvValue } from '../../utils/appIdentity.js'
import { parseExpertTemplateFillPayload } from '../../utils/expertTemplateFill.js'

export type ExpertTemplateFillWriteResult =
  | { kind: 'not-template-fill' }
  | { kind: 'rendered'; content: string; templateId: string }

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown; error?: unknown }
    if (typeof body.message === 'string' && body.message.trim()) return body.message
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Fall through to the response status below.
  }
  return `Desktop Expert template renderer returned HTTP ${response.status}.`
}

export async function renderExpertTemplateFillForWrite(input: Record<string, unknown>): Promise<ExpertTemplateFillWriteResult> {
  const content = input.content
  if (typeof content !== 'string') return { kind: 'not-template-fill' }
  const payload = parseExpertTemplateFillPayload(content)
  if (!payload) return { kind: 'not-template-fill' }

  const desktopServerUrl = getJiangxiaEnvValue('DESKTOP_SERVER_URL')?.trim()
  const sessionId = getJiangxiaEnvValue('EXPERT_SESSION_ID')?.trim()
  if (!desktopServerUrl || !sessionId) {
    throw new Error('EXPERT_TEMPLATE_FILL_REJECTED: 当前 Write 没有绑定模板填充专家会话。请重新进入该专家后再输出正式报告。')
  }

  let response: Response
  try {
    response = await fetch(`${desktopServerUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(sessionId)}/expert/template-fill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    })
  } catch (error) {
    throw new Error(`EXPERT_TEMPLATE_FILL_REJECTED: 无法连接本地专家模板渲染服务：${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    throw new Error(`EXPERT_TEMPLATE_FILL_REJECTED: ${await responseMessage(response)}`)
  }
  const body = await response.json() as { content?: unknown; templateId?: unknown }
  if (typeof body.content !== 'string' || !body.content.trim() || typeof body.templateId !== 'string' || !body.templateId.trim()) {
    throw new Error('EXPERT_TEMPLATE_FILL_REJECTED: 本地专家模板渲染服务返回了无效结果。')
  }
  return { kind: 'rendered', content: body.content, templateId: body.templateId }
}
