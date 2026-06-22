import type { SyntaxPlugin } from "../../kernel";
import { createSourceFallbackNodeView } from "../../react/node-views";
import { SourceFallbackNodeView } from "../../react/source-fallback-node-view";
import { mdxEditorSchema } from "../../schema/schema";

export function fallbackSyntax(): SyntaxPlugin {
    return {
        id: "fallback",
        nodes: {
            source_fallback: mdxEditorSchema.nodes.source_fallback.spec,
        },
        serializers: {
            nodeSerializers: {
                source_fallback: (node, _context) =>
                    String(node.attrs.markdown ?? ""),
            },
        },
        nodeViews: {
            source_fallback: createSourceFallbackNodeView,
        },
    };
}

export { SourceFallbackNodeView };
