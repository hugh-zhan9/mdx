import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { SerializerContext, SyntaxPlugin } from "../../kernel";
import { createReactNodeView } from "../../react/node-views";
import { FootnoteNodeView } from "../../react/footnote-node-view";
import { mdxEditorSchema } from "../../schema/schema";

export function footnoteSyntax(): SyntaxPlugin {
    return {
        id: "footnote",
        nodes: {
            footnote_ref: mdxEditorSchema.nodes.footnote_ref.spec,
            footnote_definition: mdxEditorSchema.nodes.footnote_definition.spec,
        },
        serializers: {
            nodeSerializers: {
                footnote_ref: (node) =>
                    `[^${escapeFootnoteLabel(String(node.attrs.label ?? ""))}]`,
                footnote_definition: (node, context) =>
                    serializeFootnoteDefinition(node, context),
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

function serializeFootnoteDefinition(
    node: ProseMirrorNode,
    context: SerializerContext,
) {
    const label = String(node.attrs.label ?? "");
    const firstChild = node.firstChild;
    if (!firstChild) {
        return `[^${label}]:\n`;
    }

    const firstLine =
        firstChild.type.name === "paragraph"
            ? context.serializeInline(firstChild)
            : context.serializeNode(firstChild).replace(/\n$/, "");
    const lines = [`[^${label}]: ${firstLine}`];

    for (let index = 1; index < node.childCount; index += 1) {
        const childText = context.serializeNode(node.child(index)).replace(/\n$/, "");
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `    ${line}` : "");
        }
    }

    return `${lines.join("\n")}\n`;
}

function escapeFootnoteLabel(label: string) {
    return label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export { FootnoteNodeView };
