import type { SyntaxPlugin } from "../../kernel";
import { escapeAttribute, escapeHtml } from "../../kernel/clipboard";
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
                source_fallback: (node) => String(node.attrs.markdown ?? ""),
            },
        },
        nodeViews: {
            source_fallback: createSourceFallbackNodeView,
        },
        clipboard: {
            toClipboardHtml: {
                source_fallback: (node) => {
                    const markdown = String(
                        node.attrs.markdown ?? node.textContent ?? "",
                    );

                    return `<pre data-mdx-node-type="source_fallback" data-mdx-reason="${escapeAttribute(String(node.attrs.reason ?? "unsupported"))}"><code>${escapeHtml(markdown)}</code></pre>`;
                },
            },
        },
    };
}

export { SourceFallbackNodeView };
