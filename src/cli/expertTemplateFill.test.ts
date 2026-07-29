import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { EXPERT_TEMPLATE_FILL_FORMAT } from '../utils/expertTemplateFill.js'
import { parseExpertTemplateFillCliArgs, runExpertTemplateFillCli } from './expertTemplateFill.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('expert-template-fill CLI', () => {
  test('parses the compact data and output arguments', () => {
    expect(parseExpertTemplateFillCliArgs(['--data', 'report-fields.json', '--output', 'final.html'])).toEqual({
      dataPath: 'report-fields.json',
      outputPath: 'final.html',
    })
    expect(() => parseExpertTemplateFillCliArgs(['--data', 'report-fields.json', '--output', 'final.txt'])).toThrow('.html')
    expect(() => parseExpertTemplateFillCliArgs(['--wat'])).toThrow('Unknown option')
  })

  test('submits compact fields to the current Expert session and writes rendered HTML', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'expert-template-fill-cli-'))
    roots.push(root)
    const dataPath = path.join(root, 'report-fields.json')
    const outputPath = path.join(root, 'nested', 'report.html')
    await fs.writeFile(dataPath, JSON.stringify({
      templateId: 'commercialization-research-classic-v1',
      fields: { REPORT_TITLE: 'AI 视频翻译' },
    }))
    let requestedUrl = ''
    let requestedBody: unknown

    const result = await runExpertTemplateFillCli(
      { dataPath, outputPath },
      {
        env: {
          CC_JIANGXIA_DESKTOP_SERVER_URL: 'http://127.0.0.1:61237',
          CC_JIANGXIA_EXPERT_SESSION_ID: 'session-123',
        },
        readFile: fs.readFile,
        mkdir: fs.mkdir,
        writeFile: fs.writeFile,
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          requestedUrl = String(url)
          requestedBody = JSON.parse(String(init?.body))
          return new Response(JSON.stringify({
            templateId: 'commercialization-research-classic-v1',
            content: '<html><body>固定母版</body></html>',
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }) as typeof fetch,
      },
    )

    expect(requestedUrl).toBe('http://127.0.0.1:61237/api/sessions/session-123/expert/template-fill')
    expect(requestedBody).toEqual({
      payload: {
        format: EXPERT_TEMPLATE_FILL_FORMAT,
        templateId: 'commercialization-research-classic-v1',
        fields: { REPORT_TITLE: 'AI 视频翻译' },
      },
    })
    expect(await fs.readFile(outputPath, 'utf8')).toBe('<html><body>固定母版</body></html>')
    expect(result).toEqual({
      outputPath: path.resolve(outputPath),
      templateId: 'commercialization-research-classic-v1',
      bytes: Buffer.byteLength('<html><body>固定母版</body></html>', 'utf8'),
    })
  })

  test('surfaces field validation returned by the bound template renderer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'expert-template-fill-cli-'))
    roots.push(root)
    const dataPath = path.join(root, 'report-fields.json')
    await fs.writeFile(dataPath, JSON.stringify({ templateId: 'classic-v1', fields: {} }))

    await expect(runExpertTemplateFillCli(
      { dataPath, outputPath: path.join(root, 'report.html') },
      {
        env: { DESKTOP_SERVER_URL: 'http://127.0.0.1:61237', EXPERT_SESSION_ID: 'session-123' },
        readFile: fs.readFile,
        mkdir: fs.mkdir,
        writeFile: fs.writeFile,
        fetch: (async () => new Response(JSON.stringify({ message: '专家模板字段校验未通过：缺少模板字段：REPORT_TITLE。' }), { status: 400 })) as typeof fetch,
      },
    )).rejects.toThrow('缺少模板字段：REPORT_TITLE')
  })
})
