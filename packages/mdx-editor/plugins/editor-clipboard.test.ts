import type { Plugin } from "prosemirror-state";
import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import {
    clipboardTextToMarkdown,
    createMarkdownClipboardPlugin,
    MARKDOWN_CLIPBOARD_MIME,
    markdownToClipboardHtml,
} from "./editor-clipboard";

describe("markdown clipboard helpers", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders Markdown as rich clipboard HTML", () => {
        const html = markdownToClipboardHtml(
            "# Title\n\n---\n\nA **bold** [link](https://example.com).\n",
        );

        expect(html).toContain("<h1");
        expect(html).toContain("<hr");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain('href="https://example.com"');
    });

    it("keeps plain clipboard text as canonical Markdown", () => {
        expect(clipboardTextToMarkdown("plain\ntext")).toBe("plain\ntext");
    });

    it("sanitizes pasted clipboard HTML before Markdown conversion", () => {
        const markdown = clipboardTextToMarkdown(
            "Safe",
            "<p>Safe</p><script>alert(1)</script>",
        );

        expect(markdown).toContain("Safe");
        expect(markdown).not.toContain("script");
    });

    it("converts pasted horizontal rule HTML to Markdown", () => {
        vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);

        expect(clipboardTextToMarkdown("", "<p>Before</p><hr><p>After</p>")).toBe(
            "Before\n\n---\n\nAfter",
        );
    });

    it("sanitizes event handler attrs and javascript URLs without DOMParser", () => {
        vi.stubGlobal("DOMParser", undefined);

        const html = transformPastedHTML(
            `<p onclick="alert(1)">Safe <a href="java
script:alert(2)" onmouseover="alert(3)">link</a><img src='javascript:alert(4)' onerror='alert(5)'></p>`,
        );

        expect(html).toContain("Safe");
        expect(html).not.toContain("onclick");
        expect(html).not.toContain("onmouseover");
        expect(html).not.toContain("onerror");
        expect(html).not.toContain("javascript");
        expect(html).not.toContain("alert");
    });

    it("sanitizes malformed open script tags without DOMParser", () => {
        vi.stubGlobal("DOMParser", undefined);

        const html = transformPastedHTML("<p>Safe</p><script src=//x>");

        expect(html).toContain("Safe");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("src=//x");
    });
});

