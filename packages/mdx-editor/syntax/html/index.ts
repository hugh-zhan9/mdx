import type { SyntaxPlugin } from "../../kernel";
import {
    createHtmlBlockNodeView,
    createReactNodeView,
} from "../../react/node-views";
import { HtmlBlockNodeView } from "../../react/html-block-node-view";
import { InlineHtmlNodeView } from "../../react/inline-html-node-view";
import { mdxEditorSchema } from "../../schema/schema";

export function htmlSyntax(): SyntaxPlugin {
    return {
        id: "html",
        nodes: {
            inline_html: mdxEditorSchema.nodes.inline_html.spec,
            html_block: mdxEditorSchema.nodes.html_block.spec,
        },
        serializers: {
            nodeSerializers: {
                inline_html: (node) => String(node.attrs.html ?? node.textContent),
                html_block: (node) =>
                    String(node.attrs.html ?? node.textContent ?? ""),
            },
        },
        nodeViews: {
            inline_html: createReactNodeView(InlineHtmlNodeView, {
                className: "mdx-inline-html-node",
                domTag: "span",
                inline: true,
            }),
            html_block: createHtmlBlockNodeView,
        },
    };
}

export { HtmlBlockNodeView, InlineHtmlNodeView };
