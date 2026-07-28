import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { FileWriteTool } from './FileWriteTool.js'

describe('FileWriteTool stays generic', () => {
  test('accepts ordinary HTML without any Expert-specific template policy', async () => {
    const result = await FileWriteTool.validateInput(
      { file_path: 'C:/tmp/commercial-report.html', content: '<html><body>draft</body></html>' },
      {
        getAppState: () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), mode: 'acceptEdits' } }),
        readFileState: new Map(),
      } as unknown as ToolUseContext,
    )

    expect(result).toEqual({ result: true })
  })
})
