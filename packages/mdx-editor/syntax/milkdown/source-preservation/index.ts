import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";

import { clipboardGuard } from "./clipboard-guard";
import {
    createHtmlSourceNodeView,
    createInlineFallbackNodeView,
    createInlineHtmlNodeView,
    createSourceFallbackNodeView,
} from "./node-views";
import {
    HTML_SOURCE_INLINE_NODE,
    HTML_SOURCE_NODE,
    SOURCE_FALLBACK_INLINE_NODE,
    SOURCE_FALLBACK_NODE,
} from "./nodes";
import {
    HTML_SOURCE_INLINE_MDAST,
    HTML_SOURCE_MDAST,
    SOURCE_FALLBACK_INLINE_MDAST,
    SOURCE_FALLBACK_MDAST,
    remarkSourcePreservation,
} from "./remark-source-preservation";
import {
    NODE_TYPE_ATTR,
    SOURCE_ELEMENT_ATTR,
    SOURCE_ID_ATTR,
    SOURCE_KIND_ATTR,
    SOURCE_VALUE_ATTR,
    SOURCE_TOKEN_ATTR,
    isProductMetadata,
    nextSourceId,
} from "./session";

type DomAttrs = Record<string, string>;

/**
 * True when this process wrote the element's metadata.
 *
 * Clipboard HTML is a string an attacker may have chosen in full, so no
 * `parseDOM` rule here trusts an attribute for what it says. The token is
 * stripped from foreign markup by the clipboard guard before ProseMirror ever
 * sees it, which leaves such markup to be parsed as ordinary prose.
 */
function fromThisProduct(dom: HTMLElement | string): boolean {
    if (typeof dom === "string") return false;
    return isProductMetadata(dom.getAttribute(SOURCE_TOKEN_ATTR));
}

/**
 * The element inside a pasted node that holds its raw source.
 *
 * Resolved as a function rather than a selector because ProseMirror throws when
 * a `contentElement` selector matches nothing, and clipboard HTML is not
 * obliged to have the shape this schema wrote.
 */
function sourceElement(dom: Node): HTMLElement {
    const element = dom as HTMLElement;
    return (
        element.querySelector<HTMLElement>(`[${SOURCE_ELEMENT_ATTR}]`) ?? element
    );
}

function readValue(dom: HTMLElement): string {
    return dom.getAttribute(SOURCE_VALUE_ATTR) ?? "";
}

function readKind(dom: HTMLElement): string {
    return dom.getAttribute(SOURCE_KIND_ATTR) ?? "";
}

