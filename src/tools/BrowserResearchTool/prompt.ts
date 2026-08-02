export const BROWSER_RESEARCH_TOOL_NAME = 'BrowserResearch'

export const BROWSER_RESEARCH_DESCRIPTION = `
- Uses the desktop app's isolated Playwright Chromium to either render one public http(s) URL or perform one explicit public search through the selected engine's normal visible search page
- For a known public page, pass url. To discover public candidate pages, pass search_query and optionally search_engine: bing (default), google, baidu, or 360; then use the returned rendered links to open only relevant public result pages
- search_query may include an explicit market (two-letter country code) and locale only when the user or research scope specifies them. Bing and Google receive those public hints; Baidu and 360 do not receive invented locale/market settings. Never invent or silently default a country, language, VPN, or region
- Extracts rendered visible text, page title, final URL, a bounded set of links, access failures, and optionally a local screenshot after JavaScript has run
- Use this instead of WebFetch when a page needs browser rendering, client-side data, a bounded public-web discovery step, or a visual check
- If a page is access-limited (login, CAPTCHA, robots, 403/429, or region restriction), record the exact attempted URL and limitation. Do not treat a CAPTCHA page or a mismatched-region result as research evidence, and do not attempt to bypass it
- Do not use it for login, credentials, payment, submitting forms, uploading/downloading files, private networks, CAPTCHA completion, proxy/VPN changes, or destructive actions
`

export function getBrowserResearchPrompt(): string {
  return BROWSER_RESEARCH_DESCRIPTION
}
