"use client";

import type { HTMLAttributes } from "react";
import { EmptyState } from "../../../common/components/ui-controls";
import type { MarkdownOutlineHeading } from "../lib/types";

interface OutlinePanelProps {
    headings?: MarkdownOutlineHeading[];
    collapsed: boolean;
    onHeadingClick?: (heading: MarkdownOutlineHeading, index: number) => void;
    resizeHandleProps: HTMLAttributes<HTMLDivElement>;
}

export function OutlinePanel({
    headings = [],
    collapsed,
    onHeadingClick,
    resizeHandleProps,
}: OutlinePanelProps) {
    if (collapsed) {
        return null;
    }

    return (
        <aside className="relative h-full min-h-0 overflow-hidden border-l border-[var(--mdx-separator)] bg-[var(--mdx-sidebar-bg)]">
            <div className="h-full overflow-auto py-2 text-sm">
                {headings.length === 0 ? (
                    <div className="flex min-h-36 items-center">
                        <EmptyState
                            title="没有标题"
                            description="当前文档没有 H1 到 H6 标题。添加标题后，目录会自动显示。"
                        />
                    </div>
                ) : (
                    headings.map((heading, index) => (
                        <button
                            key={heading.id}
                            type="button"
                            className="block w-full truncate py-1 pr-3 text-left text-base-content/70 hover:bg-[var(--mdx-control-hover-bg)] hover:text-base-content"
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
                className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-base-content/10"
            />
        </aside>
    );
}