const htmlSourceSchema = $nodeSchema(HTML_SOURCE_NODE, () => ({
    content: "text*",
    group: "block",
    marks: "",
    defining: true,
    code: true,
    attrs: {
        sourceId: { default: "", validate: "string" },
    },
    parseDOM: [
        {
            tag: `div[${NODE_TYPE_ATTR}="${HTML_SOURCE_NODE}"]`,
            contentElement: sourceElement,
            preserveWhitespace: "full" as const,
            priority: 75,
            getAttrs: (dom: HTMLElement | string) =>
                fromThisProduct(dom) ? { sourceId: nextSourceId() } : false,
        },
    ],
    toDOM: (node: ProseMirrorNode): [string, DomAttrs, unknown] => [
        "div",
        {
            class: "mdx-html-source",
            [NODE_TYPE_ATTR]: HTML_SOURCE_NODE,
            [SOURCE_ID_ATTR]: String(node.attrs.sourceId ?? ""),
        },
        ["pre", {}, ["code", { [SOURCE_ELEMENT_ATTR]: "" }, 0]],
    ],
    parseMarkdown: {
        match: ({ type }) => type === HTML_SOURCE_MDAST,
        runner: (state, node, type) => {
            const value = typeof node.value === "string" ? node.value : "";
            state.openNode(type, { sourceId: nextSourceId() });
            if (value) state.addText(value);
            state.closeNode();
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === HTML_SOURCE_NODE,
        runner: (state, node) => {
            state.addNode(HTML_SOURCE_MDAST, undefined, node.textContent);
        },
    },
}));

const htmlSourceInlineSchema = $nodeSchema(HTML_SOURCE_INLINE_NODE, () => ({
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    attrs: {
        value: { default: "", validate: "string" },
        sourceId: { default: "", validate: "string" },
    },
    parseDOM: [
        {
            tag: `span[${NODE_TYPE_ATTR}="${HTML_SOURCE_INLINE_NODE}"]`,
            getAttrs: (dom: HTMLElement | string) =>
                typeof dom !== "string" && fromThisProduct(dom)
                    ? { value: readValue(dom), sourceId: nextSourceId() }
                    : false,
        },
    ],
    // The raw HTML is the element's *text*, never its markup: this is the one
    // place the source is rendered without going through the sanitizer, and it
    // is rendered as characters.
    toDOM: (node: ProseMirrorNode): [string, DomAttrs, string] => [
        "span",
        {
            class: "mdx-inline-source",
            [NODE_TYPE_ATTR]: HTML_SOURCE_INLINE_NODE,
            [SOURCE_VALUE_ATTR]: String(node.attrs.value ?? ""),
            [SOURCE_ID_ATTR]: String(node.attrs.sourceId ?? ""),
        },
        String(node.attrs.value ?? ""),
    ],
    parseMarkdown: {
        match: ({ type }) => type === HTML_SOURCE_INLINE_MDAST,
        runner: (state, node, type) => {
            state.addNode(type, {
                value: typeof node.value === "string" ? node.value : "",
                sourceId: nextSourceId(),
            });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === HTML_SOURCE_INLINE_NODE,
        runner: (state, node) => {
            state.addNode(
                HTML_SOURCE_INLINE_MDAST,
                undefined,
                String(node.attrs.value ?? ""),
            );
        },
    },
}));

const sourceFallbackSchema = $nodeSchema(SOURCE_FALLBACK_NODE, () => ({
    content: "text*",
    group: "block",
    marks: "",
    defining: true,
    code: true,
    attrs: {
        kind: { default: "", validate: "string" },
        sourceId: { default: "", validate: "string" },
    },
    parseDOM: [
        {
            tag: `div[${NODE_TYPE_ATTR}="${SOURCE_FALLBACK_NODE}"]`,
            contentElement: sourceElement,
            preserveWhitespace: "full" as const,
            priority: 75,
            getAttrs: (dom: HTMLElement | string) =>
                typeof dom !== "string" && fromThisProduct(dom)
                    ? { kind: readKind(dom), sourceId: nextSourceId() }
                    : false,
        },
    ],
    toDOM: (node: ProseMirrorNode): [string, DomAttrs, unknown] => [
        "div",
        {
            class: "mdx-source-fallback",
            [NODE_TYPE_ATTR]: SOURCE_FALLBACK_NODE,
            [SOURCE_KIND_ATTR]: String(node.attrs.kind ?? ""),
            [SOURCE_ID_ATTR]: String(node.attrs.sourceId ?? ""),
        },
        ["pre", {}, ["code", { [SOURCE_ELEMENT_ATTR]: "" }, 0]],
    ],
    parseMarkdown: {
        match: ({ type }) => type === SOURCE_FALLBACK_MDAST,
        runner: (state, node, type) => {
            const value = typeof node.value === "string" ? node.value : "";
            const kind = (node as { kind?: unknown }).kind;
            state.openNode(type, {
                kind: typeof kind === "string" ? kind : "",
                sourceId: nextSourceId(),
            });
            if (value) state.addText(value);
            state.closeNode();
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === SOURCE_FALLBACK_NODE,
        runner: (state, node) => {
            state.addNode(SOURCE_FALLBACK_MDAST, undefined, node.textContent, {
                kind: String(node.attrs.kind ?? ""),
            });
        },
    },
}));

const sourceFallbackInlineSchema = $nodeSchema(
    SOURCE_FALLBACK_INLINE_NODE,
    () => ({
        group: "inline",
        inline: true,
        atom: true,
        selectable: true,
        draggable: false,
        attrs: {
            value: { default: "", validate: "string" },
            kind: { default: "", validate: "string" },
            sourceId: { default: "", validate: "string" },
        },
        parseDOM: [
            {
                tag: `span[${NODE_TYPE_ATTR}="${SOURCE_FALLBACK_INLINE_NODE}"]`,
                getAttrs: (dom: HTMLElement | string) =>
                    typeof dom !== "string" && fromThisProduct(dom)
                        ? {
                              value: readValue(dom),
                              kind: readKind(dom),
                              sourceId: nextSourceId(),
                          }
                        : false,
            },
        ],
        toDOM: (node: ProseMirrorNode): [string, DomAttrs, string] => [
            "span",
            {
                class: "mdx-inline-source",
                [NODE_TYPE_ATTR]: SOURCE_FALLBACK_INLINE_NODE,
                [SOURCE_VALUE_ATTR]: String(node.attrs.value ?? ""),
                [SOURCE_KIND_ATTR]: String(node.attrs.kind ?? ""),
                [SOURCE_ID_ATTR]: String(node.attrs.sourceId ?? ""),
            },
            String(node.attrs.value ?? ""),
        ],
        parseMarkdown: {
            match: ({ type }) => type === SOURCE_FALLBACK_INLINE_MDAST,
            runner: (state, node, type) => {
                const kind = (node as { kind?: unknown }).kind;
                state.addNode(type, {
                    value: typeof node.value === "string" ? node.value : "",
                    kind: typeof kind === "string" ? kind : "",
                    sourceId: nextSourceId(),
                });
            },
        },
        toMarkdown: {
            match: (node) => node.type.name === SOURCE_FALLBACK_INLINE_NODE,
            runner: (state, node) => {
                state.addNode(
                    SOURCE_FALLBACK_INLINE_MDAST,
                    undefined,
                    String(node.attrs.value ?? ""),
                    { kind: String(node.attrs.kind ?? "") },
                );
            },
        },
    }),
);

const sourcePreservationRemark = $remark(
    "mdxSourcePreservation",
    () => remarkSourcePreservation,
);

const htmlSourceView = $view(htmlSourceSchema.node, () =>
    createHtmlSourceNodeView(),
);
const htmlSourceInlineView = $view(htmlSourceInlineSchema.node, () =>
    createInlineHtmlNodeView(),
);
const sourceFallbackView = $view(sourceFallbackSchema.node, () =>
    createSourceFallbackNodeView(),
);
const sourceFallbackInlineView = $view(sourceFallbackInlineSchema.node, () =>
    createInlineFallbackNodeView(),
);

/**
 * Safe HTML and source-preserving fallback.
 *
 * Markdown is the only thing persisted, so anything the editor cannot represent
 * structurally is kept as the bytes it arrived as rather than normalized into
 * something close. Two node families do that: raw HTML, which is held verbatim
 * and shown through a sanitized inert preview, and everything else the parser
 * cannot claim, which is held verbatim with the syntax kind it came from.
 *
 * Compose after the base plugins. The remark transformer depends on
 * commonmark's own transformers having already run, and the schemas deliberately
 * take over constructs the commonmark preset would otherwise rewrite.
 */
export function sourcePreservationPlugins(): MilkdownPlugin[] {
    return [
        sourcePreservationRemark,
        htmlSourceSchema,
        htmlSourceInlineSchema,
        sourceFallbackSchema,
        sourceFallbackInlineSchema,
        htmlSourceView,
        htmlSourceInlineView,
        sourceFallbackView,
        sourceFallbackInlineView,
        clipboardGuard,
    ].flat();
}
