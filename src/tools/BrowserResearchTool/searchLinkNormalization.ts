import { getUnsafeBrowserResearchUrlReason } from './runtime.js'

function decodeBingRedirectUrl(rawUrl: string): string | null | undefined {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return undefined
  }

  if (!parsed.hostname.endsWith('.bing.com') || parsed.pathname !== '/ck/a') return undefined

  const encodedTarget = parsed.searchParams.get('u')
  if (!encodedTarget?.startsWith('a1')) return undefined

  try {
    const target = Buffer.from(encodedTarget.slice(2), 'base64').toString('utf8')
    if (!target || getUnsafeBrowserResearchUrlReason(target)) return null
    return target
  } catch {
    return undefined
  }
}

/**
 * Replaces Bing's public click-tracking wrapper with its public destination.
 * A null return means the wrapper points to an unsafe destination and must be omitted.
 */
export function normalizeBrowserResearchDiscoveredUrl(rawUrl: string): string | null {
  const decoded = decodeBingRedirectUrl(rawUrl)
  return decoded === undefined ? rawUrl : decoded
}
