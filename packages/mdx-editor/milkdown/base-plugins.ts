import {
    commonmark,
    remarkInlineLinkPlugin,
} from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import { listener } from "@milkdown/kit/plugin/listener";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";

/**
 * Base editing capabilities every MDX surface gets: CommonMark, GFM, undo/redo
 * history, the change listener the adapter reads, and clipboard handling.
 *
 * Syntax families beyond CommonMark/GFM are composed separately so each one
 * owns its parser, schema, serializer, NodeView, and clipboard behavior.
 */
export function createBaseMilkdownPlugins(): MilkdownPlugin[] {
    return [commonmark, gfm, history, listener, clipboard].flat();
}

/**
 * The two entries Milkdown's inline-link transformer contributes.
 *
 * `$remark` returns the options slice and the plugin as a pair, and the composed
 * preset is flattened, so both appear in the array and both are named here.
 */
const inlineLinkPlugins = new Set<MilkdownPlugin>([
    remarkInlineLinkPlugin.plugin,
    remarkInlineLinkPlugin.options,
]);

/**
 * Drops Milkdown's inline-link transformer from a composition.
 *
 * It rewrites `[ref][1]` into `[ref](http://x)` and deletes the definition it
 * consumed, and it deletes a definition nothing references outright. Both are
 * content loss rather than formatting: a definition may exist for a section the
 * author has not written yet, and a document that names one label in twenty
 * places is not the same document with the URL copied twenty times.
 *
 * Only a composition that also claims `definition`, `linkReference` and
 * `imageReference` may call this. Nothing in the CommonMark preset has a schema
 * node for any of the three, so removing the transformer on its own throws on
 * the first reference link; source preservation is what supplies them, which is
 * why this and `sourcePreservationPlugins()` are applied together.
 */
export function withoutInlineLinkTransformer(
    plugins: MilkdownPlugin[],
): MilkdownPlugin[] {
    return plugins.filter((plugin) => !inlineLinkPlugins.has(plugin));
}
