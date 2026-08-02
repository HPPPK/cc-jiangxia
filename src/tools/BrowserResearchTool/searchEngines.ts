export const BROWSER_RESEARCH_SEARCH_ENGINES = ['bing', 'google', 'baidu', '360'] as const

export type BrowserResearchSearchEngine = (typeof BROWSER_RESEARCH_SEARCH_ENGINES)[number]

export const DEFAULT_BROWSER_RESEARCH_SEARCH_ENGINE: BrowserResearchSearchEngine = 'bing'

export type BrowserResearchSearchEngineConfig = {
  id: BrowserResearchSearchEngine
  label: string
  startUrl: string
  searchPath: string
  queryInputSelector: string
  organicResultLinkSelector: string
  consentButtonSelector?: string
}

const SEARCH_ENGINE_CONFIGS: Record<BrowserResearchSearchEngine, BrowserResearchSearchEngineConfig> = {
  bing: {
    id: 'bing',
    label: 'Bing',
    startUrl: 'https://www.bing.com/',
    searchPath: '/search',
    queryInputSelector: 'textarea[name="q"], input[name="q"]',
    organicResultLinkSelector: '#b_results .b_algo h2 a',
  },
  google: {
    id: 'google',
    label: 'Google',
    startUrl: 'https://www.google.com/',
    searchPath: '/search',
    queryInputSelector: 'textarea[name="q"], input[name="q"]',
    organicResultLinkSelector: '#search a:has(h3)',
    consentButtonSelector: '#L2AGLb, form[action*="consent"] button[type="submit"]',
  },
  baidu: {
    id: 'baidu',
    label: 'Baidu',
    startUrl: 'https://www.baidu.com/',
    searchPath: '/s',
    queryInputSelector: '#kw, input[name="wd"]',
    organicResultLinkSelector: '#content_left h3 a',
  },
  '360': {
    id: '360',
    label: '360 Search',
    startUrl: 'https://www.so.com/',
    searchPath: '/s',
    queryInputSelector: '#keyword, input[name="q"], input[name="keyword"]',
    organicResultLinkSelector: '#main .res-title a, #main a.res-title, #rs .res-title a, #rs a.res-title, a.res-title',
  },
}

export function getBrowserResearchSearchEngineConfig(
  searchEngine: BrowserResearchSearchEngine = DEFAULT_BROWSER_RESEARCH_SEARCH_ENGINE,
): BrowserResearchSearchEngineConfig {
  return SEARCH_ENGINE_CONFIGS[searchEngine]
}

export function buildBrowserResearchSearchStartUrl(options: {
  searchEngine?: BrowserResearchSearchEngine
  market?: string
  locale?: string
} = {}): string {
  const config = getBrowserResearchSearchEngineConfig(options.searchEngine)
  const url = new URL(config.startUrl)

  if (config.id === 'bing') {
    if (options.market?.trim()) url.searchParams.set('cc', options.market.trim().toLowerCase())
    if (options.locale?.trim()) url.searchParams.set('setlang', options.locale.trim())
  } else if (config.id === 'google') {
    if (options.market?.trim()) url.searchParams.set('gl', options.market.trim().toLowerCase())
    if (options.locale?.trim()) url.searchParams.set('hl', options.locale.trim())
  }

  return url.toString()
}

export function buildBrowserResearchSearchQueryUrl(options: {
  searchEngine?: BrowserResearchSearchEngine
  query: string
  market?: string
  locale?: string
}): string {
  const config = getBrowserResearchSearchEngineConfig(options.searchEngine)
  const url = new URL(buildBrowserResearchSearchStartUrl(options))
  url.pathname = config.searchPath
  const query = options.query.trim()
  if (config.id === 'baidu') url.searchParams.set('wd', query)
  else url.searchParams.set('q', query)
  return url.toString()
}
