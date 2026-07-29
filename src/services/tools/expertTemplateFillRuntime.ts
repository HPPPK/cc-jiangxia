import { getJiangxiaEnvValue } from '../../utils/appIdentity.js'

export type ExpertTemplateFillWriteResult = { kind: 'not-template-fill' }

function isTemplateFillWriteSession(): boolean {
  return getJiangxiaEnvValue('EXPERT_TEMPLATE_FILL_WRITE')?.trim() === '1'
}

function isHtmlTarget(input: Record<string, unknown>): boolean {
  return typeof input.file_path === 'string' && /\.html?$/i.test(input.file_path.trim())
}

/**
 * Keep the shared Write tool generic. In a template-fill Expert session it can
 * create the compact fields JSON, but the final HTML must be rendered by the
 * expert-template-fill CLI against the session-bound template.
 */
export async function renderExpertTemplateFillForWrite(input: Record<string, unknown>): Promise<ExpertTemplateFillWriteResult> {
  if (!isTemplateFillWriteSession() || !isHtmlTarget(input)) return { kind: 'not-template-fill' }
  if (input.expert_output !== undefined) {
    throw new Error('EXPERT_TEMPLATE_FILL_REJECTED: The former Write.expert_output delivery is no longer used. Write a compact report-fields.json file, then run the expert-template-fill CLI to render the fixed HTML template.')
  }
  throw new Error('EXPERT_TEMPLATE_FILL_REJECTED: This Expert does not write final HTML through Write. Use Write only for report-fields.json, then run "$CLAUDE_CLI_PATH" expert-template-fill --data "<report-fields.json>" --output "<final-report.html>". The CLI validates fields and fills the session-bound fixed template.')
}
