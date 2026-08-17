import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { $ctx, $inputRule, $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import { InputRule } from "prosemirror-inputrules";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";

import { remarkWikilink } from "./remark-wikilink";
import {
    WIKILINK_MDAST_TYPE,
    isRoundTrippableWikilink,
    parseWikilinkBody,
    wikilinkLabel,
} from "./syntax";

/** What the product is told about an activated wikilink: strings, nothing else. */
export interface WikilinkActivation {
    target: string;
    /** `null` when the source wrote `[[Target]]` rather than `[[Target|alias]]`. */
    alias: string | null;
}

export type WikilinkClickHandler = (activation: WikilinkActivation) => void;

/** Fired when the user activates a wikilink. */
export const wikilinkClickCtx = $ctx<WikilinkClickHandler, "mdxWikilinkClick">(
    () => {},
    "mdxWikilinkClick",
);

/**
 * Installs the handler {@link wikilinkClickCtx} carries.
 *
 * A plugin rather than an editor `config` callback because the slice does not
 * exist until {@link wikilinkClickCtx} itself has run: plugins are injected in
 * one pass and run in a second, so this writes the value in the second pass
 * whatever order the composition puts it in.
 */
export function wikilinkClickHandlerPlugin(
    handler: WikilinkClickHandler,
): MilkdownPlugin {
    return (ctx: Ctx) => () => {
        ctx.set(wikilinkClickCtx.key, handler);
    };
}

const DOM_MARKER = "data-mdx-wikilink";
const DOM_TARGET = "data-mdx-wikilink-target";
const DOM_ALIAS = "data-mdx-wikilink-alias";

function readAttrs(node: ProseMirrorNode): WikilinkActivation {
    const alias = node.attrs.alias;
    return {
        target: String(node.attrs.target ?? ""),
        alias: typeof alias === "string" ? alias : null,
    };
}

const wikilinkSchema = $nodeSchema(WIKILINK_MDAST_TYPE, () => ({
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    attrs: {
        target: { default: "" },
        alias: { default: null },
    },
    parseDOM: [
        {
            tag: `a[${DOM_MARKER}]`,
            getAttrs: (dom: HTMLElement) => {
                const target = dom.getAttribute(DOM_TARGET) ?? "";
                const alias = dom.getAttribute(DOM_ALIAS);
                // Clipboard HTML is untrusted; anything that would not survive
                // a re-parse is rejected so the node falls back to plain text.
                if (!isRoundTrippableWikilink(target, alias)) return false;
                return { target, alias };
            },
        },
    ],
    toDOM: (node) => {
        const { target, alias } = readAttrs(node);
        const attrs: Record<string, string> = {
            [DOM_MARKER]: "",
            [DOM_TARGET]: target,
            class: "mdx-wikilink",
        };
        if (alias !== null) attrs[DOM_ALIAS] = alias;
        return ["a", attrs, wikilinkLabel(target, alias)];
    },
    parseMarkdown: {
        match: (node) => node.type === WIKILINK_MDAST_TYPE,
        runner: (state, node, type) => {
            state.addNode(type, {
                target: String(node.target ?? ""),
                alias: typeof node.alias === "string" ? node.alias : null,
            });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === WIKILINK_MDAST_TYPE,
        runner: (state, node) => {
            state.addNode(WIKILINK_MDAST_TYPE, undefined, undefined, {
                ...readAttrs(node),
            });
        },
    },
}));

const wikilinkRemarkPlugin = $remark("mdxWikilink", () => remarkWikilink);

const wikilinkView = $view(wikilinkSchema.node, (ctx: Ctx) => {
    return (initialNode: ProseMirrorNode) => {
        let node = initialNode;
        const dom = document.createElement("a");
        dom.className = "mdx-wikilink";
        dom.setAttribute(DOM_MARKER, "");

        function render(): void {
            const { target, alias } = readAttrs(node);
            dom.setAttribute(DOM_TARGET, target);
            if (alias === null) dom.removeAttribute(DOM_ALIAS);
            else dom.setAttribute(DOM_ALIAS, alias);
            dom.textContent = wikilinkLabel(target, alias);
        }

        function onClick(event: MouseEvent): void {
            if (event.button !== 0) return;
            event.preventDefault();
            ctx.get(wikilinkClickCtx.key)(readAttrs(node));
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

const OPEN = "[[";
const CLOSE = "]]";
const WIKILINK_INPUT_RULE = /\[\[([^[\]|\n\r￼]+)(?:\|([^[\]\n\r￼]*))?\]\]$/;

function hasCodeMark(marks: readonly Mark[]): boolean {
    return marks.some((mark) => mark.type.spec.code === true);
}

/**
 * True when any inline content in `[from, to)` carries a code mark.
 *
 * Milkdown replaces prosemirror-inputrules' runner with one that only skips
 * code *blocks*, so a rule that must not fire inside inline code has to check
 * the code mark itself.
 */
function rangeHasCodeMark(
    state: EditorState,
    from: number,
    to: number,
): boolean {
    if (from >= to) return false;
    let found = false;
    state.doc.nodesBetween(from, to, (node) => {
        if (node.isInline && hasCodeMark(node.marks)) found = true;
        return !found;
    });
    return found;
}

const wikilinkInputRule = $inputRule((ctx: Ctx) => {
    return new InputRule(WIKILINK_INPUT_RULE, (state, match, start, end) => {
        const typedMarks = state.storedMarks ?? state.doc.resolve(end).marks();
        if (rangeHasCodeMark(state, start, end) || hasCodeMark(typedMarks)) {
            return null;
        }
        const body = parseWikilinkBody(
            match[0].slice(OPEN.length, -CLOSE.length),
        );
        if (!body) return null;
        return state.tr.replaceWith(
            start,
            end,
            wikilinkSchema.type(ctx).create(body),
        );
    });
});

/**
 * Obsidian-style `[[wikilinks]]` as a first-class inline node.
 *
 * The Markdown is tokenized by a remark transformer and written back by a
 * `mdast-util-to-markdown` handler, so `[[` never reaches the default text
 * escaper that would otherwise emit `\[\[`. Nothing rewrites Markdown strings.
 */
export function wikilinkPlugins(): MilkdownPlugin[] {
    return [
        wikilinkClickCtx,
        ...wikilinkRemarkPlugin,
        ...wikilinkSchema,
        wikilinkView,
        wikilinkInputRule,
    ];
}
