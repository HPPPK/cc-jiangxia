import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { isBrowserResearchNodeBridgeAvailable, runBrowserResearchWithNodeBridge } from "./playwrightNodeBridge.js";
import { isBrowserResearchAccessLimitedPage } from "./browserResearchAssessment.js";
export { isBrowserResearchAccessLimitedPage } from "./browserResearchAssessment.js";
import { z } from "zod/v4";
import { buildTool } from "../../Tool.js";
import {
  BROWSER_RESEARCH_DESCRIPTION,
  BROWSER_RESEARCH_TOOL_NAME,
  getBrowserResearchPrompt,
} from "./prompt.js";
import {
  BROWSER_RESEARCH_SEARCH_ENGINES,
  DEFAULT_BROWSER_RESEARCH_SEARCH_ENGINE,
  buildBrowserResearchSearchQueryUrl as buildSearchQueryUrl,
  buildBrowserResearchSearchStartUrl as buildSearchStartUrl,
  getBrowserResearchSearchEngineConfig,
  type BrowserResearchSearchEngine,
} from "./searchEngines.js";
import {
  ensureBrowserResearchRuntimeDir,
  getBrowserResearchScreenshotDir,
  resolveBrowserResearchExecutablePath,
  getUnsafeBrowserResearchUrlReason,
  isBrowserResearchRuntimeAvailable,
  isBrowserResearchRuntimeInstalled,
  summarizeBrowserResearchText,
} from "./runtime.js";

const MAX_LINKS = 80;
const PAGE_TIMEOUT_MS = 35_000;
const NETWORK_IDLE_TIMEOUT_MS = 2_500;

type ResearchAttempt = {
  url: string;
  outcome: "success" | "failed";
  failureKind?: "access_limited" | "runtime_unavailable" | "search_irrelevant" | "target_unavailable" | "page_error";
  searchEngine?: BrowserResearchSearchEngine;
  error?: string;
};

type Input = {
  url?: string;
  search_query?: string;
  search_engine?: BrowserResearchSearchEngine;
  market?: string;
  locale?: string;
  task: string;
  includeScreenshot: boolean;
  retry_urls: string[];
};

type Output = {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; url: string }>;
  durationMs: number;
  truncated: boolean;
  attempts: ResearchAttempt[];
  screenshotPath?: string;
  error?: string;
};

type BrowserResearchTarget =
  | { kind: "url"; url: string }
  | { kind: "search"; query: string; searchEngine: BrowserResearchSearchEngine; market?: string; locale?: string };

const inputSchema = z.strictObject({
  url: z
    .string()
    .url()
    .optional()
    .describe("A public http(s) URL to render. Supply exactly one of url or search_query."),
  search_query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("An explicit public-web discovery query. Set search_engine when a specific public engine is required; otherwise BrowserResearch defaults to Bing. It reads the rendered result page and never bypasses CAPTCHA, login, or access controls."),
  search_engine: z
    .enum(BROWSER_RESEARCH_SEARCH_ENGINES)
    .optional()
    .describe("Optional public discovery engine: bing (default), google, baidu, or 360. This applies only with search_query; BrowserResearch opens that actual engine rather than silently substituting Bing."),
  market: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "market must be a two-letter country code, for example CN or US.")
    .optional()
    .describe("Optional target-country code for an explicit search query. Omit when the user has not specified a target market; BrowserResearch never defaults a country."),
  locale: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,3}-[A-Za-z]{2,4}$/, "locale must resemble zh-CN or en-US.")
    .optional()
    .describe("Optional browser/search language for an explicit search query. Omit when the user has not specified a language."),
  task: z
    .string()
    .min(1)
    .max(1_000)
    .describe("The specific evidence to collect from the rendered page or search results."),
  includeScreenshot: z
    .boolean()
    .optional()
    .default(false)
    .describe("Save a local screenshot only when visual evidence is needed."),
  retry_urls: z
    .array(z.string().url())
    .max(3)
    .optional()
    .default([])
    .describe("Up to three relevant public URLs to try only after the primary page or search result cannot be read."),
});

const outputSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  links: z.array(z.object({ text: z.string(), url: z.string() })),
  durationMs: z.number(),
  truncated: z.boolean(),
  attempts: z.array(z.object({
    url: z.string(),
    outcome: z.enum(["success", "failed"]),
    failureKind: z.enum(["access_limited", "runtime_unavailable", "search_irrelevant", "target_unavailable", "page_error"]).optional(),
    searchEngine: z.enum(BROWSER_RESEARCH_SEARCH_ENGINES).optional(),
    error: z.string().optional(),
  })),
  screenshotPath: z.string().optional(),
  error: z.string().optional(),
});

function hostnameForPermission(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return "this page";
  }
}

function inputTargetError(input: Pick<Input, "url" | "search_query" | "search_engine">): string | null {
  const hasUrl = Boolean(input.url?.trim());
  const hasQuery = Boolean(input.search_query?.trim());
  if (hasUrl === hasQuery) return "Supply exactly one of url or search_query.";
  if (input.search_engine && !hasQuery) return "search_engine can only be used with search_query.";
  return null;
}

export function buildBrowserResearchSearchStartUrl(options: Pick<Input, "search_engine" | "market" | "locale"> = {}): string {
  return buildSearchStartUrl({
    ...(options.search_engine ? { searchEngine: options.search_engine } : {}),
    ...(options.market?.trim() ? { market: options.market.trim() } : {}),
    ...(options.locale?.trim() ? { locale: options.locale.trim() } : {}),
  });
}

function searchEngineLabel(request: Pick<Input, "search_engine">): string {
  return getBrowserResearchSearchEngineConfig(request.search_engine ?? DEFAULT_BROWSER_RESEARCH_SEARCH_ENGINE).label;
}

function primaryTarget(input: Input): BrowserResearchTarget {
  if (input.search_query?.trim()) {
    return {
      kind: "search",
      query: input.search_query.trim(),
      searchEngine: input.search_engine ?? DEFAULT_BROWSER_RESEARCH_SEARCH_ENGINE,
      ...(input.market?.trim() ? { market: input.market.trim() } : {}),
      ...(input.locale?.trim() ? { locale: input.locale.trim() } : {}),
    };
  }
  return { kind: "url", url: input.url!.trim() };
}

function targetAttemptUrl(target: BrowserResearchTarget): string {
  return target.kind === "url"
    ? target.url
    : buildSearchQueryUrl({
      searchEngine: target.searchEngine,
      query: target.query,
      ...(target.market ? { market: target.market } : {}),
      ...(target.locale ? { locale: target.locale } : {}),
    });
}

function browserFailureKind(detail: string): ResearchAttempt["failureKind"] {
  if (/SEARCH_DISCOVERY_IRRELEVANT/i.test(detail)) return "search_irrelevant"
  if (/TARGET_PAGE_UNAVAILABLE/i.test(detail)) return "target_unavailable"
  if (/search discovery unavailable|ACCESS_LIMITED_PAGE/i.test(detail)) return "access_limited"
  if (isBrowserResearchAccessLimitedPage("", detail)) return "access_limited"
  if (/managed Chromium|runtime is unavailable|Chromium executable|browserType\.launch|playwright/i.test(detail)) return "runtime_unavailable"
  return "page_error"
}

function browserUnavailableOutput(
  url: string,
  startedAt: number,
  error: unknown,
  attempts: ResearchAttempt[] = [],
): Output {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    url,
    title: "",
    text: "",
    links: [],
    durationMs: Date.now() - startedAt,
    truncated: false,
    attempts,
    error: `The built-in BrowserResearch runtime is unavailable. Ensure its managed Playwright Chromium is installed locally, then retry. (${detail})`,
  };
}

