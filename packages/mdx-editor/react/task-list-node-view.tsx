"use client";

import type { ChangeEvent } from "react";
import type { NodeViewProps } from "./node-views";

interface TaskListNodeViewProps extends NodeViewProps {
    contentRef?: (element: HTMLElement | null) => void;
}

export function TaskListNodeView({
    contentRef,
    node,
    updateAttrs,
}: TaskListNodeViewProps) {
    function handleChange(event: ChangeEvent<HTMLInputElement>) {
        updateAttrs({ checked: event.currentTarget.checked });
    }

    return (
        <>
            <label className="mdx-task-item-control" contentEditable={false}>
                <input
                    aria-label="Task complete"
                    checked={Boolean(node.attrs.checked)}
                    onChange={handleChange}
                    type="checkbox"
                />
            </label>
            <div className="mdx-task-item-content" ref={contentRef} />
        </>
    );
}
