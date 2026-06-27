// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    selectionOffsetsForVisibleTextMatch,
} from "../lib/visible-text-search";
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
    getLayoutSource: vi.fn(),
    insertImage: vi.fn(),
    insertText: vi.fn(),
    replaceRange: vi.fn(),
    setSelectionRange: vi.fn(),
}));
const layoutBridgeMocks = vi.hoisted(() => ({
    snapshotFromProseMirrorViaLayoutBridge: vi.fn(),
}));
const editorMermaidPreviewLayerMock = vi.hoisted(() => vi.fn());

vi.mock("../hooks/use-editor-bridge", () => ({
    useEditorBridge: () => ({
        currentMarkdown: bridgeMocks.currentMarkdown,
        focus: bridgeMocks.focus,
        getDocumentSelectionRange: bridgeMocks.getDocumentSelectionRange,
        getLayoutSource: bridgeMocks.getLayoutSource,
        insertImage: bridgeMocks.insertImage,
        insertText: bridgeMocks.insertText,
        replaceRange: bridgeMocks.replaceRange,
        setSelectionRange: bridgeMocks.setSelectionRange,
        selection: null,
    }),
}));

vi.mock("./editor-kernel-adapter", () => ({
    EditorKernelProvider: ({ children }: { children: React.ReactNode }) => children,
    toMarkdown: () => "",
    useEditor: () => null,
    useEditorStoreApi: () => null,
    useRenderData: () => null,
}));

vi.mock("../../../packages/mdx-editor/react/layout-bridge-runtime", () => ({
    snapshotFromProseMirrorViaLayoutBridge: (
        ...args: Parameters<
            typeof layoutBridgeMocks.snapshotFromProseMirrorViaLayoutBridge
        >
    ) => layoutBridgeMocks.snapshotFromProseMirrorViaLayoutBridge(...args),
}));

vi.mock("./editor-mermaid-preview-layer", () => ({
    EditorMermaidPreviewLayer: () => {
        editorMermaidPreviewLayerMock();
        return null;
    },
}));

