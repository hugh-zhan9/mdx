// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatPendingRawStartMessage,
  useLlmWikiWorkspace,
  type LlmWikiWorkspaceHook,
} from "./use-llm-wiki-workspace";
import * as client from "../lib/llm-wiki-client";
import type { LlmWikiQueryResponse } from "../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/llm-wiki-client", () => ({
  cancelLlmWikiOperation: vi.fn(),
  createDigest: vi.fn(),
  detectLlmWikiWorkspace: vi.fn(),
  getLlmConfig: vi.fn(),
  getLlmWikiOperationState: vi.fn(),
  ingestRawFile: vi.fn(),
  initializeLlmWikiWorkspace: vi.fn(),
  queryWiki: vi.fn(),
  refreshKnowledgeGraph: vi.fn(),
  rescanRaw: vi.fn(),
  runLint: vi.fn(),
}));

describe("useLlmWikiWorkspace", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.mocked(client.detectLlmWikiWorkspace).mockResolvedValue({
      mode: "llmWiki",
      hasLlmWiki: true,
      canInitialize: false,
      missingPaths: [],
    });
    vi.mocked(client.getLlmConfig).mockResolvedValue({
      baseUrl: "https://api.example.com/v1",
      model: "test-model",
      apiMode: "chat",
      hasApiKey: false,
    });
    vi.mocked(client.rescanRaw).mockResolvedValue({
      total: 8,
      pendingTotal: 8,
      pending: [
        "raw/notes/note-0.md",
        "raw/notes/note-1.md",
        "raw/notes/note-2.md",
        "raw/notes/note-3.md",
        "raw/notes/note-4.md",
      ],
      completed: [],
      failed: [],
      skipped: [],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("uses the backend pending total in scan completion messages", async () => {
    let latest: LlmWikiWorkspaceHook | null = null;

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki", {
        canAutoProcess: false,
      });
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {});

    expect(latest?.isReady).toBe(true);

    await act(async () => {
      await latest?.rescan();
    });
    await act(async () => {});

    expect(latest?.viewModel.statusStats).toContainEqual({
            label: "待处理",
            value: "8",
        });
    expect(latest?.message).toBe("raw 扫描完成：8 个文件，8 个待处理。");
  });

  it("requests a failed-file retry for manual raw rescans", async () => {
    let latest: LlmWikiWorkspaceHook | null = null;

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki", {
        canAutoProcess: false,
      });
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {});
    await act(async () => {});

    expect(latest?.isReady).toBe(true);

    await act(async () => {
      await latest?.rescan();
    });
    await act(async () => {});

    expect(client.rescanRaw).toHaveBeenCalledWith(
      "/tmp/wiki",
      [],
      undefined,
      true,
    );
  });

  it("refreshes wiki status when the app returns to the foreground", async () => {
    let latest: LlmWikiWorkspaceHook | null = null;

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki", {
        canAutoProcess: false,
      });
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {});

    expect(latest?.isReady).toBe(true);
    vi.mocked(client.detectLlmWikiWorkspace).mockClear();
    vi.mocked(client.getLlmConfig).mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});

    expect(client.detectLlmWikiWorkspace).toHaveBeenCalledWith("/tmp/wiki");
    expect(client.getLlmConfig).toHaveBeenCalled();
  });

  it("clears stale active operations when the backend operation is gone", async () => {
    vi.useFakeTimers();
    let latest: LlmWikiWorkspaceHook | null = null;
    let rejectIngest: ((error: unknown) => void) | null = null;

    vi.mocked(client.getLlmConfig).mockResolvedValue({
      baseUrl: "https://api.example.com/v1",
      model: "test-model",
      apiMode: "chat",
      hasApiKey: true,
    });
    vi.mocked(client.rescanRaw).mockResolvedValue({
      total: 1,
      pendingTotal: 1,
      pending: ["raw/notes/a.md"],
      completed: [],
      failed: [],
      skipped: [],
    });
    vi.mocked(client.ingestRawFile).mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectIngest = reject;
        }),
    );
    vi.mocked(client.getLlmWikiOperationState).mockRejectedValue({
      errorCode: "operation_not_found",
      message: "llm wiki operation was not found",
    });

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki", {
        canAutoProcess: false,
      });
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {});

    await act(async () => {
      void latest?.rescan();
    });
    await act(async () => {});

    expect(client.ingestRawFile).toHaveBeenCalledWith(
      "/tmp/wiki",
      "raw/notes/a.md",
      expect.any(String),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(latest?.activeOperation).toBeNull();

    await act(async () => {
      rejectIngest?.(new Error("cancelled"));
      await vi.runOnlyPendingTimersAsync();
    });
  });

  it("keeps background raw ingest active after a concurrent query finishes", async () => {
    let latest: LlmWikiWorkspaceHook | null = null;
    let rejectIngest: ((error: unknown) => void) | null = null;

    vi.mocked(client.getLlmConfig).mockResolvedValue({
      baseUrl: "https://api.example.com/v1",
      model: "test-model",
      apiMode: "chat",
      hasApiKey: true,
    });
    vi.mocked(client.rescanRaw).mockResolvedValue({
      total: 1,
      pendingTotal: 1,
      pending: ["raw/notes/a.md"],
      completed: [],
      failed: [],
      skipped: [],
    });
    vi.mocked(client.ingestRawFile).mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectIngest = reject;
        }),
    );
    vi.mocked(client.queryWiki).mockResolvedValue({
      answer: "answer",
      references: [],
      insufficientContext: false,
    });
    vi.mocked(client.getLlmWikiOperationState).mockResolvedValue({
      operationId: "llm-wiki-ingest-1",
      operation: "ingest",
      stage: "analyzing_raw",
      cancelled: false,
    });

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki", {
        canAutoProcess: false,
      });
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {});
    await act(async () => {});

    expect(latest?.isReady).toBe(true);

    await act(async () => {
      await latest?.rescan();
    });
    await act(async () => {});

    expect(latest?.activeOperation).toBe("ingest");

    await act(async () => {
      await latest?.query("What is indexed?");
    });
    await act(async () => {});

    expect(client.queryWiki).toHaveBeenCalledWith(
      "/tmp/wiki",
      "What is indexed?",
      expect.any(String),
    );
    expect(latest?.queryAnswer?.answer).toBe("answer");
    expect(latest?.activeOperation).toBe("ingest");

    await act(async () => {
      rejectIngest?.(new Error("cancelled"));
    });
  });

  it("does not start a second query while an ingest-time query is running", async () => {
    let latest: LlmWikiWorkspaceHook | null = null;
    let rejectIngest: ((error: unknown) => void) | null = null;
    let resolveQuery: ((response: LlmWikiQueryResponse) => void) | null =
      null;

    vi.mocked(client.getLlmConfig).mockResolvedValue({
      baseUrl: "https://api.example.com/v1",
      model: "test-model",
      apiMode: "chat",
      hasApiKey: true,
    });
    vi.mocked(client.rescanRaw).mockResolvedValue({
      total: 1,
      pendingTotal: 1,
      pending: ["raw/notes/a.md"],
      completed: [],
      failed: [],
      skipped: [],
    });
    vi.mocked(client.ingestRawFile).mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectIngest = reject;
        }),
    );
    vi.mocked(client.queryWiki).mockImplementation(
      () =>
        new Promise<LlmWikiQueryResponse>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    vi.mocked(client.getLlmWikiOperationState).mockResolvedValue({
      operationId: "llm-wiki-ingest-1",
      operation: "ingest",
      stage: "analyzing_raw",
      cancelled: false,
    });

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki", {
        canAutoProcess: false,
      });
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {});
    await act(async () => {});

    await act(async () => {
      await latest?.rescan();
    });
    await act(async () => {});

    expect(latest?.activeOperation).toBe("ingest");

    let firstQuery: Promise<void> | undefined;
    await act(async () => {
      firstQuery = latest?.query("first");
    });
    await act(async () => {
      void latest?.query("second");
    });

    expect(client.queryWiki).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveQuery?.({
        answer: "answer",
        references: [],
        insufficientContext: false,
      });
      await firstQuery;
      rejectIngest?.(new Error("cancelled"));
    });
  });

  it("shows failed raw details as soon as a background ingest failure is persisted", async () => {
    let latest: LlmWikiWorkspaceHook | null = null;
    let resolveAfterFailureRescan:
      | ((result: Awaited<ReturnType<typeof client.rescanRaw>>) => void)
      | null = null;
    const failedScan = {
      total: 1,
      pendingTotal: 0,
      pending: [],
      completed: [],
      failed: [
        {
          path: "raw/notes/a.md",
          reason: "pdf_extract_empty: no extractable text",
        },
      ],
      skipped: [],
    };
    let rescanCalls = 0;

    vi.mocked(client.getLlmConfig).mockResolvedValue({
      baseUrl: "https://api.example.com/v1",
      model: "test-model",
      apiMode: "chat",
      hasApiKey: true,
    });
    vi.mocked(client.rescanRaw).mockImplementation(() => {
      rescanCalls += 1;
      if (rescanCalls === 1) {
        return Promise.resolve({
          total: 1,
          pendingTotal: 1,
          pending: ["raw/notes/a.md"],
          completed: [],
          failed: [],
          skipped: [],
        });
      }
      if (rescanCalls === 2) {
        return Promise.resolve(failedScan);
      }
      if (rescanCalls === 3) {
        return new Promise((resolve) => {
          resolveAfterFailureRescan = resolve;
        });
      }
      return Promise.resolve(failedScan);
    });
    vi.mocked(client.ingestRawFile).mockRejectedValue(
      new Error("pdf_extract_empty: no extractable text"),
    );
    vi.mocked(client.getLlmWikiOperationState).mockResolvedValue({
      operationId: "llm-wiki-ingest-1",
      operation: "ingest",
      stage: "analyzing_raw",
      cancelled: false,
    });

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki", {
        canAutoProcess: false,
      });
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {});
    await act(async () => {});

    await act(async () => {
      await latest?.rescan();
    });
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {});
    }

    expect(client.rescanRaw).toHaveBeenCalledTimes(3);
    expect(latest?.viewModel.failed).toEqual(failedScan.failed);
    expect(latest?.viewModel.statusStats).toContainEqual({
            label: "失败",
            value: "1",
        });

    await act(async () => {
      resolveAfterFailureRescan?.(failedScan);
    });
    await act(async () => {});
  });

  it("does not retry persisted failures during automatic startup processing", async () => {
    let latest: LlmWikiWorkspaceHook | null = null;

    vi.mocked(client.getLlmConfig).mockResolvedValue({
      baseUrl: "https://api.example.com/v1",
      model: "test-model",
      apiMode: "chat",
      hasApiKey: true,
    });
    vi.mocked(client.rescanRaw).mockResolvedValue({
      total: 1,
      pendingTotal: 0,
      pending: [],
      completed: [],
      failed: [
        {
          path: "raw/notes/a.md",
          reason: "llm_failed: previous failure",
        },
      ],
      skipped: [],
    });

    function Harness() {
      const llmWiki = useLlmWikiWorkspace("/tmp/wiki");
      useEffect(() => {
        latest = llmWiki;
      }, [llmWiki]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {});
    }

    expect(latest?.isReady).toBe(true);
    expect(client.rescanRaw).toHaveBeenCalledWith("/tmp/wiki");
  });

  it("does not put every pending raw path into the background ingest start message", () => {
    const pending = Array.from(
      { length: 250 },
      (_, index) => `raw/large/note-${index}.md`,
    );

    const message = formatPendingRawStartMessage(0, pending);

    expect(message).toContain("待处理：250");
    expect(message).toContain("raw/large/note-0.md");
    expect(message).not.toContain("raw/large/note-249.md");
    expect(message.length).toBeLessThan(1000);
  });
});
