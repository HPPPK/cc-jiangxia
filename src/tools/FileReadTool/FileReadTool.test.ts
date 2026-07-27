import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

type ImageProcessorMockState = {
  metadata: { width?: number; height?: number; format?: string };
  resizeCalls: Array<{ width: number; height: number }>;
  outputBuffer: Buffer;
};

const mockStateKey = "__ccJiangxiaImageProcessorMock";

function getMockState(): ImageProcessorMockState {
  return (globalThis as unknown as Record<string, ImageProcessorMockState>)[
    mockStateKey
  ];
}

function setMockState(state: ImageProcessorMockState): void {
  const globals = globalThis as unknown as Record<
    string,
    ImageProcessorMockState
  >;
  globals[mockStateKey] = state;
}

mock.module("./imageProcessor.js", () => ({
  getImageProcessor: async () => {
    return () => {
      const instance = {
        metadata: async () => getMockState().metadata,
        resize: (width: number, height: number) => {
          getMockState().resizeCalls.push({ width, height });
          return instance;
        },
        jpeg: () => instance,
        png: () => instance,
        webp: () => instance,
        toBuffer: async () => getMockState().outputBuffer,
      };
      return instance;
    };
  },
}));

const {
  FileReadTool,
  isExpertEvidenceResearchReadAllowed,
  readImageWithTokenBudget,
} = await import("./FileReadTool.js");

function makePngLikeBuffer(size: number): Buffer {
  const buffer = Buffer.alloc(size);
  buffer[0] = 0x89;
  buffer[1] = 0x50;
  buffer[2] = 0x4e;
  buffer[3] = 0x47;
  return buffer;
}

describe("readImageWithTokenBudget", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-read-image-test-"));
    setMockState({
      metadata: { width: 1920, height: 1080, format: "png" },
      resizeCalls: [],
      outputBuffer: Buffer.from("encoded"),
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("does not over-compress ordinary screenshots using base64 length as token count", async () => {
    const imageBuffer = makePngLikeBuffer(24_000);
    const filePath = join(tempDir, "screenshot.png");
    await writeFile(filePath, imageBuffer);

    const result = await readImageWithTokenBudget(filePath, 3_000);

    expect(result.file.base64).toBe(imageBuffer.toString("base64"));
    expect(result.file.dimensions).toEqual({
      originalWidth: 1920,
      originalHeight: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
    });
    expect(getMockState().resizeCalls).toEqual([]);
  });
});

describe("expert evidence research Read policy", () => {
  test("denies guessed workspace files when the user did not attach material", async () => {
    const context = {
      agentType: "expert-evidence-researcher",
      messages: [],
    } as never;

    const [readmeDecision, indexDecision] = await Promise.all([
      FileReadTool.checkPermissions({ file_path: "README.md" }, context),
      FileReadTool.checkPermissions({ file_path: "index.html" }, context),
    ]);

    expect(readmeDecision).toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("explicitly attached by the user"),
    });
    expect(indexDecision).toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("README.md or index.html"),
    });
  });

  test("allows only explicitly attached files and directories as evidence material", () => {
    const messages = [
      {
        type: "attachment",
        attachment: {
          type: "file",
          filename: "C:\\research\\user-brief.pdf",
          content: {},
          displayPath: "user-brief.pdf",
        },
      },
      {
        type: "attachment",
        attachment: {
          type: "directory",
          path: "C:\\research\\customer-interviews",
          content: "",
          displayPath: "customer-interviews",
        },
      },
    ] as never;

    expect(
      isExpertEvidenceResearchReadAllowed(
        "C:\\research\\user-brief.pdf",
        messages,
      ),
    ).toBe(true);
    expect(
      isExpertEvidenceResearchReadAllowed(
        "C:\\research\\customer-interviews\\session-01.md",
        messages,
      ),
    ).toBe(true);
    expect(
      isExpertEvidenceResearchReadAllowed("C:\\workspace\\README.md", messages),
    ).toBe(false);
  });
});