beforeEach(() => {
    bridgeMocks.currentMarkdown = "";
    bridgeMocks.getLayoutSource.mockReset();
    bridgeMocks.getLayoutSource.mockImplementation(() => ({
        doc: { textContent: bridgeMocks.currentMarkdown },
        revision: 1,
    }));
    bridgeMocks.setSelectionRange.mockReset();
    layoutBridgeMocks.snapshotFromProseMirrorViaLayoutBridge.mockReset();
    layoutBridgeMocks.snapshotFromProseMirrorViaLayoutBridge.mockImplementation(
        async (doc: { textContent: string }) =>
            testSnapshotFromMarkdown(doc.textContent),
    );
    editorMermaidPreviewLayerMock.mockReset();
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

    it("uses the visible content wrapper even if legacy editor roots are present", () => {
        const wrapper = {
            querySelector: vi.fn(() => ({} as HTMLElement)),
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(wrapper.querySelector).not.toHaveBeenCalled();
    });

    it("keeps returning the wrapper when children appear later", () => {
        const querySelector = vi.fn<() => HTMLElement | null>();
        const wrapper = {
            querySelector,
        } as unknown as HTMLElement;

        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(resolveEditorRootFromContent(wrapper)).toBe(wrapper);
        expect(querySelector).not.toHaveBeenCalled();
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
    bridgeMocks.replaceRange.mockReset();
    bridgeMocks.setSelectionRange.mockReset();
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
            await flushPromises();
        });

        expect(host.querySelector("[data-mdx-editor-shell]")).not.toBeNull();
        expect(host.querySelector("[data-mdx-editor-column]")).not.toBeNull();
        expect(host.querySelector("[data-hybrid-editor-host]")).not.toBeNull();
        expect(host.querySelector("[data-mdx-editor-root]")).toBeNull();
        expect(host.querySelector("[data-tex-dom-text-layer]")).not.toBeNull();
    });

    it("syncs visible text-run pointer offsets into the editor selection", async () => {
        bridgeMocks.currentMarkdown = "Plain text";
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
            await flushPromises();
        });

        const run = host.querySelector<HTMLElement>("[data-layout-run-id]");
        expect(run).not.toBeNull();
        Object.defineProperty(run, "getBoundingClientRect", {
            value: () => ({
                bottom: 20,
                height: 20,
                left: 0,
                right: 80,
                top: 0,
                width: 80,
                x: 0,
                y: 0,
                toJSON: () => {},
            }),
        });

        await act(async () => {
            run!.dispatchEvent(
                new MouseEvent("pointerdown", {
                    bubbles: true,
                    clientX: 40,
                    clientY: 10,
                }),
            );
        });

        expect(bridgeMocks.setSelectionRange).toHaveBeenCalledWith({
            anchor: 5,
            head: 5,
        });
    });

    it("does not emit markdown persistence changes when rendering the hybrid host snapshot", async () => {
        bridgeMocks.currentMarkdown = "# Markdown shell";
        const onMarkdownChange = vi.fn();
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
                    onMarkdownChange={onMarkdownChange}
                />,
            );
            await flushPromises();
        });

        expect(host.querySelector("[data-hybrid-editor-host]")).not.toBeNull();
        expect(onMarkdownChange).not.toHaveBeenCalled();
    });

    it("builds the visible snapshot through the layout bridge contract", async () => {
        bridgeMocks.currentMarkdown = "# Markdown shell";
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
            await flushPromises();
        });

        expect(
            layoutBridgeMocks.snapshotFromProseMirrorViaLayoutBridge,
        ).toHaveBeenCalledWith(
            expect.objectContaining({ textContent: "# Markdown shell" }),
            1,
            expect.objectContaining({
                width: 800,
                height: 600,
            }),
        );
    });

    it("populates mirror blocks for runtime math content in the hybrid host path", async () => {
        bridgeMocks.currentMarkdown = "Before $x^2$ after";
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
            await flushPromises();
        });

        const hostNode = host.querySelector("[data-hybrid-editor-host]");
        expect(host.querySelectorAll("[data-mirror-block-id]")).toHaveLength(1);
        expect(
            host.querySelectorAll("[data-layout-complex-block-overlay='math']"),
        ).toHaveLength(1);
        expect(hostNode?.textContent).toContain("x^2");
    });

    it("bridges copy events from mirror selections through clipboard text", async () => {
        bridgeMocks.currentMarkdown = "Before $x^2$ after";
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
            await flushPromises();
        });

        const mirrorTextNode = host.querySelector(
            "[data-mirror-block-id]",
        )?.firstChild;
        expect(mirrorTextNode?.textContent).toBe("x^2");

        const range = document.createRange();
        range.selectNodeContents(mirrorTextNode as Node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const setData = vi.fn();
        const event = new Event("copy", {
            bubbles: true,
            cancelable: true,
        }) as ClipboardEvent;
        Object.defineProperty(event, "clipboardData", {
            value: { setData },
        });

        await act(async () => {
            (mirrorTextNode?.parentNode as Node | null)?.dispatchEvent(event);
        });

        expect(setData).toHaveBeenCalledWith("text/plain", "x^2");
    });

    it("keeps hybrid mirror markdown offsets available without a mounted editor root", async () => {
        bridgeMocks.currentMarkdown = "Before $x^2$ after";
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
            await flushPromises();
        });

        const hybridRoot = host.querySelector("[data-hybrid-editor-host]");

        expect(hybridRoot).not.toBeNull();

        const mirrorRoot = host.querySelector("[data-layout-light-mirror]");
        expect(mirrorRoot).not.toBeNull();

        const hybridIndex = buildVisibleTextIndex(mirrorRoot!);
        const [hybridMatch] = findVisibleTextMatches(hybridIndex, "x^2", {
            caseSensitive: true,
        });

        expect(hybridMatch).toBeDefined();
        expect(
            selectionOffsetsForVisibleTextMatch(hybridIndex, hybridMatch!),
        ).toEqual({
            anchor: 8,
            head: 11,
        });
    });

    it("renders mermaid source semantics through the hybrid snapshot path", async () => {
        bridgeMocks.currentMarkdown = "```mermaid\ngraph TD\n  A --> B\n```\n";
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
            await flushPromises();
        });

        const hybridRoot = host.querySelector("[data-hybrid-editor-host]");
        const hybridIndex = buildVisibleTextIndex(hybridRoot!);
        const [graphMatch] = findVisibleTextMatches(hybridIndex, "graph TD", {
            caseSensitive: true,
        });

        expect(hybridRoot).not.toBeNull();
        expect(hybridRoot?.textContent).toContain("graph TD");
        expect(hybridRoot?.textContent).toContain("A --> B");
        expect(hybridRoot?.textContent).not.toContain("```mermaid");
        expect(graphMatch).toBeDefined();
        expect(editorMermaidPreviewLayerMock).not.toHaveBeenCalled();
        expect(host.querySelector("[data-mirror-block-id]")?.textContent).toContain(
            "graph TD",
        );
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
            await flushPromises();
        });

        const contentRoot = host.querySelector<HTMLElement>("[data-mdx-editor-column]");
        expect(contentRoot).not.toBeNull();
        await waitFor(() => {
            expect(host.querySelector("[data-tex-dom-text-layer]")).not.toBeNull();
            expect(buildVisibleTextIndex(contentRoot!).text).toContain("语法");
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
        expect(input).not.toBeNull();

        await act(async () => {
            setInputValue(input!, "语法");
            dispatchInputChange(input!);
            await flushPromises();
            await flushPromises();
        });

        expect(input!.value).toBe("语法");
        expect(
            findVisibleTextMatches(buildVisibleTextIndex(contentRoot!), "语法", {
                caseSensitive: false,
            }),
        ).toHaveLength(1);

        const paragraph = document.createElement("p");
        paragraph.textContent = "Markdown 语法支持检查";
        paragraph.scrollIntoView = vi.fn();

        await act(async () => {
            contentRoot!.append(paragraph);
            await flushPromises();
        });

        expect(window.getSelection()?.toString()).toBe("语法");
        expect(host.querySelector("[data-tex-dom-text-layer]")).not.toBeNull();
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
            await flushPromises();
        });

        const contentRoot = host.querySelector<HTMLElement>("[data-mdx-editor-column]");
        expect(contentRoot).not.toBeNull();
        await waitFor(() => {
            expect(host.querySelector("[data-tex-dom-text-layer]")).not.toBeNull();
            expect(buildVisibleTextIndex(contentRoot!).text).toContain("语法 A");
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
            dispatchInputChange(input!);
            await flushPromises();
            await flushPromises();
        });

        expect(input!.value).toBe("语法");
        expect(
            findVisibleTextMatches(buildVisibleTextIndex(contentRoot!), "语法", {
                caseSensitive: false,
            }),
        ).toHaveLength(2);

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
        expect(host.querySelector("input[aria-label='查找']")).not.toBeNull();
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

