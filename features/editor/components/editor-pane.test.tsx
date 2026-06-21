// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    EditorPane,
    assignEditorViewportRef,
    imageFilesFromDataTransfer,
    isEditorFindShortcut,
    isEditorReplaceShortcut,
    resolveEditorRootFromContent,
} from "./editor-pane";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const bridgeMocks = vi.hoisted(() => ({
    focus: vi.fn(),
    getDocumentSelectionRange: vi.fn(),
    insertImage: vi.fn(),
    insertText: vi.fn(),
}));

vi.mock("../hooks/use-editor-bridge", () => ({
    useEditorBridge: () => ({
        currentMarkdown: "",
        focus: bridgeMocks.focus,
        getDocumentSelectionRange: bridgeMocks.getDocumentSelectionRange,
        insertImage: bridgeMocks.insertImage,
        insertText: bridgeMocks.insertText,
        selection: null,
    }),
}));

vi.mock("./editor-kernel-adapter", () => ({
    DOMD: () => <div data-testid="domd" />,
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

describe("editor pane image paste", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        bridgeMocks.focus.mockReset();
        bridgeMocks.getDocumentSelectionRange.mockReset();
        bridgeMocks.getDocumentSelectionRange.mockReturnValue({
            anchor: 6,
            head: 6,
        });
        bridgeMocks.insertImage.mockReset();
        bridgeMocks.insertText.mockReset();
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("extracts pasted images from clipboard items when files is empty", () => {
        const image = new File(["image"], "clip.png", { type: "image/png" });

        expect(
            imageFilesFromDataTransfer({
                files: [] as unknown as FileList,
                items: [
                    {
                        getAsFile: () => image,
                        kind: "file",
                        type: "image/png",
                    },
                ] as unknown as DataTransferItemList,
            } as DataTransfer),
        ).toEqual([image]);
    });

    it("stores pasted clipboard images and inserts markdown image syntax", async () => {
        const image = new File(["image"], "clip.png", { type: "image/png" });
        const storeImage = vi.fn(async () => ({
            altText: "clip.png",
            url: ".assets/clip.png",
        }));
        const tab = {
            tabId: "tab-1",
            path: "/tmp/note.md",
            title: "note.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: "",
            baseFingerprint: "base",
        };

        await act(async () => {
            root.render(
                <EditorPane
                    rootPath="/tmp"
                    tab={tab}
                    onMarkdownChange={vi.fn()}
                    storeImage={storeImage}
                />,
            );
        });

        const target = host.querySelector("[data-testid='domd']")?.parentElement;
        expect(target).not.toBeNull();

        const event = new Event("paste", {
            bubbles: true,
            cancelable: true,
        }) as ClipboardEvent;
        Object.defineProperty(event, "clipboardData", {
            value: {
                files: [] as unknown as FileList,
                items: [
                    {
                        getAsFile: () => image,
                        kind: "file",
                        type: "image/png",
                    },
                ] as unknown as DataTransferItemList,
            } as DataTransfer,
        });

        await act(async () => {
            target?.dispatchEvent(event);
            await flushPromises();
        });

        expect(storeImage).toHaveBeenCalledWith(image);
        expect(bridgeMocks.getDocumentSelectionRange).toHaveBeenCalledBefore(
            storeImage,
        );
        expect(bridgeMocks.insertImage).toHaveBeenCalledWith(
            ".assets/clip.png",
            "clip.png",
            {
                anchor: 6,
                head: 6,
            },
        );
        expect(event.defaultPrevented).toBe(true);
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

    it("does not render a global source mode switch", async () => {
        const tab = {
            tabId: "tab-1",
            path: "/tmp/note.md",
            title: "note.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: "# Title",
            baseFingerprint: "base",
        };
        const onMarkdownChange = vi.fn();
        const onPendingCliCommandHandled = vi.fn();

        await act(async () => {
            root.render(
                <EditorPane
                    rootPath="/tmp"
                    tab={tab}
                    onMarkdownChange={onMarkdownChange}
                    onPendingCliCommandHandled={onPendingCliCommandHandled}
                />,
            );
        });

        expect(
            host.querySelector('[role="group"][aria-label="编辑模式"]'),
        ).toBeNull();
        expect(
            Array.from(host.querySelectorAll("button")).some(
                (button) => button.textContent?.trim() === "源码",
            ),
        ).toBe(false);
    });
});

async function flushPromises() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}
