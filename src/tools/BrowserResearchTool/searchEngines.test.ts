import { describe, expect, test } from 'bun:test'
import {
  buildBrowserResearchSearchQueryUrl,
  buildBrowserResearchSearchStartUrl,
  getBrowserResearchSearchEngineConfig,
} from './searchEngines.js'

describe('BrowserResearch search engines', () => {
  test('keeps Bing as the backward-compatible default search engine', () => {
    expect(buildBrowserResearchSearchStartUrl()).toBe('https://www.bing.com/')
    expect(buildBrowserResearchSearchStartUrl({ market: 'CN', locale: 'zh-CN' }))
      .toBe('https://www.bing.com/?cc=cn&setlang=zh-CN')
  })

  test('builds explicit Google discovery URLs with only requested locale and market hints', () => {
    expect(buildBrowserResearchSearchStartUrl({ searchEngine: 'google', market: 'US', locale: 'en-US' }))
      .toBe('https://www.google.com/?gl=us&hl=en-US')
    expect(buildBrowserResearchSearchQueryUrl({ searchEngine: 'google', query: 'markdown reader mac' }))
      .toBe('https://www.google.com/search?q=markdown+reader+mac')
  })

  test('uses the actual Baidu and 360 public domains instead of silently falling back to Bing', () => {
    expect(buildBrowserResearchSearchQueryUrl({ searchEngine: 'baidu', query: 'Markdown 阅读器' }))
      .toBe('https://www.baidu.com/s?wd=Markdown+%E9%98%85%E8%AF%BB%E5%99%A8')
    expect(buildBrowserResearchSearchQueryUrl({ searchEngine: '360', query: 'Markdown 阅读器' }))
      .toBe('https://www.so.com/s?q=Markdown+%E9%98%85%E8%AF%BB%E5%99%A8')
    expect(getBrowserResearchSearchEngineConfig('baidu').organicResultLinkSelector).toContain('#content_left')
    expect(getBrowserResearchSearchEngineConfig('360').organicResultLinkSelector).toContain('res-title')
  })
  test('provides a Google-only consent selector without changing the other engine configurations', () => {
    expect(getBrowserResearchSearchEngineConfig('google').consentButtonSelector).toContain('#L2AGLb')
    expect(getBrowserResearchSearchEngineConfig('bing').consentButtonSelector).toBeUndefined()
    expect(getBrowserResearchSearchEngineConfig('baidu').consentButtonSelector).toBeUndefined()
    expect(getBrowserResearchSearchEngineConfig('360').consentButtonSelector).toBeUndefined()
  })

})
