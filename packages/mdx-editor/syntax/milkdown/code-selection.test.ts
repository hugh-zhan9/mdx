// @vitest-environment jsdom
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import { createMilkdownEditorHost } from "../../milkdown/editor-host";
import type { MilkdownEditorHost } from "../../milkdown/editor-host";
import { selectInsideCode } from "./code-selection";
import { createMdxMilkdownPlugins } from "./index";

/** Everything the note says, which is what selecting the whole document takes. */
const WHOLE_NOTE = ["Before the code.", "int x = 1;", "int y = 2;", "After the code."];

/**
 * Which key "Mod" is here.
 *
 * `prosemirror-keymap` binds `Mod-` to Command on macOS and Control everywhere
 * else, deciding from `navigator.platform` — which this environment leaves empty.
 * The press has to be the one the binding is listening for, so it is decided the
 * same way rather than assumed.
 */
const MOD: "metaKey" | "ctrlKey" = /Mac|iP(hone|[oa]d)/.test(
    navigator.platform,
)
    ? "metaKey"
    : "ctrlKey";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

async function mount(markdown: string) {
    const root = document.createElement("div");
    document.body.append(root);

    let view: EditorView | null = null;
    const capture = $prose(
        () =>
            new Plugin({
                key: new PluginKey("code-selection-test-capture"),
                view: (editorView) => {
                    view = editorView;
                    return {};
                },
            }),
    );

    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: [...createMdxMilkdownPlugins(), capture],
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);

    if (!view) throw new Error("editor view was never created");

    return { host, view: view as EditorView };
}

/** Presses the platform's select-all. */
function selectAll(view: EditorView): boolean {
    const event = new KeyboardEvent("keydown", {
        key: "a",
        [MOD]: true,
        bubbles: true,
        cancelable: true,
    });
    view.dom.dispatchEvent(event);

    return event.defaultPrevented;
}

/** What the selection covers, as the document's own text. */
function selectedText(view: EditorView): string {
    const { from, to } = view.state.selection;

    return view.state.doc.textBetween(from, to, "\n");
}

/** Puts the caret at a source offset, where the Markdown spells it. */
function caretAt(host: MilkdownEditorHost, markdown: string, needle: string) {
    const at = markdown.indexOf(needle);

    expect(at).toBeGreaterThanOrEqual(0);
    expect(host.setSelection({ anchor: at, head: at })).toBe(true);
}

const NOTE = [
    "Before the code.",
    "",
    "```java",
    "int x = 1;",
    "int y = 2;",
    "```",
    "",
    "After the code.",
    "",
].join("\n");

describe("selecting everything from inside a block of code", () => {
    it("takes the code, not the note", async () => {
        const { host, view } = await mount(NOTE);
        caretAt(host, NOTE, "int y");

        selectAll(view);

        expect(selectedText(view)).toBe("int x = 1;\nint y = 2;");
    });

    it("takes the note on the second press", async () => {
        // A selection that already covers the block declines the key, and the
        // editor's own select-all — which is next in the chain — answers it. The
        // escalation costs no state of its own.
        const { host, view } = await mount(NOTE);
        caretAt(host, NOTE, "int y");

        selectAll(view);
        expect(selectInsideCode(view.state, undefined)).toBe(false);
        selectAll(view);

        for (const line of WHOLE_NOTE) {
            expect(selectedText(view)).toContain(line);
        }
    });

    it("takes the note when the caret is in prose", async () => {
        const { host, view } = await mount(NOTE);
        caretAt(host, NOTE, "Before");

        selectAll(view);

        for (const line of WHOLE_NOTE) {
            expect(selectedText(view)).toContain(line);
        }
    });

    it("takes a diagram's fence, not the note", async () => {
        // Judged on the schema's `code` flag, so a diagram answers for itself.
        const markdown = "Text.\n\n```mermaid\ngraph TD\n  A --> B\n```\n";
        const { host, view } = await mount(markdown);
        caretAt(host, markdown, "A --> B");

        selectAll(view);

        expect(selectedText(view)).toBe("graph TD\n  A --> B");
    });

    it("leaves an empty code block to the note", async () => {
        // There is nothing in it to take, and a press that selected nothing
        // would read as the key having been swallowed.
        const markdown = "Text.\n\n```java\n```\n";
        const { host, view } = await mount(markdown);
        caretAt(host, markdown, "```java\n```");

        selectAll(view);

        expect(selectedText(view)).toContain("Text.");
        expect(selectInsideCode(view.state, undefined)).toBe(false);
    });
});