async function waitFor(assertion: () => void) {
    let lastError: unknown;

    for (let index = 0; index < 20; index += 1) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
        }

        await act(async () => {
            await flushPromises();
        });
    }

    throw lastError;
}

function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
    )?.set;
    const previousValue = input.value;

    setter?.call(input, value);
    (
        input as HTMLInputElement & {
            _valueTracker?: { setValue: (value: string) => void };
        }
    )._valueTracker?.setValue(previousValue);
}

function dispatchInputChange(input: HTMLInputElement) {
    const nativeEvent =
        typeof InputEvent === "undefined"
            ? new Event("input", { bubbles: true })
            : new InputEvent("input", {
                  bubbles: true,
                  data: input.value,
                  inputType: "insertText",
              });
    input.dispatchEvent(
        nativeEvent,
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

    const reactPropsKey = Object.keys(input).find((key) =>
        key.startsWith("__reactProps$"),
    );
    const reactProps = reactPropsKey
        ? ((input as unknown as Record<string, unknown>)[reactPropsKey] as
              | {
                    onChange?: (event: {
                        currentTarget: HTMLInputElement;
                        nativeEvent: Event;
                        target: HTMLInputElement;
                    }) => void;
                    onCompositionEnd?: (event: {
                        currentTarget: HTMLInputElement;
                    }) => void;
                }
              | undefined)
        : undefined;

    reactProps?.onChange?.({
        currentTarget: input,
        nativeEvent,
        target: input,
    });
    reactProps?.onCompositionEnd?.({
        currentTarget: input,
    });
}

function testSnapshotFromMarkdown(markdown: string) {
    const mirrorBlocks = [];
    const canvasDrawOps = [];
    const mathStart = markdown.indexOf("$x^2$");
    if (mathStart !== -1) {
        mirrorBlocks.push({
            blockId: "block-0-math-8-11",
            pmFrom: mathStart + 1,
            pmTo: mathStart + 4,
            semanticText: "x^2",
            ariaLabel: "math x^2",
        });
        canvasDrawOps.push({
            blockId: "block-0-math-8-11",
            kind: "math",
            x: 48,
            y: 0,
            width: 32,
            height: 20,
            data: {
                content: "x^2",
                latex: "x^2",
            },
        });
    }

    const mermaidStart = markdown.indexOf("graph TD");
    if (mermaidStart !== -1) {
        const mermaidText = markdown
            .replace(/^```mermaid\r?\n/u, "")
            .replace(/\r?\n```\r?$/u, "");
        mirrorBlocks.push({
            blockId: "block-0",
            pmFrom: mermaidStart,
            pmTo: mermaidStart + mermaidText.length,
            semanticText: `${mermaidText}\n`,
            ariaLabel: `mermaid ${mermaidText}`,
        });
        canvasDrawOps.push({
            blockId: "block-0",
            kind: "mermaid",
            x: 0,
            y: 0,
            width: 160,
            height: 48,
            data: {
                code: mermaidText,
            },
        });
    }

    const plainText = markdown
        .replace(/\$x\^2\$/u, "")
        .replace(/^```mermaid\r?\n/u, "")
        .replace(/\r?\n```\r?$/u, "");

    return {
        revision: 1,
        lines:
            plainText.length === 0
                ? []
                : [
                      {
                          id: "line-0",
                          blockId: "block-0",
                          y: 0,
                          baseline: 16,
                          height: 20,
                          textRuns: [
                              {
                                  blockId: "block-0",
                                  pmFrom: 0,
                                  pmTo: plainText.length,
                                  left: 0,
                                  baseline: 16,
                                  width: Math.max(plainText.length * 8, 1),
                                  height: 20,
                                  fontFamily: "Inter",
                                  fontSize: 14,
                                  text: plainText,
                              },
                          ],
                      },
                  ],
        canvasDrawOps,
        hitTestEntries: [],
        caretAnchors: [],
        selectionGeometries: [],
        mirrorBlocks,
    };
}
