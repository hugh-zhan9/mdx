import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { $ctx, $prose } from "@milkdown/kit/utils";

import { createCodeHighlightPlugin } from "./code-highlight";
import type { EditorSurfaceServiceReader } from "./types";

/**
 * Where the visual surface reads the product's capabilities from.
 *
 * The slice carries a reader, not the services themselves, so whatever reads it
 * gets what the product offers *now*: a document that is renamed changes what a
 * relative asset path resolves against, and the surface holding it is not
 * rebuilt for that.
 *
 * This is the seam between the product and the syntax layer's rendering. The
 * product installs; the views that draw code and images read. Neither knows the
 * other: the product never learns that a code fence is a node or that an image
 * is drawn by a view, and the views never learn what a workspace root is.
 */
export const editorServicesCtx = $ctx<
    EditorSurfaceServiceReader,
    "mdxEditorServices"
>(() => ({}), "mdxEditorServices");

/**
 * Installs the reader {@link editorServicesCtx} carries.
 *
 * A plugin rather than an editor `config` callback because the slice does not
 * exist until {@link editorServicesCtx} itself has run: plugins are injected in
 * one pass and run in a second, so this writes the value in the second pass
 * whatever order the composition puts it in.
 */
function installEditorServices(
    readServices: EditorSurfaceServiceReader,
): MilkdownPlugin {
    return (ctx: Ctx) => () => {
        ctx.set(editorServicesCtx.key, readServices);
    };
}

/**
 * Highlights fenced code with the product's tokenizer.
 *
 * Highlighting is decoration, never content: the tokens are drawn over the code
 * block's own text and nothing they produce is part of the document, so a fence
 * serializes to exactly the bytes it was written with whether or not the
 * language was recognised. The tokenizer is read for every decoration pass
 * rather than captured, so a grammar that finished loading after the surface
 * was built highlights the fence that was waiting for it.
 */
const codeHighlight = $prose((ctx: Ctx) =>
    createCodeHighlightPlugin({
        codeTokenizer: (code, language) =>
            ctx.get(editorServicesCtx.key)().codeTokenizer?.(code, language) ??
            [],
    }),
);

/**
 * The product's capabilities, as plugins a visual surface is composed with.
 *
 * Composed for every visual surface, including one built with no services at
 * all: the slice is what the views read, and a view that found no slice would
 * have to guess. A reader that returns nothing is the honest answer to "what
 * can the product do here" — the document still opens, it just renders plainly.
 */
export function editorServicePlugins(
    readServices: EditorSurfaceServiceReader,
): MilkdownPlugin[] {
    return [
        editorServicesCtx,
        installEditorServices(readServices),
        codeHighlight,
    ].flat();
}
