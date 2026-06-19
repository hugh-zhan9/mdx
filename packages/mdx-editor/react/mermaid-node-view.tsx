"use client";

import type { ChangeEvent } from "react";
import type { NodeViewProps } from "./node-views";

interface MermaidNodeViewProps extends NodeViewProps {
    updateText?: (text: string) => void;
}

const MERMAID_START = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/;

export function MermaidNodeView({ node, updateText }: MermaidNodeViewProps) {
    const code = node.textContent;
    const error = code.trim().length > 0 && !MERMAID_START.test(code)
        ? "Unsupported or invalid Mermaid diagram start."
        : "";
    const previewId =
        typeof node.attrs.sourceId === "string" && node.attrs.sourceId.length > 0
            ? node.attrs.sourceId
            : "mermaid-node-view";

    function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
        updateText?.(event.currentTarget.value);
    }

    return (
        <div
            className="mdx-mermaid-node"
            data-mdx-node-type="mermaid_block"
            data-mdx-code-block=""
            data-mdx-language="mermaid"
        >
            <textarea
                aria-label="Mermaid source"
                value={code}
                onChange={handleChange}
            />
            <div
                className="mdx-mermaid-preview"
                data-mdx-mermaid-preview={previewId}
                contentEditable={false}
            >
                {error ? (
                    <div className="mdx-mermaid-error">{error}</div>
                ) : (
                    <pre>{code}</pre>
                )}
            </div>
        </div>
    );
}
