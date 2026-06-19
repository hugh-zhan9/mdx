import type { Plugin } from "prosemirror-state";
import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
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
            "# Title\n\nA **bold** [link](https://example.com).\n",
        );

        expect(html).toContain("<h1");
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
