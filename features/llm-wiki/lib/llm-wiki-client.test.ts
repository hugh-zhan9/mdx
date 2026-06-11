import { describe, expect, it, vi } from "vitest";
import { tauriCore } from "@/common/lib/tauri";
import {
  createDigest,
  ingestRawFile,
  queryWiki,
  rescanRaw,
  saveLlmConfig,
} from "./llm-wiki-client";

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: vi.fn(),
}));

describe("queryWiki", () => {
  it("invokes the real LLM Wiki query command with root path and question", async () => {
    const invoke = vi.fn(async () => ({
      answer: "回答",
      references: [],
      insufficientContext: false,
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(queryWiki("/tmp/wiki", "怎么使用？")).resolves.toEqual({
      answer: "回答",
      references: [],
      insufficientContext: false,
    });

    expect(invoke).toHaveBeenCalledWith("llm_wiki_query", {
      rootPath: "/tmp/wiki",
      question: "怎么使用？",
    });
  });
});

describe("ingestRawFile", () => {
  it("invokes the raw ingest command with root path and raw relative path", async () => {
    const invoke = vi.fn(async () => undefined);
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(
      ingestRawFile("/tmp/wiki", "raw/notes/a.md"),
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("llm_wiki_ingest_raw_file", {
      rootPath: "/tmp/wiki",
      rawRelativePath: "raw/notes/a.md",
    });
  });
});

describe("rescanRaw", () => {
  it("normalizes legacy raw scan responses from older backends", async () => {
    const invoke = vi.fn(async () => ({
      total: 1,
      pending: [],
      completed: ["raw/notes/a.md"],
      skipped: [],
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(rescanRaw("/tmp/wiki")).resolves.toEqual({
      total: 1,
      pendingTotal: 0,
      pending: [],
      completed: ["raw/notes/a.md"],
      failed: [],
      skipped: [],
    });

    expect(invoke).toHaveBeenCalledWith("llm_wiki_rescan_raw", {
      rootPath: "/tmp/wiki",
      excludedPendingPaths: [],
    });
  });

  it("passes excluded pending paths and failed files when continuing after failures", async () => {
    const invoke = vi.fn(async () => ({
      total: 2,
      pendingTotal: 1,
      pending: ["raw/notes/b.md"],
      completed: [],
      failed: [
        {
          path: "raw/notes/a.md",
          reason:
            "pdf_extract_empty: raw PDF source does not contain extractable text",
        },
      ],
      skipped: [],
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(
      rescanRaw("/tmp/wiki", ["raw/notes/a.md"], [
        {
          path: "raw/notes/a.md",
          reason:
            "pdf_extract_empty: raw PDF source does not contain extractable text",
        },
      ]),
    ).resolves.toEqual({
      total: 2,
      pendingTotal: 1,
      pending: ["raw/notes/b.md"],
      completed: [],
      failed: [
        {
          path: "raw/notes/a.md",
          reason:
            "pdf_extract_empty: raw PDF source does not contain extractable text",
        },
      ],
      skipped: [],
    });

    expect(invoke).toHaveBeenCalledWith("llm_wiki_rescan_raw", {
      rootPath: "/tmp/wiki",
      excludedPendingPaths: ["raw/notes/a.md"],
      failed: [
        {
          path: "raw/notes/a.md",
          reason:
            "pdf_extract_empty: raw PDF source does not contain extractable text",
        },
      ],
    });
  });

  it("asks the backend to retry persisted failures when requested", async () => {
    const invoke = vi.fn(async () => ({
      total: 2,
      pendingTotal: 2,
      pending: ["raw/notes/a.md", "raw/notes/b.md"],
      completed: [],
      failed: [],
      skipped: [],
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(rescanRaw("/tmp/wiki", [], undefined, true)).resolves.toEqual({
      total: 2,
      pendingTotal: 2,
      pending: ["raw/notes/a.md", "raw/notes/b.md"],
      completed: [],
      failed: [],
      skipped: [],
    });

    expect(invoke).toHaveBeenCalledWith("llm_wiki_rescan_raw", {
      rootPath: "/tmp/wiki",
      excludedPendingPaths: [],
      retryFailed: true,
    });
  });
});

describe("createDigest", () => {
  it("invokes the real digest command with title and prompt", async () => {
    const invoke = vi.fn(async () => "wiki/syntheses/project-summary.md");
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(
      createDigest("/tmp/wiki", "project-summary", "总结项目"),
    ).resolves.toBe("wiki/syntheses/project-summary.md");

    expect(invoke).toHaveBeenCalledWith("llm_wiki_digest", {
      rootPath: "/tmp/wiki",
      title: "project-summary",
      prompt: "总结项目",
    });
  });
});

describe("saveLlmConfig", () => {
  it("invokes the LLM config update command and preserves an existing key when requested", async () => {
    const invoke = vi.fn(async () => ({
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4.1-mini",
      apiMode: "responses",
      hasApiKey: true,
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await expect(
      saveLlmConfig({
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4.1-mini",
        apiMode: "responses",
        apiKey: "",
        preserveApiKey: true,
      }),
    ).resolves.toEqual({
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4.1-mini",
      apiMode: "responses",
      hasApiKey: true,
    });

    expect(invoke).toHaveBeenCalledWith("llm_config_update", {
      config: {
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4.1-mini",
        apiMode: "responses",
        apiKey: null,
        preserveApiKey: true,
      },
    });
  });
});
