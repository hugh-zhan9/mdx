"use client";

import type { ChangeEvent } from "react";
import type { NodeViewProps } from "./node-views";

interface FootnoteNodeViewProps extends NodeViewProps {
    contentRef?: (element: HTMLElement | null) => void;
}

export function FootnoteNodeView({
    contentRef,
    node,
    updateAttrs,
}: FootnoteNodeViewProps) {
    function handleLabelChange(event: ChangeEvent<HTMLInputElement>) {
        updateAttrs({ label: event.currentTarget.value });
    }

    return (
        <>
            <label className="mdx-footnote-label" contentEditable={false}>
                <span>[^</span>
                <input
                    aria-label="Footnote label"
                    value={String(node.attrs.label ?? "")}
                    onChange={handleLabelChange}
                    type="text"
                />
                <span>]</span>
            </label>
            <div className="mdx-footnote-content" ref={contentRef} />
        </>
    );
}
