// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    EditorPane,
    assignEditorViewportRef,
    isEditorFindShortcut,
    isEditorReplaceShortcut,
    resolveEditorRootFromContent,
} from "./editor-pane";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./editor-kernel-adapter", () => ({
    DOMD: () => null,
    DOMDProvider: ({ children }: { children: React.ReactNode }) => children,
    toMarkdown: () => "",
    useEditor: () => null,
    useEditorStoreApi: () => null,
    useRenderData: () => null,
}));

vi.mock("./editor-mermaid-preview-layer", () => ({
    EditorMermaidPreviewLayer: () => null,
}));

describe("editor find/replace shortcuts", () => {
    it("recognizes Command+F and Ctrl+F without alt", () => {
        expect(
            isEditorFindShortcut({
                altKey: false,
                code: "KeyF",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(true);
        expect(
            isEditorFindShortcut({
                altKey: false,
                code: "KeyF",
                ctrlKey: true,
                metaKey: false,
            }),
        ).toBe(true);
        expect(
            isEditorFindShortcut({
                altKey: true,
                code: "KeyF",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(false);
    });

    it("recognizes Command+R and Ctrl+R without alt", () => {
        expect(
            isEditorReplaceShortcut({
                altKey: false,
                code: "KeyR",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(true);
        expect(
            isEditorReplaceShortcut({
                altKey: false,
                code: "KeyR",
                ctrlKey: true,
                metaKey: false,
            }),
        ).toBe(true);
        expect(
            isEditorReplaceShortcut({
                altKey: true,
                code: "KeyR",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(false);
    });
});

describe("editor pane root helpers", () => {
    it("assigns external editor viewport refs", () => {
        const viewport = {} as HTMLDivElement;
        const editorViewportRef: { current: HTMLDivElement | null } = {
            current: null,
        };

        assignEditorViewportRef(editorViewportRef, viewport);

        expect(editorViewportRef.current).toBe(viewport);

        assignEditorViewportRef(editorViewportRef, null);

        expect(editorViewportRef.current).toBeNull();
    });

    it("resolves the content wrapper when no MDX editor root exists", () => {
        const wrapper = {
            querySelector: vi.fn(() => null),
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(resolveEditorRootFromContent(null)).toBeNull();
    });

    it("prefers the MDX editor root inside the content wrapper", () => {
        const editorRoot = {} as HTMLElement;
        const wrapper = {
            querySelector: vi.fn(() => editorRoot),
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(editorRoot);
        expect(wrapper.querySelector).toHaveBeenCalledWith(
            "[data-mdx-editor-root]",
        );
    });

    it("can resolve from wrapper to the MDX editor root after it appears later", () => {
        const editorRoot = {} as HTMLElement;
        const querySelector = vi.fn<() => HTMLElement | null>()
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(editorRoot);
        const wrapper = {
            querySelector,
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(resolveEditorRootFromContent(wrapper)).toBe(editorRoot);
    });

});

describe("editor pane source mode chrome", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("exposes a source mode toggle for the self-owned editor", async () => {
        const tab = {
            tabId: "tab-1",
            path: "/tmp/note.md",
            title: "note.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: "# Title",
            baseFingerprint: "base",
        };

        await act(async () => {
            root.render(
                <EditorPane
                    rootPath="/tmp"
                    tab={tab}
                    onMarkdownChange={vi.fn()}
                />,
            );
        });

        expect(host.textContent).toContain("源码");
    });
});
