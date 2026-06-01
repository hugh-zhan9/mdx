"use client";

import type { HTMLAttributes } from "react";
import type { MarkdownOutlineHeading } from "../lib/types";

interface OutlinePanelProps {
    headings?: MarkdownOutlineHeading[];
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onHeadingClick?: (heading: MarkdownOutlineHeading, index: number) => void;
    resizeHandleProps: HTMLAttributes<HTMLDivElement>;
}

export function OutlinePanel({
    headings = [],
    collapsed,
    onToggleCollapsed,
    onHeadingClick,
    resizeHandleProps,
}: OutlinePanelProps) {
    if (collapsed) {
        return null;
    }

    return (
        <aside className="relative h-full min-h-0 overflow-hidden border-l border-base-300 bg-base-100">
            <div className="flex h-10 items-center justify-between border-b border-base-300 px-3">
                <div className="text-xs font-semibold uppercase text-base-content/60">
                    Outline
                </div>
                <button
                    type="button"
                    className="h-7 px-2 text-xs text-base-content/65 hover:bg-base-200"
                    onClick={onToggleCollapsed}
                    aria-label="Collapse outline panel"
                    title="Collapse outline panel"
                >
                    &gt;
                </button>
            </div>

            <div className="h-[calc(100%-2.5rem)] overflow-auto py-2 text-sm">
                {headings.length === 0 ? (
                    <div className="px-3 py-2 text-base-content/50">
                        No headings
                    </div>
                ) : (
                    headings.map((heading, index) => (
                        <button
                            key={heading.id}
                            type="button"
                            className="block w-full truncate py-1 pr-3 text-left text-base-content/70 hover:bg-base-200"
                            style={{ paddingLeft: 10 + heading.level * 10 }}
                            title={heading.text}
                            onClick={() => onHeadingClick?.(heading, index)}
                        >
                            {heading.text}
                        </button>
                    ))
                )}
            </div>

            <div
                {...resizeHandleProps}
                className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40"
            />
        </aside>
    );
}
