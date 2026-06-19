"use client";

import type { ChangeEvent } from "react";
import type { NodeViewProps } from "./node-views";

interface CalloutNodeViewProps extends NodeViewProps {
    contentRef?: (element: HTMLElement | null) => void;
}

const CALLOUT_KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

export function CalloutNodeView({
    contentRef,
    node,
    updateAttrs,
}: CalloutNodeViewProps) {
    function handleKindChange(event: ChangeEvent<HTMLSelectElement>) {
        updateAttrs({ kind: event.currentTarget.value });
    }

    function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
        updateAttrs({ title: event.currentTarget.value || null });
    }

    return (
        <>
            <div className="mdx-callout-controls" contentEditable={false}>
                <select
                    aria-label="Callout type"
                    value={String(node.attrs.kind ?? "NOTE")}
                    onChange={handleKindChange}
                >
                    {CALLOUT_KINDS.map((kind) => (
                        <option value={kind} key={kind}>
                            {kind}
                        </option>
                    ))}
                </select>
                <input
                    aria-label="Callout title"
                    value={String(node.attrs.title ?? "")}
                    onChange={handleTitleChange}
                    type="text"
                />
            </div>
            <div className="mdx-callout-content" ref={contentRef} />
        </>
    );
}
