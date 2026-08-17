// @vitest-environment jsdom

import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaseMilkdownPlugins } from "../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { editorServicePlugins, editorServicesCtx } from "./editor-services";
import type {
    EditorSurfaceServiceReader,
    EditorSurfaceServices,
} from "./types";

/**
 * The seam the product's capabilities reach the visual surface through.
 *
 * A view that draws an image or highlights a fence needs something only the
 * product can supply. It reads that from the editor context, which is what
 * these plugins install — so the tests here are about what a view would find,
 * not about any particular view.
 */

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

/** Reads the slice exactly as a NodeView would, once the editor is running. */
function probe(seen: EditorSurfaceServiceReader[]): MilkdownPlugin {
    return (ctx: Ctx) => () => {
        seen.push(() => ctx.get(editorServicesCtx.key)());
    };
}

async function mount(
    readServices: EditorSurfaceServiceReader,
): Promise<EditorSurfaceServiceReader> {
    const root = document.createElement("div");
    document.body.append(root);
    const seen: EditorSurfaceServiceReader[] = [];

    const host = await createMilkdownEditorHost({
        root,
        markdown: "# Heading\n",
        editable: true,
        plugins: [
            ...createBaseMilkdownPlugins(),
            ...editorServicePlugins(readServices),
            probe(seen),
        ],
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);

    const read = seen[0];
    if (!read) throw new Error("the services slice was never read");
    return read;
}

describe("editor services reach the visual surface", () => {
    it("hands a view the product's image loader and code tokenizer", async () => {
        const imageLoader = vi.fn(async (src: string) => `resolved:${src}`);
        const codeTokenizer = vi.fn(() => [{ type: "keyword", content: "if" }]);

        const read = await mount(() => ({ imageLoader, codeTokenizer }));
        const services = read();

        expect(services.imageLoader).toBe(imageLoader);
        expect(services.codeTokenizer).toBe(codeTokenizer);
        await expect(services.imageLoader?.("./a.png")).resolves.toBe(
            "resolved:./a.png",
        );
    }, 60000);

    it("hands a view whatever the product offers now, not what it offered at build time", async () => {
        // The file a relative asset resolves against changes when the document
        // is renamed, and that does not rebuild the surface. A view reading a
        // loader captured at build time would go on resolving against the old
        // path.
        let current: EditorSurfaceServices = {
            imageLoader: async (src) => `first:${src}`,
        };

        const read = await mount(() => current);
        await expect(read().imageLoader?.("./a.png")).resolves.toBe(
            "first:./a.png",
        );

        current = { imageLoader: async (src) => `second:${src}` };

        await expect(read().imageLoader?.("./a.png")).resolves.toBe(
            "second:./a.png",
        );
    }, 60000);

    it("reports no capability rather than a substitute when the product offers none", async () => {
        const read = await mount(() => ({}));

        expect(read().imageLoader).toBeUndefined();
        expect(read().codeTokenizer).toBeUndefined();
    }, 60000);
});
