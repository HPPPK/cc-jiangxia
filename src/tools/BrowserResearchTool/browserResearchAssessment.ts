export type BrowserResearchCandidate = {
  text: string
  url: string
}

const QUERY_STOP_TERMS = new Set([
  'official', 'site', 'website', 'download', 'price', 'pricing', 'review', 'best',
  '官网', '下载', '价格', '推荐', '对比', '排行', '排名', '软件', '工具', '编辑器', '应用',
])
const CONTEXT_ONLY_TERMS = new Set([
  'mac', 'windows', 'ios', 'ipad', 'iphone', 'android', 'app', 'web', 'pc', 'ai',
  '电脑', '桌面', '移动', '国内', '国外', '中国', '英文', '中文',
])

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function chineseSearchTerms(value: string): string[] {
  const terms = new Set<string>()
  for (const run of value.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    terms.add(run)
    const maxLength = Math.min(run.length, 4)
    for (let length = 2; length <= maxLength; length++) {
      for (let index = 0; index <= run.length - length; index++) {
        terms.add(run.slice(index, index + length))
      }
    }
  }
  return [...terms]
}

/** Extracts meaningful, query-derived terms without product-specific hard-coding. */
export function extractSearchRelevanceTerms(query: string): string[] {
  const normalized = normalizeComparableText(query)
  const terms = new Set([
    ...(normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) ?? []),
    ...chineseSearchTerms(normalized),
  ])
  return [...terms]
    .filter((term) => term.length >= 2)
    .filter((term) => !QUERY_STOP_TERMS.has(term))
}

function matchingSearchTerms(query: string, candidate: BrowserResearchCandidate): string[] {
  const candidateText = normalizeComparableText(`${candidate.text} ${candidate.url}`)
  return extractSearchRelevanceTerms(query).filter((term) => candidateText.includes(term))
}

/**
 * Keeps only rendered Bing result links that bear a meaningful relation to the query.
 * A loaded search page is not a usable discovery result if every candidate is unrelated.
 */
export function filterRelevantSearchCandidates(
  query: string,
  candidates: BrowserResearchCandidate[],
): BrowserResearchCandidate[] {
  const terms = extractSearchRelevanceTerms(query)
  const strongTerms = terms.filter((term) => !CONTEXT_ONLY_TERMS.has(term))

  if (terms.length === 0) return candidates

  return candidates.filter((candidate) => {
    const matches = matchingSearchTerms(query, candidate)
    if (strongTerms.length > 0) {
      return matches.some((term) => strongTerms.includes(term))
    }
    return matches.length >= Math.min(2, terms.length)
  })
}

export function isBrowserResearchAccessLimitedPage(title: string, text: string): boolean {
  const renderedPage = `${title}\n${text}`
  if (/access denied|forbidden|captcha|verify you are human|unusual traffic|automated queries|robots|rate limit|too many requests|\b403\b|\b429\b|访问受限|百度安全验证|请完成下方验证|拖动左侧滑块|请解决以下挑战|请解决以下难题|security check/i.test(renderedPage)) {
    return true
  }

  // A normal product page often has a "登录" navigation link. Treat it as an
  // access limitation only when the page title and its visible content together
  // identify the page as an authentication prompt.
  const authTitle = /^\s*(?:登录|log[ -]?in|sign[ -]?in|authentication required)(?:\s*[-|].*)?\s*$/i.test(title)
  const authForm = /账号|帐户|用户名|密码|短信验证码|手机验证码|email|password|sign in to continue|login required/i.test(text)
  return authTitle && authForm
}

function targetUnavailableReason(url: string, title: string, text: string): string | null {
  const renderedPage = `${title}\n${text}`
  const isAppStore = (() => {
    try {
      return new URL(url).hostname.endsWith('apps.apple.com')
    } catch {
      return false
    }
  })()
  if (isAppStore && (/无法找到你所需的页面|the page you are looking for|an error occurred|this app is currently not available/i.test(renderedPage))) {
    return 'The requested App Store target was not found or is unavailable in this storefront; do not treat this as evidence that the product itself is unavailable.'
  }
  if (/^\s*(?:404|not found|page not found)\b/i.test(title) || /\b404\b[\s\S]{0,80}(?:not found|page)/i.test(renderedPage)) {
    return 'The requested page does not exist at this URL; find and verify a different public page before making a product-level conclusion.'
  }
  return null
}

function isGoogleSearchConsentPage(url: string, title: string, text: string): boolean {
  let hostname = ''
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }

  if (!hostname.endsWith('google.com') && !hostname.endsWith('google.co.uk') && !hostname.endsWith('google.de') && !hostname.endsWith('google.co.jp')) return false
  const renderedPage = `${title}\n${text}`
  return hostname.startsWith('consent.') || /before you continue to google|consent.google.com|agree to the use of cookies/i.test(renderedPage)
}

/** Returns a stable, machine-readable reason for non-evidence pages. */
export function classifyRenderedResearchPage(url: string, title: string, text: string): string | null {
  if (isGoogleSearchConsentPage(url, title, text)) {
    return 'ACCESS_LIMITED_PAGE: Google displayed a consent page instead of public organic search results.'
  }
  if (isBrowserResearchAccessLimitedPage(title, text)) {
    return 'ACCESS_LIMITED_PAGE: The rendered page requires a human verification, CAPTCHA, login, or other access control.'
  }
  const unavailableReason = targetUnavailableReason(url, title, text)
  if (unavailableReason) return `TARGET_PAGE_UNAVAILABLE: ${unavailableReason}`
  return null
}
