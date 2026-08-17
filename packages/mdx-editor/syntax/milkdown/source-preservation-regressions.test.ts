// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

/**
 * Serialization only runs once a transaction dirties the document, so fidelity
 * is asserted after an edit that lands outside the slice under test — the
 * scenario the contract is about is exactly "an unrelated edit must not rewrite
 * content the user did not touch".
 */
async function editElsewhere(markdown: string): Promise<string> {
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
    const end = host.getMarkdown().length;
    host.replaceSourceRange({ anchor: end, head: end }, "\n\ntail");
    host.flush();
    return host.getMarkdown();
}

/**
 * The same contract for a slice that runs to the end of the file: the edit has
 * to land in front of it, because appending would land inside it.
 */
const ANCHOR = "Anchor.\n\n";

async function editBefore(fixture: string): Promise<string> {
    const root = document.createElement("div");
    document.body.append(root);
    const host = await createMilkdownEditorHost({
        root,
        markdown: `${ANCHOR}${fixture}`,
        editable: true,
        plugins: createMdxMilkdownPlugins(),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
    host.flush();
    return host.getMarkdown();
}

describe("regression: no family closes a fence the author left open", () => {
    // Source preservation only ever asked this of `code` nodes, so a fence
    // another family had already claimed — a Mermaid diagram, a math block —
    // was written back with a terminator that was never typed, and everything
    // after it was swallowed on the next open.
    it("keeps an unclosed mermaid fence open", async () => {
        expect(await editBefore("```mermaid\ngraph TD;\nA-->B;\n")).toBe(
            `X${ANCHOR}\`\`\`mermaid\ngraph TD;\nA-->B;\n`,
        );
    });

    it("keeps an unclosed mermaid fence's own fence character", async () => {
        expect(await editBefore("~~~mermaid\ngraph TD;\n")).toBe(
            `X${ANCHOR}~~~mermaid\ngraph TD;\n`,
        );
    });

    it("keeps an unclosed math block open", async () => {
        expect(await editBefore("$$\nx^2\n")).toBe(`X${ANCHOR}$$\nx^2\n`);
    });

    it("keeps an unclosed mermaid fence inside a blockquote open", async () => {
        expect(await editBefore("> ```mermaid\n> graph TD;\n")).toBe(
            `X${ANCHOR}> \`\`\`mermaid\n> graph TD;\n`,
        );
    });

    it("still closes the fences that were closed", async () => {
        expect(await editBefore("```mermaid\ngraph TD;\n```\n")).toBe(
            `X${ANCHOR}\`\`\`mermaid\ngraph TD;\n\`\`\`\n`,
        );
        expect(await editBefore("$$\nx^2\n$$\n")).toBe(
            `X${ANCHOR}$$\nx^2\n$$\n`,
        );
    });

});

describe("regression: a fence's info string survives beyond its language", () => {
    // The code block node holds one language, so everything after it was
    // dropped, and Mermaid declines such a fence precisely because it has
    // nowhere to keep it either.
    it("keeps a meta string on a language fence", async () => {
        expect(await editBefore("```js title=x\nconst a = 1;\n```\n")).toBe(
            `X${ANCHOR}\`\`\`js title=x\nconst a = 1;\n\`\`\`\n`,
        );
    });

    it("keeps a meta string on a mermaid fence", async () => {
        expect(await editBefore("```mermaid title=x\ngraph TD;\n```\n")).toBe(
            `X${ANCHOR}\`\`\`mermaid title=x\ngraph TD;\n\`\`\`\n`,
        );
    });

    it("keeps an info string of several bare words", async () => {
        expect(await editBefore("```foo bar baz\nbody\n```\n")).toBe(
            `X${ANCHOR}\`\`\`foo bar baz\nbody\n\`\`\`\n`,
        );
    });

    it("keeps a meta fence inside a list item", async () => {
        expect(await editBefore("- ```js meta=1\n  body\n  ```\n")).toBe(
            `X${ANCHOR}- \`\`\`js meta=1\n  body\n  \`\`\`\n`,
        );
    });

    it("leaves a language-only fence to the code block", async () => {
        expect(await editBefore("```js\nconst a = 1;\n```\n")).toBe(
            `X${ANCHOR}\`\`\`js\nconst a = 1;\n\`\`\`\n`,
        );
    });
});

describe("regression: a preserved slice inside a container is not re-decorated", () => {
    // `source.slice()` returns the container's own `> ` markers and indentation
    // on continuation lines. Storing them made the serializer write them a
    // second time when it re-wrapped the node, corrupting a slice the user
    // never edited on the first unrelated keystroke.
    it("keeps an unknown directive inside a blockquote intact", async () => {
        const result = await editElsewhere(
            "> :::note\n> body *with* stars\n> :::\n",
        );
        expect(result).toContain("> :::note\n> body *with* stars\n> :::");
        expect(result).not.toContain("> > ");
    });

    it("keeps an unclosed fence inside a blockquote intact", async () => {
        const result = await editElsewhere("> ```js\n> let x = 1;\n");
        expect(result).toContain("> ```js\n> let x = 1;");
        expect(result).not.toContain("> > ");
    });

    it("keeps a nested blockquote's preserved slice intact", async () => {
        const result = await editElsewhere(
            "> > :::note\n> > body\n> > :::\n",
        );
        expect(result).toContain("> > :::note\n> > body\n> > :::");
        expect(result).not.toContain("> > > ");
    });

    it("keeps an unknown directive inside a list item intact", async () => {
        const result = await editElsewhere("- :::note\n  body\n  :::\n");
        expect(result).toContain(":::note");
        expect(result).toContain("body");
        expect(result).toContain(":::");
        // The indent must not compound: four spaces would mean the container
        // prefix was stored and then written again.
        expect(result).not.toMatch(/\n {4}body/);
    });

    it("leaves a top-level preserved slice exactly as written", async () => {
        const result = await editElsewhere(":::note\nbody\n:::\n");
        expect(result).toContain(":::note\nbody\n:::");
    });
});

/** jsdom ships no DataTransfer; this carries what the editor writes and reads. */
function clipboard() {
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

function dispatchClipboardEvent(
    surface: HTMLElement,
    kind: "copy" | "paste",
    transfer: ReturnType<typeof clipboard>["transfer"],
): void {
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    surface.dispatchEvent(event);
}

describe("regression: frontmatter cannot survive away from the document top", () => {
    // Frontmatter is only frontmatter at line 1, column 1. A node that reached
    // the middle of the document still serialized as `---\n…\n---`, which
    // reparses as a thematic break plus a setext heading — silent, total loss
    // of the block on the next open. Copy-and-paste is the path that produces
    // it, because an in-app copy carries the session token that lets the
    // metadata rehydrate.
    it("turns a pasted mid-document frontmatter block into a code block", async () => {
        const root = document.createElement("div");
        document.body.append(root);
        const host = await createMilkdownEditorHost({
            root,
            markdown: "---\na: 1\n---\n\nHEAD\n\nTAIL\n",
            editable: true,
            plugins: createMdxMilkdownPlugins(),
            onMarkdownChange: () => {},
            onSelectionChange: () => {},
        });
        mounted.push(host);
        const surface = root.querySelector<HTMLElement>(".ProseMirror");
        if (!surface) throw new Error("editor surface did not mount");

        // Copy the frontmatter block itself.
        host.setSelection({ anchor: 0, head: 12 });
        const copied = clipboard();
        dispatchClipboardEvent(surface, "copy", copied.transfer);
        const copiedHtml = copied.entries.get("text/html") ?? "";
        if (!copiedHtml.includes("data-frontmatter")) {
            throw new Error(
                "copy did not carry a frontmatter node; the assertion would be vacuous",
            );
        }

        // Paste at a block boundary, which is where ProseMirror will actually
        // place a block node rather than merging its text into a paragraph.
        const boundary = host.getMarkdown().indexOf("TAIL");
        host.setSelection({ anchor: boundary, head: boundary });
        const pasted = clipboard();
        pasted.entries.set("text/html", copiedHtml);
        pasted.entries.set("text/plain", "a: 1");
        dispatchClipboardEvent(surface, "paste", pasted.transfer);
        host.flush();

        const result = host.getMarkdown();
        // The bytes survive as a code block, the top frontmatter is untouched,
        // and no second `---` fence pair was written into the document body.
        expect(result.startsWith("---\na: 1\n---")).toBe(true);
        expect(result).toContain("```yaml");
        expect(result).not.toContain("## a: 1");
        expect(result.split(/^---$/m).length - 1).toBe(2);
        expect(
            root.querySelectorAll("[data-frontmatter]"),
        ).toHaveLength(1);
    });
});

describe("regression: a block-first list item gains no phantom line", () => {
    // CommonMark's preset declares `list_item` as `paragraph block*`. A list
    // item starting with something that is not a paragraph made ProseMirror
    // insert an empty one, which the serializer wrote out as `<br />` — a line
    // the author never typed, on an item they never edited.
    it("keeps an HTML block as the first thing in a list item", async () => {
        const result = await editElsewhere("- <div>\n  x\n  </div>\n");
        expect(result).not.toContain("<br />");
        expect(result).toContain("<div>");
    });

    it("keeps an unknown directive as the first thing in a list item", async () => {
        const result = await editElsewhere("- :::note\n  body\n  :::\n");
        expect(result).not.toContain("<br />");
        expect(result).toContain(":::note");
    });

    it("keeps a fenced code block as the first thing in a list item", async () => {
        const result = await editElsewhere("- ```js\n  let x = 1;\n  ```\n");
        expect(result).not.toContain("<br />");
        expect(result).toContain("let x = 1;");
    });

    it("leaves an ordinary paragraph-first list item alone", async () => {
        const result = await editElsewhere("- first\n- second\n");
        expect(result).not.toContain("<br />");
        expect(result).toContain("- first");
        expect(result).toContain("- second");
    });
});
