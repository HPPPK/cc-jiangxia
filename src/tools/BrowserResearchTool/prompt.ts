export const BROWSER_RESEARCH_TOOL_NAME = 'BrowserResearch'

export const BROWSER_RESEARCH_DESCRIPTION = `
- Opens a user-provided or user-confirmed public http(s) page in the desktop app's isolated, headless Chromium browser
- Extracts rendered visible text, page title, final URL, and a bounded set of links after JavaScript has run
- Can save a local screenshot only when visual evidence is useful
- Use this instead of WebFetch when a page needs browser rendering, client-side data, or a visual check
- When the primary page does not contain the assigned evidence, retry only with up to three relevant public URLs that the user supplied or that were returned as rendered page links; return every attempt and its failure reason
- If a page is access-limited (login, CAPTCHA, robots, 403/429, region restriction), record that exact limitation and ask the user to choose an alternative source, internal material, an evidence gap, or an explicitly labelled hypothesis
- This is not a web-discovery/search provider: ask the user for a URL or use a separately available search tool only when it is actually enabled
- Do not use it for login, credentials, payment, submitting forms, uploading/downloading files, private networks, or destructive actions
`

export function getBrowserResearchPrompt(): string {
  return BROWSER_RESEARCH_DESCRIPTION
}
