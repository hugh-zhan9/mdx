import type { SyntaxPlugin } from "../../kernel";
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
    };
}

export { FootnoteNodeView };
export {
    escapeFootnoteLabel,
    serializeFootnoteDefinition,
    serializeFootnoteRef,
} from "./serialize";
