import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { getUnsafeBrowserResearchUrlReason } from './runtime.js'
import { normalizeBrowserResearchDiscoveredUrl } from './searchLinkNormalization.js'
import { classifyRenderedResearchPage, filterRelevantSearchCandidates } from './browserResearchAssessment.js'
import { findVisibleEditableSearchInput, isSearchInputUnavailableError } from './searchInputSelection.js'
import {
  buildBrowserResearchSearchQueryUrl,
  buildBrowserResearchSearchStartUrl,
  getBrowserResearchSearchEngineConfig,
  type BrowserResearchSearchEngine,
} from './searchEngines.js'

export type BrowserResearchTarget =
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string; searchEngine: BrowserResearchSearchEngine; market?: string; locale?: string }

export type BrowserResearchRunnerRequest = {
  executablePath: string
  target: BrowserResearchTarget
  locale?: string
  screenshotPath?: string
  pageTimeoutMs: number
  networkIdleTimeoutMs: number
  maxLinks: number
}

export type BrowserResearchRunnerLink = {
  text: string
  url: string
}

export type BrowserResearchRunnerResult = {
  url: string
  title: string
  text: string
  links: BrowserResearchRunnerLink[]
  screenshotPath?: string
}

async function waitForStablePage(
  page: Page,
  request: BrowserResearchRunnerRequest,
): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: request.pageTimeoutMs })
  await page.waitForLoadState('networkidle', { timeout: request.networkIdleTimeoutMs }).catch(() => undefined)
}

async function openTarget(
  page: Page,
  request: BrowserResearchRunnerRequest,
): Promise<void> {
  if (request.target.kind === 'url') {
    await page.goto(request.target.url, { waitUntil: 'domcontentloaded', timeout: request.pageTimeoutMs })
    await waitForStablePage(page, request)
    return
  }

  const searchConfig = getBrowserResearchSearchEngineConfig(request.target.searchEngine)
  await page.goto(buildBrowserResearchSearchStartUrl({
    searchEngine: request.target.searchEngine,
    ...(request.target.market?.trim() ? { market: request.target.market.trim() } : {}),
    ...(request.target.locale?.trim() ? { locale: request.target.locale.trim() } : {}),
  }), { waitUntil: 'domcontentloaded', timeout: request.pageTimeoutMs })
  await acceptSearchEngineConsentIfPresent(page, searchConfig)
  await ensureSearchEnginePageIsAccessible(page, searchConfig.label, request.pageTimeoutMs)
  try {
    const queryInput = await findVisibleEditableSearchInput(
      page.locator(searchConfig.queryInputSelector),
      searchConfig.label,
      request.pageTimeoutMs,
    )
    await queryInput.fill(request.target.query)
    await queryInput.press('Enter')
    await waitForStablePage(page, request)
  } catch (error) {
    if (!isSearchInputUnavailableError(error)) throw error

    // A public result endpoint is the same search request a user submits, but
    // avoids a landing-page layout variant whose visible input is unavailable.
    await page.goto(buildBrowserResearchSearchQueryUrl({
      searchEngine: request.target.searchEngine,
      query: request.target.query,
      ...(request.target.market?.trim() ? { market: request.target.market.trim() } : {}),
      ...(request.target.locale?.trim() ? { locale: request.target.locale.trim() } : {}),
    }), { waitUntil: 'domcontentloaded', timeout: request.pageTimeoutMs })
    await waitForStablePage(page, request)
  }
}

async function acceptSearchEngineConsentIfPresent(
  page: Page,
  searchConfig: ReturnType<typeof getBrowserResearchSearchEngineConfig>,
): Promise<void> {
  if (!searchConfig.consentButtonSelector) return

  const consentButtons = page.locator(searchConfig.consentButtonSelector)
  const count = Math.min(await consentButtons.count().catch(() => 0), 4)
  for (let index = 0; index < count; index += 1) {
    const button = consentButtons.nth(index)
    if (!await button.isVisible().catch(() => false)) continue
    await button.click({ timeout: 3_000 }).catch(() => undefined)
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined)
    return
  }
}

async function ensureSearchEnginePageIsAccessible(
  page: Page,
  searchEngineLabel: string,
  timeoutMs: number,
): Promise<void> {
  const [title, text] = await Promise.all([
    page.title(),
    page.locator('body').innerText({ timeout: timeoutMs }),
  ])
  const reason = classifyRenderedResearchPage(page.url(), title, text)
  if (reason) throw new Error(`SEARCH_ENGINE_ACCESS_LIMITED: ${searchEngineLabel}. ${reason}`)
}

