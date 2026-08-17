import type { MilkdownPlugin } from "@milkdown/ctx";
import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import { createCalloutNodeView } from "./node-view";
import {
    CALLOUT_MDAST_TYPE,
    calloutRemarkPlugin,
    readCalloutFields,
} from "./remark";

/** ProseMirror node name for a GitHub alert blockquote. */
export const CALLOUT_NODE_NAME = "callout";

function isEmptyBody(node: ProseMirrorNode): boolean {
    return (
        node.childCount === 1 &&
        node.firstChild?.type.name === "paragraph" &&
        node.firstChild.content.size === 0
    );
}

const calloutRemark = $remark("mdxCalloutRemark", () => calloutRemarkPlugin);

const calloutSchema = $nodeSchema(CALLOUT_NODE_NAME, () => ({
    content: "block+",
    group: "block",
    defining: true,
    attrs: {
        kind: { default: "NOTE" },
        title: { default: "" },
        spaced: { default: false },
    },
    parseDOM: [
        {
            tag: "div[data-callout]",
            contentElement: "[data-callout-body]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    kind: element.getAttribute("data-callout-kind") ?? "",
                    title: element.getAttribute("data-callout-title") ?? "",
                    spaced:
                        element.getAttribute("data-callout-spaced") === "true",
                };
            },
        },
    ],
    toDOM: (node) => [
        "div",
        {
            class: "mdx-callout",
            "data-callout": "",
            "data-callout-kind": String(node.attrs.kind ?? ""),
            "data-callout-title": String(node.attrs.title ?? ""),
            "data-callout-spaced": node.attrs.spaced === true ? "true" : "false",
        },
        [
            "div",
            { class: "mdx-callout-body", "data-callout-body": "" },
            0,
        ],
    ],
    parseMarkdown: {
        match: ({ type }) => type === CALLOUT_MDAST_TYPE,
        runner: (state, node, type) => {
            state
                .openNode(type, readCalloutFields(node))
                .next(node.children)
                .closeNode();
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === CALLOUT_NODE_NAME,
        runner: (state, node) => {
            state.openNode(CALLOUT_MDAST_TYPE, undefined, {
                kind: String(node.attrs.kind ?? ""),
                title: String(node.attrs.title ?? ""),
                spaced: node.attrs.spaced === true,
            });
            // `block+` forces a paragraph into a body-less callout. Serializing
            // it would emit CommonMark's `<br />` empty-line placeholder and
            // add a body the source never had.
            if (!isEmptyBody(node)) state.next(node.content);
            state.closeNode();
        },
    },
}));

const calloutView = $view(calloutSchema.node, () => createCalloutNodeView());

/**
 * Callout support: GitHub alert blockquotes (`> [!WARNING]`) parse into their
 * own node and serialize back to the exact bytes they came from, including
 * unknown types and custom titles.
 */
export function calloutPlugins(): MilkdownPlugin[] {
    return [calloutRemark, calloutSchema, calloutView].flat();
}
