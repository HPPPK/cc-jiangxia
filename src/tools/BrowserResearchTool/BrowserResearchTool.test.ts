import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserResearchTool, buildBrowserResearchSearchStartUrl, isBrowserResearchAccessLimitedPage } from "./BrowserResearchTool.js";
import { isBrowserResearchRuntimeInstalled } from "./runtime.js";

function textContentOf(
  block: ReturnType<
    typeof BrowserResearchTool.mapToolResultToToolResultBlockParam
  >,
): string {
  if (typeof block.content !== "string") {
    throw new Error(
      "Expected BrowserResearch to return a text tool result block.",
    );
  }
  return block.content;
}

const temporaryDirectories: string[] = []
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalBundledRuntimeDir = process.env.CLAUDE_BROWSER_RUNTIME_DIR
const originalBundledNodeExecutable = process.env.CLAUDE_BUNDLED_NODE_EXECUTABLE

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  if (originalBundledRuntimeDir === undefined) delete process.env.CLAUDE_BROWSER_RUNTIME_DIR
  else process.env.CLAUDE_BROWSER_RUNTIME_DIR = originalBundledRuntimeDir
  if (originalBundledNodeExecutable === undefined) delete process.env.CLAUDE_BUNDLED_NODE_EXECUTABLE
  else process.env.CLAUDE_BUNDLED_NODE_EXECUTABLE = originalBundledNodeExecutable
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
describe("BrowserResearchTool model result mapping", () => {
  test("returns rendered text, links, and the local screenshot path to the model", () => {
    const block = BrowserResearchTool.mapToolResultToToolResultBlockParam(
      {
        url: "https://example.com/products",
        title: "Example products",
        text: "Rendered product details",
        links: [
          { text: "Pricing", url: "https://example.com/pricing" },
          { text: "Documentation", url: "https://example.com/docs" },
        ],
        durationMs: 842,
        truncated: false,
        attempts: [{ url: "https://www.google.com/?q=example+products", outcome: "success", searchEngine: "google" }],
        screenshotPath:
          "C:\\Users\\潘婧瑜\\.claude\\cc-jiangxia\\browser-research\\screenshots\\products.png",
      },
      "browser-tool-use-1",
    );

    const content = textContentOf(block);
    expect(block.tool_use_id).toBe("browser-tool-use-1");
    expect(content).toContain("URL: https://example.com/products");
    expect(content).toContain("Title: Example products");
    expect(content).toContain(
      "Rendered visible text:\nRendered product details",
    );
    expect(content).toContain("1. Pricing: https://example.com/pricing");
    expect(content).toContain("2. Documentation: https://example.com/docs");
    expect(content).toContain("1. success: https://www.google.com/?q=example+products [engine=google]")
    expect(content).toContain(
      "Local screenshot path: C:\\Users\\潘婧瑜\\.claude\\cc-jiangxia\\browser-research\\screenshots\\products.png",
    );
    expect(content.indexOf('Local screenshot path:')).toBeLessThan(
      content.indexOf('Rendered visible text:'),
    )
    expect(content.indexOf('Local screenshot path:')).toBeLessThan(
      content.indexOf('Rendered links:'),
    )
    expect(content).toContain('<browser-research-ledger encoding="base64">')
  });

  test("returns BrowserResearch errors to the model instead of dropping them", () => {
    const block = BrowserResearchTool.mapToolResultToToolResultBlockParam(
      {
        url: "https://example.com/blocked",
        title: "",
        text: "",
        links: [],
        durationMs: 35_000,
        truncated: false,
        attempts: [{ url: "https://example.com/blocked", outcome: "failed", failureKind: "access_limited", error: "HTTP 403" }],
        error: "The built-in BrowserResearch runtime is unavailable.",
      },
      "browser-tool-use-error",
    );

    const content = textContentOf(block);
    expect(content).toContain("URL: https://example.com/blocked");
    expect(content).toContain(
      "Error: The built-in BrowserResearch runtime is unavailable.",
    );
    expect(content).toContain("1. failed: https://example.com/blocked [access_limited] — HTTP 403")
    expect(content).toContain("Rendered links: none");
  });

  test("builds a Playwright Bing search start URL without silently forcing a country", () => {
    expect(buildBrowserResearchSearchStartUrl()).toBe("https://www.bing.com/")
    expect(buildBrowserResearchSearchStartUrl({ market: "CN", locale: "zh-CN" }))
      .toBe("https://www.bing.com/?cc=cn&setlang=zh-CN")
  })

  test("accepts an explicit browser search query and rejects conflicting URL input", async () => {
    await configureFakeBundledPlaywrightBridge()
    expect(await BrowserResearchTool.validateInput({
      search_query: "markdown reader mac",
      task: "Find public candidate pages",
      includeScreenshot: false,
      retry_urls: [],
    } as any)).toEqual({ result: true })

    expect(await BrowserResearchTool.validateInput({
      url: "https://example.com/research",
      search_query: "markdown reader mac",
      task: "Find public candidate pages",
      includeScreenshot: false,
      retry_urls: [],
    } as any)).toMatchObject({
      result: false,
      message: expect.stringContaining("exactly one"),
    })

    expect(await BrowserResearchTool.validateInput({
      url: "https://example.com/research",
      search_engine: "google",
      task: "Find public candidate pages",
      includeScreenshot: false,
      retry_urls: [],
    } as any)).toMatchObject({
      result: false,
      message: expect.stringContaining("search_engine can only be used with search_query"),
    })

    expect(await BrowserResearchTool.validateInput({
      search_query: "markdown reader mac",
      search_engine: "google",
      task: "Find public candidate pages",
      includeScreenshot: false,
      retry_urls: [],
    } as any)).toEqual({ result: true })
  })

  test("recognizes an access challenge page instead of treating it as research evidence", () => {
    expect(isBrowserResearchAccessLimitedPage("Verify you are human", "Complete the CAPTCHA to continue")).toBe(true)
    expect(isBrowserResearchAccessLimitedPage("登录 - Example", "请输入账号和密码后继续")).toBe(true)
    expect(isBrowserResearchAccessLimitedPage("Product pricing", "Annual plan and feature comparison")).toBe(false)
    expect(isBrowserResearchAccessLimitedPage("获取专业版 - Quicker", "首页 下载 专业版 登录 注册 功能与价格对比")).toBe(false)
  })

  test("is enabled on a clean machine when the desktop package supplies Chromium, Node, and the runner", async () => {
    await configureFakeBundledPlaywrightBridge()

    expect(BrowserResearchTool.isEnabled()).toBe(true)
    expect(isBrowserResearchRuntimeInstalled()).toBe(false)
    expect(await BrowserResearchTool.validateInput({
      url: "https://example.com/research",
      task: "Read a public research page",
      includeScreenshot: false,
      retry_urls: [],
    })).toEqual({ result: true })
    expect(isBrowserResearchRuntimeInstalled()).toBe(false)
  })
})

async function configureFakeBundledPlaywrightBridge(): Promise<void> {
  const configDir = await temporaryDirectory("browser-research-clean-config-")
  const bundledRuntimeDir = await temporaryDirectory("browser-research-bundled-runtime-")
  const nodeExecutable = join(await temporaryDirectory("browser-research-bundled-node-"), "node.exe")
  const executable = join(bundledRuntimeDir, "chromium_headless_shell-1", "chrome-win", "headless_shell.exe")
  await mkdir(join(bundledRuntimeDir, "chromium_headless_shell-1", "chrome-win"), { recursive: true })
  await writeFile(executable, "bundled runtime")
  await writeFile(join(bundledRuntimeDir, "browser-research-playwright-runner.cjs"), "runner")
  await writeFile(nodeExecutable, "node runtime")
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.CLAUDE_BROWSER_RUNTIME_DIR = bundledRuntimeDir
  process.env.CLAUDE_BUNDLED_NODE_EXECUTABLE = nodeExecutable
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}
