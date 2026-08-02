import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

describe('browser research Node Playwright runner', () => {
  test('passes link limits into the browser callback instead of closing over Node request state', async () => {
    const source = await readFile(path.join(import.meta.dir, 'browser-research-playwright-runner.ts'), 'utf8')

    expect(source).toContain('evaluateAll((anchors, maxLinks)')
    expect(source).toContain('anchors.slice(0, maxLinks)')
    expect(source).not.toContain('anchors.slice(0, request.maxLinks)')
  })

  test('uses the selected engine configuration for discovery and labels a missing result set with that actual engine', async () => {
    const source = await readFile(path.join(import.meta.dir, 'browser-research-playwright-runner.ts'), 'utf8')

    expect(source).toContain("getBrowserResearchSearchEngineConfig(request.target.searchEngine)")
    expect(source).toContain('searchConfig.queryInputSelector')
    expect(source).toContain('searchConfig.organicResultLinkSelector')
    expect(source).toContain('Search discovery unavailable: ${searchConfig.label}')
    expect(source).toContain('await ensureSearchDiscoveryRendered(page, request)')
    expect(source).not.toContain("page.locator('#b_results .b_algo h2 a')")
  })

  test('normalizes public search result links before returning them to the model', async () => {
    const source = await readFile(path.join(import.meta.dir, 'browser-research-playwright-runner.ts'), 'utf8')

    expect(source).toContain('normalizeBrowserResearchDiscoveredUrl(link.url)')
  })

  test('collects only organic result-title links for search discovery but keeps normal page links for direct reads', async () => {
    const source = await readFile(path.join(import.meta.dir, 'browser-research-playwright-runner.ts'), 'utf8')

    expect(source).toContain("request.target.kind === 'search'")
    expect(source).toContain('page.locator(getBrowserResearchSearchEngineConfig(request.target.searchEngine).organicResultLinkSelector)')
    expect(source).toContain("page.locator('a[href]')")
  })
  test('uses a visible editable input instead of the first selector match and performs a bounded Google consent action', async () => {
    const source = await readFile(path.join(import.meta.dir, 'browser-research-playwright-runner.ts'), 'utf8')

    expect(source).toContain('findVisibleEditableSearchInput')
    expect(source).not.toContain('page.locator(searchConfig.queryInputSelector).first()')
    expect(source).toContain('await acceptSearchEngineConsentIfPresent(page, searchConfig)')
    expect(source).toContain('SEARCH_ENGINE_ACCESS_LIMITED:')
    expect(source).toContain('buildBrowserResearchSearchQueryUrl')
    expect(source).toContain('isSearchInputUnavailableError')
  })

})