describe("markdown clipboard plugin", () => {
    it("copies selected heading text with heading markdown", () => {
        const plugin = createMarkdownClipboardPlugin();
        const headingText = "Spring Cloud中有用到哪些组件";
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.heading.create(
                { level: 2 },
                mdxEditorSchema.text(headingText),
            ),
        ]);
        const state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 1, 1 + headingText.length),
        });
        const view = fakeEditorView(state, () => {});
        const event = copyEvent();

        expect(handleCopy(plugin, view, event)).toBe(true);
        expect(event.clipboardData.getData("text/plain")).toBe(
            `## ${headingText}\n`,
        );
    });

    it("does not intercept ordinary plain text paste inside a paragraph", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("hello !"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: TextSelection.create(doc, 6),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            "text/plain": "world",
        });

        expect(handlePaste(plugin, view, event)).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(state.doc.childCount).toBe(1);
        expect(state.doc.child(0).type.name).toBe("paragraph");
        expect(state.doc.textContent).toBe("hello !");
    });

    it("uses internal Markdown clipboard MIME before text or HTML paste data", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("body"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: new AllSelection(doc),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            [MARKDOWN_CLIPBOARD_MIME]: "# Title\n",
            "text/html": "<p>HTML wins?</p>",
            "text/plain": "plain wins?",
        });

        expect(handlePaste(plugin, view, event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(state.doc.child(0).type.name).toBe("heading");
        expect(state.doc.child(0).textContent).toBe("Title");
    });

    it("parses plain text Markdown fences on paste", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("body"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: new AllSelection(doc),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            "text/plain": "```\n   1. cookie + redis实现\n```\n",
        });

        expect(handlePaste(plugin, view, event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(state.doc.child(0).type.name).toBe("code_block");
        expect(state.doc.child(0).textContent).toBe(
            "   1. cookie + redis实现\n",
        );
    });

    it("parses indented plain text Markdown fences on paste", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("body"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: new AllSelection(doc),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            "text/plain":
                "   ```\n   基本类型：byte、short、int、long、float、double、boolean、char\n   ```\n",
        });

        expect(handlePaste(plugin, view, event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(state.doc.child(0).type.name).toBe("code_block");
        expect(state.doc.child(0).textContent).toBe(
            "   基本类型：byte、short、int、long、float、double、boolean、char\n",
        );
    });

    it("parses plain text Markdown block structures on paste", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("body"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: new AllSelection(doc),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            "text/plain": "## Title\n\n- one\n  - two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
        });

        expect(handlePaste(plugin, view, event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(state.doc.child(0).type.name).toBe("heading");
        expect(state.doc.child(1).type.name).toBe("bullet_list");
        expect(state.doc.child(1).child(0).child(1).type.name).toBe("bullet_list");
        expect(state.doc.child(2).type.name).toBe("table");
    });

    it("parses plain text inline markdown links and images on paste", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("body"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: new AllSelection(doc),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            "text/plain": "![Alt](img.png)\n\n[百度](www.baidu.com)\n",
        });

        expect(handlePaste(plugin, view, event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(state.doc.child(0).child(0).type.name).toBe("image");
        expect(state.doc.child(1).child(0).marks[0]?.attrs.href).toBe(
            "www.baidu.com",
        );
    });

    it("prefers plain text Markdown fences over clipboard HTML", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("body"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: new AllSelection(doc),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            "text/html": "<p>```<br>html path would lose this<br>```</p>",
            "text/plain": "```\nplain path wins\n```\n",
        });

        expect(handlePaste(plugin, view, event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(state.doc.child(0).type.name).toBe("code_block");
        expect(state.doc.child(0).textContent).toBe("plain path wins\n");
    });

    it("normalizes escaped Markdown fences on paste", () => {
        const plugin = createMarkdownClipboardPlugin();
        const doc = mdxEditorSchema.nodes.doc.create(null, [
            mdxEditorSchema.nodes.paragraph.create(null, [
                mdxEditorSchema.text("body"),
            ]),
        ]);
        let state = EditorState.create({
            doc,
            schema: mdxEditorSchema,
            selection: new AllSelection(doc),
        });
        const view = fakeEditorView(state, (nextState) => {
            state = nextState;
        });
        const event = pasteEvent({
            "text/plain":
                "\\```\n    分库分表是把一个库的数据分散到多个库中\n    \\```\n",
        });

        expect(handlePaste(plugin, view, event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(state.doc.child(0).type.name).toBe("code_block");
        expect(state.doc.child(0).textContent).toBe(
            "    分库分表是把一个库的数据分散到多个库中\n",
        );
    });
});

function transformPastedHTML(html: string) {
    const plugin = createMarkdownClipboardPlugin();
    const transform = plugin.props.transformPastedHTML;

    expect(transform).toBeTypeOf("function");

    return transform?.call(plugin, html, {} as EditorView) ?? "";
}

function handlePaste(
    plugin: Plugin,
    view: EditorView,
    event: ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> },
) {
    return plugin.props.handleDOMEvents?.paste?.call(plugin, view, event) ?? false;
}

function handleCopy(
    plugin: Plugin,
    view: EditorView,
    event: ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> },
) {
    return plugin.props.handleDOMEvents?.copy?.call(plugin, view, event) ?? false;
}

function fakeEditorView(
    initialState: EditorState,
    setState: (state: EditorState) => void,
) {
    let currentState = initialState;

    return {
        get state() {
            return currentState;
        },
        dispatch(transaction) {
            currentState = currentState.apply(transaction);
            setState(currentState);
        },
    } as EditorView;
}

function pasteEvent(data: Record<string, string>) {
    return {
        clipboardData: {
            getData(type: string) {
                return data[type] ?? "";
            },
        },
        preventDefault: vi.fn(),
    } as unknown as ClipboardEvent & {
        preventDefault: ReturnType<typeof vi.fn>;
    };
}

function copyEvent() {
    const data = new Map<string, string>();

    return {
        clipboardData: {
            clearData() {
                data.clear();
            },
            getData(type: string) {
                return data.get(type) ?? "";
            },
            setData(type: string, value: string) {
                data.set(type, value);
            },
        },
        preventDefault: vi.fn(),
    } as unknown as ClipboardEvent & {
        preventDefault: ReturnType<typeof vi.fn>;
        clipboardData: DataTransfer & {
            getData(type: string): string;
        };
    };
}
