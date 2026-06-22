import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { SerializerContext } from "../../kernel";

export function serializeFootnoteRef(node: ProseMirrorNode) {
    return `[^${escapeFootnoteLabel(String(node.attrs.label ?? ""))}]`;
}

export function serializeFootnoteDefinition(
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
        const childText = context
            .serializeNode(node.child(index))
            .replace(/\n$/, "");
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `    ${line}` : "");
        }
    }

    return `${lines.join("\n")}\n`;
}

export function escapeFootnoteLabel(label: string) {
    return label
        .replaceAll("\\", "\\\\")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
}
