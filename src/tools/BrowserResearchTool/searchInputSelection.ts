import type { Locator } from 'playwright'

export type SearchInputCandidate = Pick<Locator, 'fill' | 'isEditable' | 'isVisible' | 'press'>

export type SearchInputCandidates = {
  count: () => Promise<number>
  nth: (index: number) => SearchInputCandidate
}

const SEARCH_INPUT_POLL_INTERVAL_MS = 150
const MAX_SEARCH_INPUT_CANDIDATES = 12

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * A selector can match hidden template inputs before the real search box.
 * Select the first input a user could actually type into instead of using Locator.first().
 */
export function isSearchInputUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('SEARCH_INPUT_UNAVAILABLE:')
}

export async function findVisibleEditableSearchInput(
  candidates: SearchInputCandidates,
  searchEngineLabel: string,
  timeoutMs: number,
): Promise<SearchInputCandidate> {
  const deadline = Date.now() + timeoutMs
  let lastCandidateCount = 0

  do {
    lastCandidateCount = Math.min(await candidates.count(), MAX_SEARCH_INPUT_CANDIDATES)
    for (let index = 0; index < lastCandidateCount; index += 1) {
      const candidate = candidates.nth(index)
      const visible = await candidate.isVisible().catch(() => false)
      if (!visible) continue

      const editable = await candidate.isEditable().catch(() => false)
      if (editable) return candidate
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await wait(Math.min(SEARCH_INPUT_POLL_INTERVAL_MS, remainingMs))
  } while (Date.now() < deadline)

  throw new Error(
    `SEARCH_INPUT_UNAVAILABLE: ${searchEngineLabel} exposed ${lastCandidateCount} matching search input candidate(s), but none was both visible and editable. The page may be showing a consent, CAPTCHA, regional, or transient layout variant.`,
  )
}
