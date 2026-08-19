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
            statusStats: [
                { label: "状态", value: "就绪" },
                { label: "raw 文件", value: "3" },
                { label: "待处理", value: "1" },
                { label: "已完成", value: "1" },
                { label: "失败", value: "1" },
                { label: "已跳过", value: "0" },
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
        progress: null,
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

    it("keeps failed raw file details in a scrollable region", () => {
        act(() => {
            root.render(<LlmWikiPanel llmWiki={createHook()} />);
        });

        const failedRegion = host.querySelector(
            '[data-testid="llm-wiki-failed-details"]',
        );

        expect(failedRegion).not.toBeNull();
        expect(failedRegion?.className).toContain("max-h-48");
        expect(failedRegion?.className).toContain("overflow-auto");
    });

    it("shows active progress before failed raw file details", () => {
        act(() => {
            root.render(
                <LlmWikiPanel
                    llmWiki={createHook({
                        message: [
                            "正在处理 raw：1/5",
                            "当前：raw/notes/current.md",
                        ].join("\n"),
                        isProcessing: true,
                        activeOperation: "ingest",
                        activeOperationId: "llm-wiki-ingest-1",
                        activeOperationLabel: "正在处理 raw",
                    })}
                />,
            );
        });

        const progress = host.querySelector('[data-testid="llm-wiki-progress"]');
        const failed = host.querySelector(
            '[data-testid="llm-wiki-failed-details"]',
        );

        expect(progress).not.toBeNull();
        expect(failed).not.toBeNull();
        expect(
            progress?.compareDocumentPosition(failed as Node) ?? 0,
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it("keeps current progress visible above scrollable failure details", () => {
        act(() => {
            root.render(
                <LlmWikiPanel
                    llmWiki={createHook({
                        message: [
                            "正在处理 raw：3/10",
                            "当前：raw/articles/current.md",
                        ].join("\n"),
                        isProcessing: true,
                        activeOperation: "ingest",
                        activeOperationId: "llm-wiki-ingest-1",
                        activeOperationLabel: "正在处理 raw",
                        viewModel: {
                            ...createHook().viewModel,
                            failed: Array.from({ length: 50 }, (_, index) => ({
                                path: `raw/articles/failed-${index}.md`,
                                reason: "very long failure reason that should wrap inside the failure scroller",
                            })),
                        },
                    })}
                    onConfigureLlm={() => {}}
                />,
            );
        });

        const progress = host.querySelector('[data-testid="llm-wiki-progress"]');
        const failed = host.querySelector(
            '[data-testid="llm-wiki-failed-details"]',
        );

        expect(progress).not.toBeNull();
        expect(failed).not.toBeNull();
        expect(progress?.textContent).toContain("正在处理 raw");
        expect(failed?.textContent).toContain("failed-49.md");
        expect(
            progress?.compareDocumentPosition(failed as Node) ?? 0,
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it("renders a bounded progress preview for very large messages", () => {
        const largeMessage = Array.from(
            { length: 300 },
            (_, index) => `raw/large/note-${index}.md`,
        ).join("\n");

        act(() => {
            root.render(
                <LlmWikiPanel
                    llmWiki={createHook({
                        message: largeMessage,
                    })}
                />,
            );
        });

        const progress = host.querySelector('[data-testid="llm-wiki-progress"]');

        expect(progress).not.toBeNull();
        expect(progress?.textContent).toContain("raw/large/note-0.md");
        expect(progress?.textContent).not.toContain("raw/large/note-299.md");
        expect(progress?.textContent?.length ?? 0).toBeLessThan(5000);
    });

    it("allows question input while raw ingest is active", () => {
        act(() => {
            root.render(
                <LlmWikiPanel
                    llmWiki={createHook({
                        isProcessing: true,
                        activeOperation: "ingest",
                        activeOperationId: "llm-wiki-ingest-1",
                        activeOperationLabel: "正在处理 raw",
                    })}
                />,
            );
        });

        // The ask section is on the page rather than behind a tab, so the
        // question box is reachable without a navigation step.
        const question = host.querySelector("textarea");

        expect(question).not.toBeNull();
        expect(question?.disabled).toBe(false);
    });

    it("keeps digest controls disabled while raw ingest is active", () => {
        act(() => {
            root.render(
                <LlmWikiPanel
                    llmWiki={createHook({
                        isProcessing: true,
                        activeOperation: "ingest",
                        activeOperationId: "llm-wiki-ingest-1",
                        activeOperationLabel: "正在处理 raw",
                    })}
                />,
            );
        });

        // Digest is also on the page. Its fields stay disabled while an ingest
        // is running, which is the actual subject here.
        const digestTitle = host.querySelector("input");
        const textareas = host.querySelectorAll("textarea");
        // Two textareas now share the page: the question, then the digest topic.
        const digestPrompt = textareas[textareas.length - 1];

        expect(digestTitle).not.toBeNull();
        expect(digestPrompt).not.toBeUndefined();
        expect(digestTitle?.disabled).toBe(true);
        expect(digestPrompt.disabled).toBe(true);
    });
});

function getButton(host: HTMLElement, label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === label,
    );

    if (!button) {
        throw new Error(`Could not find button: ${label}`);
    }

    return button;
}
