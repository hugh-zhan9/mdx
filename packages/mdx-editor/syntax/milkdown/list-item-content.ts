import { extendListItemSchemaForTask } from "@milkdown/kit/preset/gfm";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";

/**
 * Lets a list item begin with any block, not only a paragraph.
 *
 * CommonMark's preset declares `list_item` as `paragraph block*`. When the
 * first thing in a list item is not a paragraph — a preserved source block, an
 * HTML block, a fenced diagram — ProseMirror satisfies the required paragraph
 * by inserting an empty one, and the serializer writes it out as CommonMark's
 * `<br />` empty-line placeholder. The document then gains a line the author
 * never typed, on an item they never edited.
 *
 * `block+` is what CommonMark itself allows: a list item may start with a code
 * block, a blockquote, or raw HTML.
 *
 * The base this extends is GFM's list item, not CommonMark's. `extendSchema`
 * captures the spec of whatever it is called on and re-registers the node under
 * the same id, so the last registration wins outright rather than composing:
 * extending CommonMark's here would silently replace GFM's task list item, and
 * `- [x] done` would come back as `- done` with the checkbox gone.
 */
export function relaxListItemContent(): MilkdownPlugin[] {
    return extendListItemSchemaForTask
        .extendSchema((prev) => (ctx) => ({
            ...prev(ctx),
            content: "block+",
        }))
        .flat();
}