async function visibleSearchResultLinks(
  page: Page,
  searchEngine: BrowserResearchSearchEngine,
): Promise<BrowserResearchRunnerLink[]> {
  const searchConfig = getBrowserResearchSearchEngineConfig(searchEngine)
  return page.locator(searchConfig.organicResultLinkSelector).evaluateAll((anchors) => anchors
    .filter((anchor) => {
      const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim()
      return Boolean(text && (anchor as HTMLAnchorElement).href && anchor.getClientRects().length)
    })
    .map((anchor) => ({
      text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
      url: (anchor as HTMLAnchorElement).href,
    })))
}

async function ensureSearchDiscoveryRendered(
  page: Page,
  request: BrowserResearchRunnerRequest,
): Promise<void> {
  if (request.target.kind !== 'search') return

  const searchConfig = getBrowserResearchSearchEngineConfig(request.target.searchEngine)
  await ensureSearchEnginePageIsAccessible(page, searchConfig.label, request.pageTimeoutMs)
  const candidates = await visibleSearchResultLinks(page, request.target.searchEngine)
  if (candidates.length === 0) {
    throw new Error(`Search discovery unavailable: ${searchConfig.label} did not render any visible organic result-title links after the query was submitted. No candidate URLs were collected; this may be an access, regional, consent, CAPTCHA, or transient rendering limitation.`)
  }

  if (filterRelevantSearchCandidates(request.target.query, candidates).length === 0) {
    const samples = candidates.slice(0, 3).map((candidate) => candidate.text || candidate.url).join(' | ')
    throw new Error(`SEARCH_DISCOVERY_IRRELEVANT: ${searchConfig.label} rendered visible result links, but none matched meaningful terms from ${JSON.stringify(request.target.query)}. Do not use these candidates as sources. Sample rendered results: ${samples || 'none'}. Try a more specific query, a different allowed search entry, an official site, or user-provided material.`)
  }
}

async function extractRenderedPage(
  page: Page,
  request: BrowserResearchRunnerRequest,
): Promise<BrowserResearchRunnerResult> {
  const url = page.url()
  const unsafeFinalUrlReason = getUnsafeBrowserResearchUrlReason(url)
  if (unsafeFinalUrlReason) throw new Error(`The page redirected to a blocked address: ${unsafeFinalUrlReason}`)

  const [title, text] = await Promise.all([
    page.title(),
    page.locator('body').innerText({ timeout: request.pageTimeoutMs }),
  ])
  const nonEvidenceReason = classifyRenderedResearchPage(url, title, text)
  if (nonEvidenceReason) throw new Error(nonEvidenceReason)

  const linkLocator = request.target.kind === 'search'
    ? page.locator(getBrowserResearchSearchEngineConfig(request.target.searchEngine).organicResultLinkSelector)
    : page.locator('a[href]')
  const rawLinks = await linkLocator.evaluateAll((anchors, maxLinks) => anchors.slice(0, maxLinks).map((anchor) => ({
    text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
    url: (anchor as HTMLAnchorElement).href,
  })), request.maxLinks)
  const normalizedLinks = rawLinks
    .map((link) => ({ ...link, url: normalizeBrowserResearchDiscoveredUrl(link.url) }))
    .filter((link): link is BrowserResearchRunnerLink => Boolean(link.text && link.url && !getUnsafeBrowserResearchUrlReason(link.url)))
  const links = request.target.kind === 'search'
    ? filterRelevantSearchCandidates(request.target.query, normalizedLinks)
    : normalizedLinks.slice(0, request.maxLinks)

  if (request.screenshotPath) {
    await mkdir(dirname(request.screenshotPath), { recursive: true })
    await page.screenshot({ path: request.screenshotPath, fullPage: true, type: 'png' })
  }

  return {
    url,
    title,
    text,
    links,
    ...(request.screenshotPath ? { screenshotPath: request.screenshotPath } : {}),
  }
}

async function run(request: BrowserResearchRunnerRequest): Promise<BrowserResearchRunnerResult> {
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      executablePath: request.executablePath,
      headless: true,
      args: ['--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check'],
    })
    const context = await browser.newContext({
      ...(request.locale?.trim() ? { locale: request.locale.trim() } : {}),
    })
    await context.route('**/*', async (route) => {
      const issue = getUnsafeBrowserResearchUrlReason(route.request().url())
      if (issue) await route.abort('blockedbyclient')
      else await route.continue()
    })
    const page = await context.newPage()
    await openTarget(page, request)
    await ensureSearchDiscoveryRendered(page, request)
    return await extractRenderedPage(page, request)
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

async function main(): Promise<void> {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  try {
    const request = JSON.parse(input) as BrowserResearchRunnerRequest
    const result = await run(request)
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ ok: false, error: detail })}\n`)
  }
}

void main()
