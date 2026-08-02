import { describe, expect, test } from 'bun:test'

import {
  classifyRenderedResearchPage,
  extractSearchRelevanceTerms,
  filterRelevantSearchCandidates,
  isBrowserResearchAccessLimitedPage,
} from './browserResearchAssessment.js'

describe('BrowserResearch search assessment', () => {
  test('keeps only candidates with meaningful query relevance instead of accepting any rendered Bing result', () => {
    const candidates = [
      { text: 'MWeb - 专业的 Markdown 写作软件', url: 'https://zh.mweb.im/' },
      { text: 'Uolo Learn', url: 'https://learn.uolo.com/' },
      { text: 'Morse decoder', url: 'https://embed.morsedecoder.com/' },
    ]

    expect(filterRelevantSearchCandidates('MWeb Markdown 编辑器 官网 下载 iPhone iPad Mac', candidates))
      .toEqual([{ text: 'MWeb - 专业的 Markdown 写作软件', url: 'https://zh.mweb.im/' }])
  })

  test('does not accept a one-character Chinese overlap as a relevant result', () => {
    const candidates = [
      { text: '少 shǎo、shào - 漢典', url: 'https://www.zdic.net/hans/%E5%B0%91' },
      { text: '少数派：Markdown 编辑器推荐', url: 'https://sspai.com/post/123' },
    ]

    expect(filterRelevantSearchCandidates('少数派 markdown 编辑器 推荐', candidates))
      .toEqual([{ text: '少数派：Markdown 编辑器推荐', url: 'https://sspai.com/post/123' }])
    expect(extractSearchRelevanceTerms('少数派 markdown 编辑器 推荐')).toContain('少数派')
  })

  test('classifies CAPTCHA and App Store not-found pages as non-evidence', () => {
    expect(isBrowserResearchAccessLimitedPage('百度安全验证', '请完成下方验证后继续操作\n拖动左侧滑块使图片为正')).toBe(true)
    expect(isBrowserResearchAccessLimitedPage('Mac Markdown reader official - 搜索', '最后一步\n请解决以下难题以继续')).toBe(true)
    expect(classifyRenderedResearchPage(
      'https://apps.apple.com/cn/app/example/id123',
      'App Store',
      '无法找到你所需的页面。',
    )).toContain('TARGET_PAGE_UNAVAILABLE')
    expect(classifyRenderedResearchPage(
      'https://example.com/pricing',
      'Pricing',
      'Annual plan and feature comparison',
    )).toBeNull()
  })
})
