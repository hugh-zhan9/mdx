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
    currentMarkdown: "",
    focus: vi.fn(),
    getDocumentSelectionRange: vi.fn(),
    insertImage: vi.fn(),
    insertText: vi.fn(),
}));

vi.mock("../hooks/use-editor-bridge", () => ({
    useEditorBridge: () => ({
        currentMarkdown: bridgeMocks.currentMarkdown,
        focus: bridgeMocks.focus,
        getDocumentSelectionRange: bridgeMocks.getDocumentSelectionRange,
        insertImage: bridgeMocks.insertImage,
        insertText: bridgeMocks.insertText,
        selection: null,
    }),
}));

vi.mock("./editor-kernel-adapter", () => ({
    DOMD: () => <div data-mdx-editor-root data-testid="domd" />,
    DOMDProvider: ({ children }: { children: React.ReactNode }) => children,
    toMarkdown: () => "",
    useEditor: () => null,
    useEditorStoreApi: () => null,
    useRenderData: () => null,
}));

vi.mock("../../../packages/mdx-editor/react/hybrid-editor-host", () => ({
    HybridEditorHost: () => <div data-hybrid-editor-host data-testid="hybrid-editor-host" />,
}));

vi.mock("./editor-mermaid-preview-layer", () => ({
    EditorMermaidPreviewLayer: () => null,
}));

beforeEach(() => {
    bridgeMocks.currentMarkdown = "";
});

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

        const target = host.querySelector("[data-mdx-editor-column]");
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

    it("wraps markdown content in the reading shell", async () => {
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
                />,
            );
        });

        expect(host.querySelector("[data-mdx-editor-shell]")).not.toBeNull();
        expect(host.querySelector("[data-mdx-editor-column]")).not.toBeNull();
        expect(host.querySelector("[data-hybrid-editor-host]")).not.toBeNull();
        expect(
            host.querySelector("[data-legacy-editor-fixture] [data-mdx-editor-root]"),
        ).not.toBeNull();
        expect(host.querySelector("[data-mdx-editor-root]")).not.toBeNull();
    });

    it("rebuilds find ranges when editor text mounts after markdown fallback", async () => {
        bridgeMocks.currentMarkdown = "# Markdown 语法支持检查";
        const tab = {
            tabId: "tab-1",
            path: "/tmp/note.md",
            title: "note.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: bridgeMocks.currentMarkdown,
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

        const editorRoot = host.querySelector<HTMLElement>(
            "[data-mdx-editor-root]",
        );
        const contentRoot = host.querySelector<HTMLElement>("[data-mdx-editor-column]");
        expect(editorRoot).not.toBeNull();
        expect(contentRoot).not.toBeNull();

        await act(async () => {
            contentRoot?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    code: "KeyF",
                    ctrlKey: true,
                }),
            );
        });

        const input = host.querySelector<HTMLInputElement>(
            "input[aria-label='查找']",
        );
        expect(input).not.toBeNull();

        await act(async () => {
            setInputValue(input!, "语法");
            input!.dispatchEvent(new Event("input", { bubbles: true }));
            await flushPromises();
        });

        expect(host.textContent).toContain("1/1");

        const paragraph = document.createElement("p");
        paragraph.textContent = "Markdown 语法支持检查";
        paragraph.scrollIntoView = vi.fn();

        await act(async () => {
            editorRoot!.append(paragraph);
            await flushPromises();
        });

        expect(window.getSelection()?.toString()).toBe("语法");
        expect(paragraph.scrollIntoView).toHaveBeenCalled();
    });

    it("uses Enter in the editor body to navigate find results while find is open", async () => {
        bridgeMocks.currentMarkdown = "语法 A 语法 B";
        const tab = {
            tabId: "tab-1",
            path: "/tmp/note.md",
            title: "note.md",
            dirty: false,
            needsRenameOnFirstSave: false,
            markdown: bridgeMocks.currentMarkdown,
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

        const editorRoot = host.querySelector<HTMLElement>(
            "[data-mdx-editor-root]",
        );
        const contentRoot = host.querySelector<HTMLElement>("[data-mdx-editor-column]");
        const paragraph = document.createElement("p");
        paragraph.textContent = "语法 A 语法 B";
        paragraph.scrollIntoView = vi.fn();

        await act(async () => {
            editorRoot!.append(paragraph);
            await flushPromises();
        });

        await act(async () => {
            contentRoot?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    code: "KeyF",
                    ctrlKey: true,
                }),
            );
        });

        const input = host.querySelector<HTMLInputElement>(
            "input[aria-label='查找']",
        );

        await act(async () => {
            setInputValue(input!, "语法");
            input!.dispatchEvent(new Event("input", { bubbles: true }));
            await flushPromises();
        });

        expect(host.textContent).toContain("1/2");

        const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
        });

        await act(async () => {
            contentRoot?.dispatchEvent(event);
            await flushPromises();
        });

        expect(event.defaultPrevented).toBe(true);
        expect(host.textContent).toContain("2/2");
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

function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
    )?.set;

    setter?.call(input, value);
}
