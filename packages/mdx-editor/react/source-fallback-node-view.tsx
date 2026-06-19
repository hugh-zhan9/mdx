"use client";

import type { ChangeEvent } from "react";
import type { NodeViewProps } from "./node-views";

export function SourceFallbackNodeView({ node, updateAttrs }: NodeViewProps) {
    const markdown = String(node.attrs.markdown || node.textContent || "");

    function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
        updateAttrs({ markdown: event.currentTarget.value });
    }

    return (
        <div
            data-mdx-node-type="source_fallback"
            className="mdx-source-fallback"
        >
            <textarea
                aria-label="Markdown source fallback"
                value={markdown}
                onChange={handleChange}
            />
        </div>
    );
}
