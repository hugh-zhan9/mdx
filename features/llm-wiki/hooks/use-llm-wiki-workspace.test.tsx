// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useLlmWikiWorkspace,
  type LlmWikiWorkspaceHook,
} from "./use-llm-wiki-workspace";
import * as client from "../lib/llm-wiki-client";

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

    expect(latest?.viewModel.statusLines).toContain("待处理：8");
    expect(latest?.message).toBe("raw 扫描完成：8 个文件，8 个待处理。");
  });
});
