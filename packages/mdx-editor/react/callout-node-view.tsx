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
    const kind = String(node.attrs.kind ?? "NOTE").toUpperCase();
    const title = String(node.attrs.title ?? "");

    function handleKindChange(event: ChangeEvent<HTMLSelectElement>) {
        updateAttrs({ kind: event.currentTarget.value });
    }

    function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
        updateAttrs({ title: event.currentTarget.value || null });
    }

    return (
        <>
            <div className="mdx-callout-header" contentEditable={false}>
                <span className="mdx-callout-kind">{kind}</span>
                {title.length > 0 ? (
                    <span className="mdx-callout-title">{title}</span>
                ) : null}
            </div>
            <div className="mdx-callout-controls" contentEditable={false}>
                <select
                    aria-label="Callout type"
                    value={kind}
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
                    placeholder="Title"
                    value={title}
                    onChange={handleTitleChange}
                    type="text"
                />
            </div>
            <div className="mdx-callout-content" ref={contentRef} />
        </>
    );
}
