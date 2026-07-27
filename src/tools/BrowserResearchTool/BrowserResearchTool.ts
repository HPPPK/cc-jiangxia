import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod/v4";
import { buildTool } from "../../Tool.js";
import {
  BROWSER_RESEARCH_DESCRIPTION,
  BROWSER_RESEARCH_TOOL_NAME,
  getBrowserResearchPrompt,
} from "./prompt.js";
import {
  ensureBrowserResearchRuntimeDir,
  getBrowserResearchExecutablePath,
  seedBundledBrowserResearchRuntime,
  getBrowserResearchScreenshotDir,
  getUnsafeBrowserResearchUrlReason,
  isBrowserResearchRuntimeInstalled,
  summarizeBrowserResearchText,
} from "./runtime.js";

const MAX_LINKS = 80;
const PAGE_TIMEOUT_MS = 35_000;
const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};
type CdpEventListener = (params: Record<string, unknown>) => void;

type ResearchAttempt = {
  url: string;
  outcome: 'success' | 'failed';
  failureKind?: 'access_limited' | 'runtime_unavailable' | 'page_error';
  error?: string;
};

type Input = { url: string; task: string; includeScreenshot: boolean; retry_urls: string[] };
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

const inputSchema = z.strictObject({
  url: z
    .string()
    .url()
    .describe("A public http(s) URL the user supplied or confirmed."),
  task: z
    .string()
    .min(1)
    .max(1_000)
    .describe("The specific evidence to collect from this rendered page."),
  includeScreenshot: z
    .boolean()
    .optional()
    .default(false)
    .describe("Save a local screenshot only when visual evidence is needed."),
  retry_urls: z.array(z.string().url()).max(3).optional().default([]).describe("Up to three user-supplied or page-link alternative public URLs. Try these only after the primary page cannot be read; this tool does not discover URLs by itself."),
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
    outcome: z.enum(['success', 'failed']),
    failureKind: z.enum(['access_limited', 'runtime_unavailable', 'page_error']).optional(),
    error: z.string().optional(),
  })),
  screenshotPath: z.string().optional(),
  error: z.string().optional(),
});

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Map<string, Set<CdpEventListener>>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(
            new Error(
              message.error.message ?? "Chrome DevTools command failed.",
            ),
          );
        else pending.resolve(message.result ?? {});
        return;
      }
      if (message.method)
        this.listeners
          .get(message.method)
          ?.forEach((listener) => listener(message.params ?? {}));
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Timed out connecting to the local Chromium CDP endpoint.",
            ),
          ),
        PAGE_TIMEOUT_MS,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(
            new Error("Could not connect to the local Chromium CDP endpoint."),
          );
        },
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  on(method: string, listener: CdpEventListener): void {
    const listeners = this.listeners.get(method) ?? new Set<CdpEventListener>();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  waitFor(method: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`Timed out waiting for Chromium event: ${method}`)),
        PAGE_TIMEOUT_MS,
      );
      this.on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out running Chromium command: ${method}`));
      }, PAGE_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

function hostnameForPermission(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "this URL";
  }
}

function browserFailureKind(detail: string): ResearchAttempt['failureKind'] {
  if (/access denied|forbidden|captcha|verify you are human|login|required|robots|rate limit|too many requests|\b403\b|\b429\b|region|地区|登录|验证码|访问受限/i.test(detail)) return 'access_limited'
  if (/managed Chromium|runtime is unavailable|CDP endpoint|Chromium executable/i.test(detail)) return 'runtime_unavailable'
  return 'page_error'
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
    error: `The built-in BrowserResearch runtime is unavailable. Ensure its managed Chromium is installed locally, then retry. (${detail})`,
  };
}

async function waitForCdpEndpoint(profileDir: string): Promise<string> {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  const portFile = join(profileDir, DEVTOOLS_ACTIVE_PORT_FILE);
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for the isolated Chromium CDP endpoint.");
}

async function createPageDebuggerEndpoint(endpoint: string): Promise<string> {
  const response = await fetch(`${endpoint}/json/new?about%3Ablank`, {
    method: "PUT",
  });
  if (!response.ok)
    throw new Error(
      `Could not create an isolated Chromium page (HTTP ${response.status()}).`,
    );
  const target = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!target.webSocketDebuggerUrl)
    throw new Error("Chromium did not provide a page debugger endpoint.");
  return target.webSocketDebuggerUrl;
}

async function launchIsolatedBrowser(): Promise<{
  client: CdpClient;
  process: { kill: () => void };
  profileDir: string;
}> {
  const executablePath = getBrowserResearchExecutablePath();
  if (!executablePath)
    throw new Error("The managed Chromium executable was not found.");
  const profileDir = await mkdtemp(
    join(tmpdir(), "cc-jiangxia-browser-research-"),
  );
  const process = Bun.spawn(
    [
      executablePath,
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  try {
    const endpoint = await waitForCdpEndpoint(profileDir);
    return {
      client: await CdpClient.connect(
        await createPageDebuggerEndpoint(endpoint),
      ),
      process,
      profileDir,
    };
  } catch (error) {
    process.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

export const BrowserResearchTool = buildTool({
  name: BROWSER_RESEARCH_TOOL_NAME,
  searchHint:
    "render public web pages in isolated headless Chromium and extract evidence",
  maxResultSizeChars: 32_000,
  alwaysLoad: true,
  async description(input) {
    return `Claude wants to research the rendered page at ${hostnameForPermission((input as Input).url)}`;
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
    return isBrowserResearchRuntimeInstalled();
  },
  isConcurrencySafe() {
    return false;
  },
  isReadOnly() {
    return true;
  },
  isSearchOrReadCommand() {
    return { isSearch: false, isRead: true };
  },
  toAutoClassifierInput(input) {
    return (input as Input).url;
  },
  async checkPermissions(input) {
    return {
      behavior: "ask" as const,
      message: `Claude requested permission to use the isolated browser to read ${hostnameForPermission((input as Input).url)}.`,
    };
  },
  async prompt() {
    return getBrowserResearchPrompt();
  },
  renderToolUseMessage(input) {
    return input.url ? `Browser research: ${input.url}` : "Browser research";
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
      output.truncated
        ? "Visible text was truncated to the tool result limit."
        : undefined,
      output.error ? `Error: ${output.error}` : undefined,
      (output.attempts ?? []).length > 0 ? `Attempts:\n${(output.attempts ?? []).map((attempt, index) => `${index + 1}. ${attempt.outcome}: ${attempt.url}${attempt.failureKind ? ` [${attempt.failureKind}]` : ''}${attempt.error ? ` — ${attempt.error}` : ''}`).join("\n")}` : undefined,
      output.text ? `Rendered visible text:\n${output.text}` : undefined,
      output.links.length > 0
        ? `Rendered links:\n${output.links.map((link, index) => `${index + 1}. ${link.text}: ${link.url}`).join("\n")}`
        : "Rendered links: none",
      output.screenshotPath
        ? `Local screenshot path: ${output.screenshotPath}`
        : undefined,
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
    const issue = getUnsafeBrowserResearchUrlReason(input.url);
    if (issue)
      return {
        result: false as const,
        message: `BrowserResearch refused this URL: ${issue}`,
        errorCode: 1,
      };
    await seedBundledBrowserResearchRuntime()
    if (!isBrowserResearchRuntimeInstalled())
      return {
        result: false as const,
        message:
          "BrowserResearch is not currently available because its managed Chromium runtime is not installed.",
        errorCode: 2,
      };
    return { result: true as const };
  },
  async call(input) {
    const startedAt = Date.now();
    const attempts: ResearchAttempt[] = [];
    const candidates = [...new Set([input.url, ...input.retry_urls])];
    await ensureBrowserResearchRuntimeDir();
    let client: CdpClient | undefined;
    let browserProcess: { kill: () => void } | undefined;
    let profileDir: string | undefined;
    try {
      const isolated = await launchIsolatedBrowser();
      client = isolated.client;
      browserProcess = isolated.process;
      profileDir = isolated.profileDir;
      await client.send("Page.enable");
      await client.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      });
      client.on("Fetch.requestPaused", (params) => {
        const request = params.request as { url?: string } | undefined;
        const requestId = params.requestId as string;
        const issue = request?.url
          ? getUnsafeBrowserResearchUrlReason(request.url)
          : "The page request was missing a URL.";
        void client
          ?.send(
            issue ? "Fetch.failRequest" : "Fetch.continueRequest",
            issue
              ? { requestId, errorReason: "BlockedByClient" }
              : { requestId },
          )
          .catch(() => undefined);
      });

      for (const candidate of candidates) {
        try {
          const load = client.waitFor("Page.loadEventFired");
          await client.send("Page.navigate", { url: candidate });
          await load;
          const evaluated = await client.send("Runtime.evaluate", {
            expression: `(() => ({ title: document.title, url: location.href, text: document.body?.innerText ?? '', links: Array.from(document.querySelectorAll('a[href]')).slice(0, ${MAX_LINKS}).map((anchor) => ({ text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(), url: anchor.href })) }))()`,
            returnByValue: true,
            awaitPromise: true,
          });
          const value = (
            evaluated.result as {
              value?: {
                title?: string;
                url?: string;
                text?: string;
                links?: Array<{ text?: string; url?: string }>;
              };
            }
          ).value;
          if (!value?.url) throw new Error("Chromium returned no rendered page result.");
          const unsafeFinalUrlReason = getUnsafeBrowserResearchUrlReason(value.url);
          if (unsafeFinalUrlReason) throw new Error(`The page redirected to a blocked address: ${unsafeFinalUrlReason}`);
          const { text, truncated } = summarizeBrowserResearchText(value.text ?? "");
          const links = (value.links ?? [])
            .filter((link): link is { text: string; url: string } => Boolean(link.text && link.url && !getUnsafeBrowserResearchUrlReason(link.url)))
            .slice(0, MAX_LINKS);
          let screenshotPath: string | undefined;
          if (input.includeScreenshot) {
            const screenshotDir = getBrowserResearchScreenshotDir();
            await mkdir(screenshotDir, { recursive: true });
            const host = basename(new URL(value.url).hostname).replace(/[^a-z0-9.-]/gi, "_") || "page";
            screenshotPath = join(screenshotDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${host}.png`);
            const captured = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
            await writeFile(screenshotPath, Buffer.from(String(captured.data), "base64"));
          }
          attempts.push({ url: candidate, outcome: 'success' });
          return {
            data: {
              url: value.url,
              title: value.title ?? "",
              text,
              links,
              durationMs: Date.now() - startedAt,
              truncated,
              attempts,
              ...(screenshotPath ? { screenshotPath } : {}),
            },
          };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          attempts.push({ url: candidate, outcome: 'failed', failureKind: browserFailureKind(detail), error: detail });
        }
      }
      const accessLimited = attempts.some((attempt) => attempt.failureKind === 'access_limited');
      const summary = attempts.map((attempt) => `${attempt.url}: ${attempt.error ?? attempt.failureKind ?? 'not readable'}`).join(' | ');
      return {
        data: {
          url: input.url,
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
      return { data: browserUnavailableOutput(input.url, startedAt, error, attempts) };
    } finally {
      client?.close();
      browserProcess?.kill();
      if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});

export { BROWSER_RESEARCH_DESCRIPTION, BROWSER_RESEARCH_TOOL_NAME };
