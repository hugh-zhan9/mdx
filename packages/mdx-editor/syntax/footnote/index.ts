import type { SyntaxPlugin } from "../../kernel";
import { escapeAttribute, escapeHtml } from "../../kernel/clipboard";
import { createReactNodeView } from "../../react/node-views";
import { FootnoteNodeView } from "../../react/footnote-node-view";
import { mdxEditorSchema } from "../../schema/schema";
import { serializeFootnoteDefinition, serializeFootnoteRef } from "./serialize";

export function footnoteSyntax(): SyntaxPlugin {
    return {
        id: "footnote",
        nodes: {
            footnote_ref: mdxEditorSchema.nodes.footnote_ref.spec,
            footnote_definition: mdxEditorSchema.nodes.footnote_definition.spec,
        },
        serializers: {
            nodeSerializers: {
                footnote_ref: serializeFootnoteRef,
                footnote_definition: serializeFootnoteDefinition,
            },
        },
        nodeViews: {
            footnote_definition: createReactNodeView(FootnoteNodeView, {
                contentDOMTag: "div",
                domTag: "section",
            }),
        },
        clipboard: {
            toClipboardHtml: {
                footnote_ref: (node) => {
                    const label = String(node.attrs.label ?? node.textContent ?? "");

                    return `<sup data-mdx-node-type="footnote_ref" data-mdx-label="${escapeAttribute(label)}">[${escapeHtml(label)}]</sup>`;
                },
                footnote_definition: (node, context) => {
                    const label = String(node.attrs.label ?? "");
                    const markdown = context
                        .serializeMarkdown(node)
                        .replace(/^\[\^[^\]]+\]:\s*/, "");

                    return `<section data-mdx-node-type="footnote_definition" data-mdx-label="${escapeAttribute(label)}">${escapeHtml(markdown)}</section>`;
                },
            },
        },
    };
}

export { FootnoteNodeView };
export {
    escapeFootnoteLabel,
    serializeFootnoteDefinition,
    serializeFootnoteRef,
} from "./serialize";
