// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";

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
}> {
    const root = document.createElement("div");
    document.body.append(root);
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: createMdxMilkdownPlugins(),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    const surface = root.querySelector<HTMLElement>(".ProseMirror");
    if (!surface) throw new Error("editor surface did not mount");
    return { host, surface };
}

/**
 * jsdom has no clipboard, so paste is delivered the way the browser would: a
 * `paste` event carrying a DataTransfer. ProseMirror reads the payload off the
 * event, which is the path this exercises.
 */
function paste(
    surface: HTMLElement,
    payload: { text?: string; html?: string },
): void {
    // jsdom ships no DataTransfer, so this provides the surface ProseMirror
    // actually reads off a paste event.
    const entries = new Map<string, string>();
    if (payload.text !== undefined) entries.set("text/plain", payload.text);
    if (payload.html !== undefined) entries.set("text/html", payload.html);
    const clipboardData = {
        types: [...entries.keys()],
        files: [] as File[],
        items: [] as DataTransferItem[],
        getData: (type: string) => entries.get(type) ?? "",
        setData: (type: string, value: string) => entries.set(type, value),
    };
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    surface.dispatchEvent(event);
}

describe("clipboard — pasted plain text is inserted literally", () => {
    // Milkdown's clipboard plugin inserts plain text as text; it does not run
    // the Markdown parser over it. These pin what the editor actually does so
    // that adding Markdown-aware paste has to update them deliberately. The
    // consequence is real and user-visible: block markers are dropped, so
    // pasted Markdown does not survive as Markdown.
    //
    // Inline punctuation, in contrast, is written as it was pasted. Pasted text
    // has no source to preserve, and the recorded rule is that the characters
    // the user put in are the characters written out — so `[[1]]` pasted out of
    // a code fence is `[[1]]` in the file, and means a wikilink on the next
    // open. Escaping it instead would write a backslash the user did not paste,
    // and that backslash would then be authored content nothing removes.
    it("drops block markers from pasted Markdown", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(surface, { text: "\n\n## Pasted heading\n" });
        host.flush();

        const result = host.getMarkdown();
        expect(result).toContain("Pasted heading");
        expect(result).not.toContain("## Pasted heading");
    });

    it("writes brackets in pasted text as they were pasted", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(surface, { text: "```js\nconst a = [[1]];\n```" });
        host.flush();

        const result = host.getMarkdown();
        expect(result).toContain("[[1]]");
        expect(result).not.toContain("\\[");
    });

    it("keeps a pasted wikilink intact", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(surface, { text: " see [[Target Page]]" });
        host.flush();

        const result = host.getMarkdown();
        expect(result).toContain("[[Target Page]]");
        expect(result).not.toContain("\\[\\[Target Page]]");
    });
});

describe("clipboard — pasted HTML cannot smuggle in behavior", () => {
    it("does not execute a script arriving as clipboard HTML", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });
        (window as Window & { __pwned?: boolean }).__pwned = undefined;

        paste(surface, {
            html: '<p>ok<script>window.__pwned = true;</script></p>',
            text: "ok",
        });
        host.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect((window as Window & { __pwned?: boolean }).__pwned).toBeUndefined();
        expect(document.querySelector("script")).toBeNull();
    });

    it("does not keep an event handler from clipboard HTML", async () => {
        const { host, surface } = await mount("start\n");
        host.setSelection({ anchor: 5, head: 5 });

        paste(surface, {
            html: '<p onclick="window.__pwned = true">text</p>',
            text: "text",
        });
        host.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));

        for (const element of surface.querySelectorAll("*")) {
            for (const attribute of element.getAttributeNames()) {
                expect(attribute.toLowerCase().startsWith("on")).toBe(false);
            }
        }
    });
});

describe("clipboard — copying reports Markdown, not rendered chrome", () => {
    it("does not leave preview chrome in the serialized document", async () => {
        // Mermaid renders a preview beside its source. The preview is chrome:
        // it must never become part of the Markdown the session persists.
        const { host } = await mount("```mermaid\ngraph TD\n  A --> B\n```\n");
        host.replaceSourceRange({ anchor: 0, head: 0 }, "");
        const end = host.getMarkdown().length;
        host.replaceSourceRange({ anchor: end, head: end }, "\n\ntail");
        host.flush();

        const result = host.getMarkdown();
        expect(result).toContain("graph TD\n  A --> B");
        expect(result).not.toContain("<svg");
        expect(result).not.toContain("data-mdx-preview");
    });
});
