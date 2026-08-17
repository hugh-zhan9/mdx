// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "../index";
import { referenceLinkFixtures } from "../../../test/syntax-fixtures";
import { SOURCE_FALLBACK_INLINE_NODE, SOURCE_FALLBACK_NODE } from "./nodes";
import { NODE_TYPE_ATTR, SOURCE_KIND_ATTR } from "./session";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

interface Mounted {
    host: MilkdownEditorHost;
    root: HTMLElement;
}

async function mount(markdown: string): Promise<Mounted> {
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
    return { host, root };
}

/**
 * Serialization only runs once a transaction dirties the document, so every
 * fidelity assertion edits first. The edit lands in a leading anchor paragraph,
 * which keeps it outside the construct under test even when that construct runs
 * to the end of the file.
 */
const ANCHOR = "Anchor.\n\n";

async function serializeAfterAnchorEdit(fixture: string): Promise<string> {
    const { host } = await mount(`${ANCHOR}${fixture}`);
    expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
    host.flush();
    return host.getMarkdown();
}

function nodesOfType(root: ParentNode, type: string): Element[] {
    return Array.from(root.querySelectorAll(`[${NODE_TYPE_ATTR}="${type}"]`));
}

describe("reference-style links keep their own bytes", () => {
    for (const fixture of referenceLinkFixtures) {
        it(`preserves the ${fixture.name} fixture`, async () => {
            const serialized = await serializeAfterAnchorEdit(fixture.markdown);
            expect(serialized).toBe(`X${ANCHOR}${fixture.markdown}`);
            for (const slice of fixture.preservedSlices) {
                expect(serialized).toContain(slice);
            }
        });
    }

    // The two failures this whole change exists to stop. Both were silent:
    // the file simply came back different from the file that was opened.
    it("does not inline a reference link into its destination", async () => {
        const serialized = await serializeAfterAnchorEdit(
            "See [ref][1] here.\n\n[1]: http://x\n",
        );
        expect(serialized).toContain("[ref][1]");
        expect(serialized).not.toContain("[ref](http://x)");
        expect(serialized).toContain("[1]: http://x");
    });

    it("does not delete a definition nothing references", async () => {
        const serialized = await serializeAfterAnchorEdit(
            "Prose only.\n\n[unused]: http://x\n",
        );
        expect(serialized).toContain("[unused]: http://x");
    });

    it("holds a reference link as a preserved inline slice", async () => {
        const { root } = await mount(
            `${ANCHOR}See [ref][1] here.\n\n[1]: http://x\n`,
        );
        const inline = nodesOfType(root, SOURCE_FALLBACK_INLINE_NODE);
        expect(inline).toHaveLength(1);
        expect(inline[0].getAttribute(SOURCE_KIND_ATTR)).toBe("reference_link");
        // It is not a link node: nothing in the document carries the
        // destination, which is what stops it being copied into the text.
        expect(root.querySelector("a")).toBeNull();
    });

    it("holds a definition as a preserved block slice", async () => {
        const { root } = await mount(
            `${ANCHOR}See [ref][1] here.\n\n[1]: http://x\n`,
        );
        const block = nodesOfType(root, SOURCE_FALLBACK_NODE);
        expect(block).toHaveLength(1);
        expect(block[0].getAttribute(SOURCE_KIND_ATTR)).toBe(
            "reference_definition",
        );
        expect(block[0].querySelector("code")?.textContent).toBe(
            "[1]: http://x",
        );
    });

    // One slice per run, not one per definition: preserved separately the
    // serializer writes its block separator between them and the file gains a
    // blank line it never had.
    it("keeps a run of adjacent definitions on adjacent lines", async () => {
        const { root } = await mount(
            `${ANCHOR}[a][1] [b][2]\n\n[1]: http://x\n[2]: http://y\n`,
        );
        expect(nodesOfType(root, SOURCE_FALLBACK_NODE)).toHaveLength(1);
        expect(
            await serializeAfterAnchorEdit(
                "[a][1] [b][2]\n\n[1]: http://x\n[2]: http://y\n",
            ),
        ).toBe(`X${ANCHOR}[a][1] [b][2]\n\n[1]: http://x\n[2]: http://y\n`);
    });

    it("keeps a blank line the author wrote between two definitions", async () => {
        const markdown = "[a][1]\n\n[1]: http://x\n\n[2]: http://y\n";
        expect(await serializeAfterAnchorEdit(markdown)).toBe(
            `X${ANCHOR}${markdown}`,
        );
    });

    it("preserves a definition inside a blockquote", async () => {
        const markdown = "> [q][1]\n>\n> [1]: http://x\n";
        expect(await serializeAfterAnchorEdit(markdown)).toBe(
            `X${ANCHOR}${markdown}`,
        );
    });

    it("leaves an inline link structural", async () => {
        const { root } = await mount(
            `${ANCHOR}An [inline](http://x) link.\n`,
        );
        expect(nodesOfType(root, SOURCE_FALLBACK_INLINE_NODE)).toHaveLength(0);
        expect(root.querySelector("a")?.getAttribute("href")).toBe("http://x");
    });

    it("survives a second serialization pass unchanged", async () => {
        for (const fixture of referenceLinkFixtures) {
            const once = await serializeAfterAnchorEdit(fixture.markdown);
            const slice = once.slice(`X${ANCHOR}`.length);
            expect(slice, fixture.name).toBe(fixture.markdown);
            expect(await serializeAfterAnchorEdit(slice), fixture.name).toBe(
                once,
            );
        }
    });
});
