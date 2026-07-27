import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserResearchTool } from "./BrowserResearchTool.js";

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

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  if (originalBundledRuntimeDir === undefined) delete process.env.CLAUDE_BROWSER_RUNTIME_DIR
  else process.env.CLAUDE_BROWSER_RUNTIME_DIR = originalBundledRuntimeDir
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
        attempts: [{ url: "https://example.com/products", outcome: "success" }],
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
    expect(content).toContain("1. success: https://example.com/products")
    expect(content).toContain(
      "Local screenshot path: C:\\Users\\潘婧瑜\\.claude\\cc-jiangxia\\browser-research\\screenshots\\products.png",
    );
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

  test("is enabled on a clean machine when the desktop package supplies Chromium", async () => {
    const configDir = await temporaryDirectory("browser-research-clean-config-")
    const bundledRuntimeDir = await temporaryDirectory("browser-research-bundled-runtime-")
    const executable = join(bundledRuntimeDir, "chromium_headless_shell-1", "chrome-win", "headless_shell.exe")
    await mkdir(join(bundledRuntimeDir, "chromium_headless_shell-1", "chrome-win"), { recursive: true })
    await writeFile(executable, "bundled runtime")
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_BROWSER_RUNTIME_DIR = bundledRuntimeDir

    expect(BrowserResearchTool.isEnabled()).toBe(true)
    expect(await BrowserResearchTool.validateInput({
      url: "https://example.com/research",
      task: "Read a public research page",
      includeScreenshot: false,
      retry_urls: [],
    })).toEqual({ result: true })
  })
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}