async function createScreenshotPath(url: string): Promise<string> {
  const screenshotDir = getBrowserResearchScreenshotDir();
  await mkdir(screenshotDir, { recursive: true });
  const host = basename(new URL(url).hostname).replace(/[^a-z0-9.-]/gi, "_") || "page";
  return join(screenshotDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${host}.png`);
}

export const BrowserResearchTool = buildTool({
  name: BROWSER_RESEARCH_TOOL_NAME,
  searchHint: "use isolated Playwright Chromium to search public Bing, Google, Baidu, or 360 results or render public evidence pages",
  maxResultSizeChars: 32_000,
  alwaysLoad: true,
  async description(input) {
    const request = input as Input;
    return request.search_query
      ? `Claude wants to search public ${searchEngineLabel(request)} results for ${JSON.stringify(request.search_query)}`
      : `Claude wants to research the rendered page at ${hostnameForPermission(request.url)}`;
  },
  userFacingName() {
    return "Browser research";
  },
  get inputSchema() {
    return inputSchema;
  },
  get outputSchema() {
    return outputSchema;
  },
  isEnabled() {
    return isBrowserResearchRuntimeAvailable() && isBrowserResearchNodeBridgeAvailable();
  },
  isConcurrencySafe() {
    return false;
  },
  isReadOnly() {
    return true;
  },
  isSearchOrReadCommand(input) {
    return { isSearch: Boolean((input as Input).search_query), isRead: !Boolean((input as Input).search_query) };
  },
  toAutoClassifierInput(input) {
    const request = input as Input;
    return request.search_query ?? request.url ?? "";
  },
  async checkPermissions(input) {
    const request = input as Input;
    return {
      behavior: "ask" as const,
      message: request.search_query
        ? `Claude requested permission to use the isolated Playwright browser to search public ${searchEngineLabel(request)} results for ${JSON.stringify(request.search_query)}.`
        : `Claude requested permission to use the isolated Playwright browser to read ${hostnameForPermission(request.url)}.`,
    };
  },
  async prompt() {
    return getBrowserResearchPrompt();
  },
  renderToolUseMessage(input) {
    const request = input as Input;
    return request.search_query ? `Browser search (${searchEngineLabel(request)}): ${request.search_query}` : request.url ? `Browser research: ${request.url}` : "Browser research";
  },
  renderToolResultMessage(output) {
    return output.error
      ? `Browser research unavailable: ${output.error}`
      : `Read rendered page: ${output.title || output.url}`;
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const sections = [
      "BrowserResearch result",
      `URL: ${output.url}`,
      output.title ? `Title: ${output.title}` : undefined,
      `Duration: ${output.durationMs}ms`,
      output.truncated ? "Visible text was truncated to the tool result limit." : undefined,
      output.error ? `Error: ${output.error}` : undefined,
      // Keep this provenance line ahead of long visible-text/link sections. The
      // model transport can truncate a verbose tool result, and strict visual
      // workflows must still be able to Read the exact BrowserResearch image.
      output.screenshotPath ? `Local screenshot path: ${output.screenshotPath}` : undefined,
      (output.attempts ?? []).length > 0 ? `Attempts:\n${(output.attempts ?? []).map((attempt, index) => `${index + 1}. ${attempt.outcome}: ${attempt.url}${attempt.searchEngine ? ` [engine=${attempt.searchEngine}]` : ""}${attempt.failureKind ? ` [${attempt.failureKind}]` : ""}${attempt.error ? ` — ${attempt.error}` : ""}`).join("\n")}` : undefined,
      output.text ? `Rendered visible text:\n${output.text}` : undefined,
      output.links.length > 0
        ? `Rendered links:\n${output.links.map((link, index) => `${index + 1}. ${link.text}: ${link.url}`).join("\n")}`
        : "Rendered links: none",
      `<browser-research-ledger encoding="base64">${Buffer.from(JSON.stringify({ url: output.url, attempts: output.attempts ?? [] }), "utf8").toString("base64")}</browser-research-ledger>`,
    ].filter((section): section is string => Boolean(section));

    return {
      tool_use_id: toolUseID,
      type: "tool_result",
      content: sections.join("\n\n"),
    };
  },
  extractSearchText(output) {
    return output.error ?? "";
  },
  async validateInput(input) {
    const request = input as Input;
    const targetError = inputTargetError(request);
    if (targetError) return { result: false as const, message: targetError, errorCode: 1 };
    if (request.url) {
      const issue = getUnsafeBrowserResearchUrlReason(request.url);
      if (issue) return { result: false as const, message: `BrowserResearch refused this URL: ${issue}`, errorCode: 1 };
    }
    for (const retryUrl of request.retry_urls ?? []) {
      const issue = getUnsafeBrowserResearchUrlReason(retryUrl);
      if (issue) return { result: false as const, message: `BrowserResearch refused this retry URL: ${issue}`, errorCode: 1 };
    }
    if (!isBrowserResearchRuntimeAvailable()) {
      return {
        result: false as const,
        message: "BrowserResearch is not currently available because its managed Playwright Chromium runtime is not installed.",
        errorCode: 2,
      };
    }
    if (!isBrowserResearchNodeBridgeAvailable()) {
      return {
        result: false as const,
        message: "BrowserResearch is not currently available because its managed Node Playwright bridge is missing. Rebuild the desktop sidecars so the bundled Node runtime and browser runner are present.",
        errorCode: 2,
      };
    }
    return { result: true as const };
  },
  async call(input) {
    const request = input as Input;
    const startedAt = Date.now();
    const attempts: ResearchAttempt[] = [];
    const targetError = inputTargetError(request);
    if (targetError) {
      return { data: { url: request.url ?? buildBrowserResearchSearchStartUrl(request), title: "", text: "", links: [], durationMs: 0, truncated: false, attempts, error: targetError } };
    }
    const primary = primaryTarget(request);
    await ensureBrowserResearchRuntimeDir();
    const executablePath = resolveBrowserResearchExecutablePath();
    if (!executablePath) {
      return { data: browserUnavailableOutput(targetAttemptUrl(primary), startedAt, new Error("The managed Playwright Chromium executable was not found."), attempts) };
    }

    const candidates: BrowserResearchTarget[] = [
      primary,
      ...[...new Set(request.retry_urls ?? [])].filter((url) => url !== (primary.kind === "url" ? primary.url : undefined)).map((url) => ({ kind: "url" as const, url })),
    ];
    try {
      for (const candidate of candidates) {
        const attemptUrl = targetAttemptUrl(candidate);
        try {
          const screenshotPath = request.includeScreenshot ? await createScreenshotPath(attemptUrl) : undefined;
          const rendered = await runBrowserResearchWithNodeBridge({
            executablePath,
            target: candidate,
            ...(request.locale?.trim() ? { locale: request.locale.trim() } : {}),
            ...(screenshotPath ? { screenshotPath } : {}),
            pageTimeoutMs: PAGE_TIMEOUT_MS,
            networkIdleTimeoutMs: NETWORK_IDLE_TIMEOUT_MS,
            maxLinks: MAX_LINKS,
          });
          if (isBrowserResearchAccessLimitedPage(rendered.title, rendered.text)) {
            throw new Error(`Access-limited page: ${rendered.title || rendered.text.slice(0, 300)}`);
          }
          const { text, truncated } = summarizeBrowserResearchText(rendered.text);
          attempts.push({
            url: attemptUrl,
            outcome: "success",
            ...(candidate.kind === "search" ? { searchEngine: candidate.searchEngine } : {}),
          });
          return {
            data: {
              url: rendered.url,
              title: rendered.title,
              text,
              links: rendered.links,
              durationMs: Date.now() - startedAt,
              truncated,
              attempts,
              ...(rendered.screenshotPath ? { screenshotPath: rendered.screenshotPath } : {}),
            },
          };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          attempts.push({
            url: attemptUrl,
            outcome: "failed",
            failureKind: browserFailureKind(detail),
            ...(candidate.kind === "search" ? { searchEngine: candidate.searchEngine } : {}),
            error: detail,
          });
        }
      }
      const accessLimited = attempts.some((attempt) => attempt.failureKind === "access_limited");
      const summary = attempts.map((attempt) => `${attempt.url}: ${attempt.error ?? attempt.failureKind ?? "not readable"}`).join(" | ");
      return {
        data: {
          url: targetAttemptUrl(primary),
          title: "",
          text: "",
          links: [],
          durationMs: Date.now() - startedAt,
          truncated: false,
          attempts,
          error: accessLimited
            ? `BrowserResearch could not access the requested public page(s). Do not substitute other signals for the missing evidence. Record the attempted URL(s), then ask the user for a permitted alternative source, internal material, an evidence gap, or an explicitly marked hypothesis. (${summary})`
            : `BrowserResearch could not read the requested public page(s). Retry only with a user-provided or rendered-page alternative URL; do not claim the evidence was collected. (${summary})`,
        },
      };
    } catch (error) {
      return { data: browserUnavailableOutput(targetAttemptUrl(primary), startedAt, error, attempts) };
    }
  },
});

export { BROWSER_RESEARCH_DESCRIPTION, BROWSER_RESEARCH_TOOL_NAME };
