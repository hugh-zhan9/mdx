"use client";

import type { ChangeEvent, FocusEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { NodeViewProps } from "./node-views";

interface FootnoteNodeViewProps extends NodeViewProps {
    contentRef?: (element: HTMLElement | null) => void;
}

export function FootnoteNodeView({
    contentRef,
    node,
    updateAttrs,
}: FootnoteNodeViewProps) {
    const [editingLabel, setEditingLabel] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const label = String(node.attrs.label ?? "");

    useEffect(() => {
        if (editingLabel) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editingLabel]);

    function handleLabelChange(event: ChangeEvent<HTMLInputElement>) {
        updateAttrs({ label: event.currentTarget.value });
    }

    function handleBlur(event: FocusEvent) {
        const relatedTarget = event.relatedTarget;
        if (
            relatedTarget instanceof Node &&
            inputRef.current?.contains(relatedTarget)
        ) {
            return;
        }

        setEditingLabel(false);
    }

    return (
        <>
            {editingLabel ? (
                <label
                    className="mdx-footnote-label mdx-footnote-label-editing"
                    contentEditable={false}
                    onBlur={handleBlur}
                >
                    <span>[^</span>
                    <input
                        aria-label="Footnote label"
                        ref={inputRef}
                        value={label}
                        onChange={handleLabelChange}
                        type="text"
                    />
                    <span>]</span>
                </label>
            ) : (
                <button
                    aria-label="Edit footnote label"
                    className="mdx-footnote-label mdx-footnote-label-preview"
                    contentEditable={false}
                    onClick={() => setEditingLabel(true)}
                    type="button"
                >
                    {label}
                </button>
            )}
            <div className="mdx-footnote-content" ref={contentRef} />
        </>
    );
}
