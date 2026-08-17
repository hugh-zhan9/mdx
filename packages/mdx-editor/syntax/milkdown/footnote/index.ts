import { InitReady, remarkPluginsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { footnoteReferenceSchema } from "@milkdown/kit/preset/gfm";
import type { RemarkPlugin } from "@milkdown/kit/transformer";
import { $ctx, $view } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import { footnoteRemarkPlugin } from "./remark-footnote";
import {
    FOOTNOTE_LABEL_DOM_ATTRIBUTE,
    FOOTNOTE_REFERENCE_DOM_MARKER,
    FOOTNOTE_REFERENCE_NODE_NAME,
} from "./syntax";

export {
    FOOTNOTE_DEFINITION_NODE_NAME,
    FOOTNOTE_LABEL_DOM_ATTRIBUTE,
    FOOTNOTE_REFERENCE_DOM_MARKER,
    FOOTNOTE_REFERENCE_MDAST_TYPE,
    FOOTNOTE_REFERENCE_NODE_NAME,
    findFootnoteReferences,
    formatFootnoteReference,
    isRoundTrippableFootnoteLabel,
    type FootnoteReferenceMatch,
} from "./syntax";

/**
 * What the product is told when a footnote call is activated: the label, as a
 * plain string. It is the whole address of the definition — no ProseMirror
 * position, no DOM node, nothing that goes stale on the next keystroke.
 */
export interface FootnoteActivation {
    label: string;
}

export type FootnoteActivateHandler = (activation: FootnoteActivation) => void;

/** Fired when the user activates a footnote call. */
export const footnoteActivateCtx = $ctx<
    FootnoteActivateHandler,
    "mdxFootnoteActivate"
>(() => {}, "mdxFootnoteActivate");

/**
 * The footnote transformer, registered ahead of every remark plugin the presets
 * install rather than after them.
 *
 * `$remark` appends, and the commonmark preset is composed first, so its
 * soft-line-break splitter would run first and replace a multi-line paragraph's
 * `text` node with fragments that carry no source `position`. Nothing
 * downstream can then prove a fragment is verbatim, so every call on any line
 * but the first was left as text and escaped to `\[^a]`. Prepending is the only
 * way to reach the tree first: the slice is a plain array and `$remark` offers
 * no ordering control.
 */
const footnoteRemark: MilkdownPlugin = (ctx) => async () => {
    await ctx.wait(InitReady);
    const entry: RemarkPlugin = {
        plugin: footnoteRemarkPlugin,
        options: {},
    };
    ctx.update(remarkPluginsCtx, (plugins) => [entry, ...plugins]);
    return () => {
        ctx.update(remarkPluginsCtx, (plugins) =>
            plugins.filter((plugin) => plugin !== entry),
        );
    };
};

function readLabel(node: ProseMirrorNode): string {
    return String(node.attrs.label ?? "");
}

const footnoteReferenceView = $view(footnoteReferenceSchema.node, (ctx: Ctx) => {
    return (initialNode: ProseMirrorNode) => {
        let node = initialNode;
        const dom = document.createElement("sup");
        dom.className = "mdx-footnote-reference";
        dom.setAttribute(FOOTNOTE_REFERENCE_DOM_MARKER, "");
        // Kept so the GFM preset's own `parseDOM` rule still recognizes this
        // element when it arrives back through the clipboard.
        dom.setAttribute("data-type", FOOTNOTE_REFERENCE_NODE_NAME);

        function render(): void {
            const label = readLabel(node);
            dom.setAttribute(FOOTNOTE_LABEL_DOM_ATTRIBUTE, label);
            dom.setAttribute("data-label", label);
            dom.textContent = label;
        }

        function onClick(event: MouseEvent): void {
            if (event.button !== 0) return;
            event.preventDefault();
            ctx.get(footnoteActivateCtx.key)({ label: readLabel(node) });
        }

        render();
        dom.addEventListener("click", onClick);

        return {
            dom,
            update(next: ProseMirrorNode) {
                if (next.type !== node.type) return false;
                node = next;
                render();
                return true;
            },
            // The label is written from node attrs and never edited in place,
            // so every mutation inside it is this view's own work.
            ignoreMutation: () => true,
            destroy() {
                dom.removeEventListener("click", onClick);
            },
        };
    };
});

/**
 * GFM footnotes, completed.
 *
 * The GFM preset already parses, structures, and writes back a call that has a
 * definition. This adds the two things it does not have: a call with no
 * definition yet stays a call instead of being escaped into prose, and
 * activating a call reports its label so the product can reach the definition.
 *
 * Compose after the base plugins, whose GFM preset owns the two node schemas
 * this builds on.
 */
export function footnotePlugins(): MilkdownPlugin[] {
    return [footnoteActivateCtx, footnoteRemark, footnoteReferenceView].flat();
}
