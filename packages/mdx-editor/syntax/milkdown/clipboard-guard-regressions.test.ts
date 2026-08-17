// @vitest-environment jsdom
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "./index";
import { pasteRejectedHtmlAsText } from "./source-preservation/clipboard-guard";
import {
    SESSION_TOKEN,
    SOURCE_TOKEN_ATTR,
} from "./source-preservation/session";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

async function mount(markdown: string): Promise<{
    host: MilkdownEditorHost;
    surface: HTMLElement;
    view: EditorView;
}> {
    const root = document.createElement("div");
    document.body.append(root);
    let view: EditorView | null = null;
    const capture = $prose(
        () =>
            new Plugin({
                key: new PluginKey("clipboard-guard-test-capture"),
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
    const surface = root.querySelector<HTMLElement>(".ProseMirror");
    if (!surface) throw new Error("editor surface did not mount");
    if (!view) throw new Error("editor view was never created");
    return { host, surface, view };
}

/** jsdom ships no DataTransfer; this records what the editor writes out. */
function createClipboardData() {
    const entries = new Map<string, string>();
    return {
        entries,
        transfer: {
            types: [] as string[],
            files: [] as File[],
            items: [] as DataTransferItem[],
            getData: (type: string) => entries.get(type) ?? "",
            setData: (type: string, value: string) => {
                entries.set(type, value);
            },
            clearData: () => entries.clear(),
        },
    };
}

function copyAll(host: MilkdownEditorHost, surface: HTMLElement): string {
    // ProseMirror serializes its own selection, not the DOM's, so the document
    // has to actually be selected before the copy handler produces anything.
    host.setSelection({ anchor: 0, head: host.getMarkdown().length });

    const clipboard = createClipboardData();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: clipboard.transfer,
    });
    surface.dispatchEvent(event);
    const html = clipboard.entries.get("text/html") ?? "";
    if (html.length === 0) {
        throw new Error(
            "copy produced no text/html; the assertions below would be vacuous",
        );
    }
    return html;
}

function paste(surface: HTMLElement, html: string, text: string): void {
    const clipboard = createClipboardData();
    clipboard.entries.set("text/html", html);
    clipboard.entries.set("text/plain", text);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: clipboard.transfer,
    });
    surface.dispatchEvent(event);
}

describe("regression: the session token is not disclosed with ordinary prose", () => {
    // The token was stamped on every element leaving for the clipboard,
    // including plain paragraphs. Copying prose into any other application
    // disclosed it, and a page that later put crafted HTML carrying it back on
    // the clipboard would have been trusted for the rest of the session.
    it("does not stamp a token on a plain paragraph", async () => {
        const { host, surface } = await mount("Just ordinary prose here.\n");
        const html = copyAll(host, surface);

        expect(html).not.toContain(SESSION_TOKEN);
        expect(html).not.toContain(SOURCE_TOKEN_ATTR);
    });

    it("does not stamp a token on emphasis or links", async () => {
        const { host, surface } = await mount(
            "Text with *emphasis* and [a link](https://example.test).\n",
        );
        const html = copyAll(host, surface);

        expect(html).not.toContain(SESSION_TOKEN);
    });

    it("still stamps a token on a preserved source node", async () => {
        const { host, surface } = await mount('<div class="note">kept</div>\n');
        const html = copyAll(host, surface);

        expect(html).toContain(SOURCE_TOKEN_ATTR);
        expect(html).toContain(SESSION_TOKEN);
    });
});

describe("regression: a rejected paste is not discarded", () => {
    // The guard answers a paste it cannot sanitize with the empty string, and
    // the comment claimed ProseMirror would then fall back to the clipboard's
    // plain text. It does not: `parseFromClipboard` has already taken the HTML
    // branch, so the empty string is an empty slice, and Milkdown's own
    // `handlePaste` dispatches it and reports the paste handled.
    const TOO_DEEP = `${"<div>".repeat(150)}payload${"</div>".repeat(150)}`;

    it("pastes the plain text when the html is nested too deeply", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(surface, TOO_DEEP, "payload");
        host.flush();

        expect(host.getMarkdown()).toContain("payload");
        expect(host.getMarkdown()).not.toContain("<div>");
    });

    it("keeps the markup out even though the text lands", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(
            surface,
            `${"<div>".repeat(150)}<b>x</b>${"</div>".repeat(150)}`,
            "<b>x</b>",
        );
        host.flush();

        // The bytes the user copied are what lands, as characters: nothing the
        // allowlist refused is re-read as markup.
        expect(surface.querySelector("b")).toBeNull();
        expect(host.getMarkdown()).toContain("x");
    });

    it("does not delete the selection when there is no text to fall back to", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 0, head: 5 });

        paste(surface, TOO_DEEP, "");
        host.flush();

        expect(host.getMarkdown()).toContain("start");
    });

    it("does not claim a paste that never carried html", async () => {
        // A rejection recorded by some earlier event — a drop, which has no
        // paste handler to clear it — must not divert a text-only paste away
        // from the ordinary Markdown-aware path.
        const { host, view } = await mount("start\n");
        const event = new Event("paste") as ClipboardEvent;
        Object.defineProperty(event, "clipboardData", {
            value: {
                getData: (type: string) => (type === "text/plain" ? "x" : ""),
            },
        });

        expect(pasteRejectedHtmlAsText(view, event, true)).toBe(false);
        host.flush();
        expect(host.getMarkdown()).toBe("start\n");
    });

    it("still pastes html the sanitizer accepts", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(surface, "<p>kept <em>here</em></p>", "kept here");
        host.flush();

        expect(host.getMarkdown()).toContain("*here*");
    });
});

describe("regression: the clipboard guard is actually installed", () => {
    // Removing the guard entirely used to break no test: every syntax family
    // delegates its trust decision to it without referencing it.
    it("strips foreign product metadata from pasted HTML", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(
            surface,
            '<div data-mdx-node-type="mdx_html_source" data-mdx-source-value="&lt;script&gt;x&lt;/script&gt;">forged</div>',
            "forged",
        );
        host.flush();

        expect(surface.querySelector("[data-mdx-node-type]")).toBeNull();
        expect(host.getMarkdown()).not.toContain("<script>");
    });

    it("refuses metadata carrying a token this session did not issue", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(
            surface,
            `<div data-mdx-node-type="mdx_html_source" ${SOURCE_TOKEN_ATTR}="not-this-session" data-mdx-source-value="x">forged</div>`,
            "forged",
        );
        host.flush();

        expect(surface.querySelector("[data-mdx-node-type]")).toBeNull();
    });

    it("refuses forged metadata for families that have no token check of their own", async () => {
        // callout, frontmatter, wikilink, mermaid and math all rely on the
        // guard rather than validating provenance themselves.
        const forgeries = [
            '<div data-callout data-callout-kind="WARNING">x</div>',
            '<pre data-frontmatter="yaml"><code>a: 1</code></pre>',
            '<span data-mdx-wikilink data-mdx-wikilink-target="Target">x</span>',
            '<div data-mdx-mermaid>graph TD</div>',
            '<span data-mdx-latex="x^2">x</span>',
        ];

        for (const html of forgeries) {
            const { host, surface } = await mount("start\n");
            host.setSelection({ anchor: 5, head: 5 });

            paste(surface, html, "x");
            host.flush();

            expect(
                surface.querySelector(
                    "[data-callout],[data-frontmatter],[data-mdx-wikilink],[data-mdx-mermaid],[data-mdx-latex]",
                ),
                `forgery survived: ${html}`,
            ).toBeNull();
        }
    });
});
