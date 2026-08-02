import { describe, expect, test } from 'bun:test'

import { normalizeBrowserResearchDiscoveredUrl } from './searchLinkNormalization.js'

describe('normalizeBrowserResearchDiscoveredUrl', () => {
  test('unwraps Bing public result redirects into their public destination', () => {
    const wrapped = 'https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wcmljaW5n'

    expect(normalizeBrowserResearchDiscoveredUrl(wrapped)).toBe('https://example.com/pricing')
  })

  test('does not turn a Bing wrapper into a private or credential-bearing target', () => {
    const privateTarget = 'https://www.bing.com/ck/a?u=a1aHR0cDovLzEyNy4wLjAuMS8'
    const credentialTarget = 'https://www.bing.com/ck/a?u=a1aHR0cHM6Ly91c2VyOnBhc3NAZXhhbXBsZS5jb20v'

    expect(normalizeBrowserResearchDiscoveredUrl(privateTarget)).toBeNull()
    expect(normalizeBrowserResearchDiscoveredUrl(credentialTarget)).toBeNull()
  })

  test('leaves ordinary public URLs and unrecognized wrappers unchanged', () => {
    expect(normalizeBrowserResearchDiscoveredUrl('https://example.com/')).toBe('https://example.com/')
    expect(normalizeBrowserResearchDiscoveredUrl('https://www.bing.com/search?q=example')).toBe('https://www.bing.com/search?q=example')
  })
})
