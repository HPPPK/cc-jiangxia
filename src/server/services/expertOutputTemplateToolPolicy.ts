import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { validateExpertOutputTemplateWrite } from '../../utils/expertOutputTemplateGuard.js'

export function getExpertOutputTemplateToolPolicyViolation(
  toolName: string,
  input: Record<string, unknown>,
  encodedGuard?: string,
): string | null {
  if (toolName !== FILE_WRITE_TOOL_NAME) return null

  const filePath = input.file_path
  const content = input.content
  if (typeof filePath !== 'string' || typeof content !== 'string') return null

  const validation = validateExpertOutputTemplateWrite(filePath, content, encodedGuard)
  if (validation.valid) return null

  return `EXPERT_OUTPUT_TEMPLATE_REJECTED: ${validation.message}`
}
