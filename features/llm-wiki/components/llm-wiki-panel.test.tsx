// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmWikiPanel } from "./llm-wiki-panel";
import type { LlmWikiWorkspaceHook } from "../hooks/use-llm-wiki-workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function createHook(
    overrides: Partial<LlmWikiWorkspaceHook> = {},
): LlmWikiWorkspaceHook {
    return {
        status: {
            mode: "llmWiki",
            hasLlmWiki: true,
            canInitialize: false,
            missingPaths: [],
        },
        viewModel: {
            title: "LLM Wiki",
            primaryAction: "重新扫描 raw",
            statusLines: [
                "状态：就绪",
                "raw 文件：3",
                "待处理：1",
                "已完成：1",
                "失败：1",
                "已跳过：0",
            ],
            failed: [
                {
                    path: "raw/notes/a.md",
                    reason: "llm_failed: first failure",
                },
            ],
            modes: [
                { id: "status", label: "状态", disabled: false },
                { id: "ask", label: "提问", disabled: false },
                { id: "digest", label: "综述", disabled: false },
            ],
            secondaryActions: [
                { id: "lint", label: "检查", disabled: false },
                { id: "graph", label: "图谱", disabled: false },
            ],
            emptyState: null,
        },
        message: null,
        queryAnswer: null,
        isReady: true,
        isLoading: false,
        isQuerying: false,
        isProcessing: false,
        activeOperation: null,
        activeOperationId: null,
        activeOperationLabel: null,
        activeStageLabel: null,
        cancelActiveOperation: vi.fn(),
        initialize: vi.fn(),
        rescan: vi.fn(),
        lint: vi.fn(),
        graph: vi.fn(),
        digest: vi.fn(),
        query: vi.fn(),
        refresh: vi.fn(),
        handleRawFileSaved: vi.fn(),
        ...overrides,
    };
}

describe("LlmWikiPanel", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        host.remove();
    });

    it("renders failed raw file details on the status tab", () => {
        act(() => {
            root.render(<LlmWikiPanel llmWiki={createHook()} />);
        });

        expect(host.textContent).toContain("失败明细");
        expect(host.textContent).toContain("raw/notes/a.md");
        expect(host.textContent).toContain("llm_failed: first failure");
    });
});
