"use client";

import type { HTMLAttributes } from "react";
import { EmptyState } from "../../../common/components/ui-controls";
import { outlineHeadingLabel } from "../lib/outline";
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
            <div className="h-full overflow-auto py-2">
                {headings.length === 0 ? (
                    <div className="flex min-h-36 items-center">
                        <EmptyState
                            title="没有标题"
                            description="当前文档没有 H1 到 H6 标题。添加标题后，目录会自动显示。"
                        />
                    </div>
                ) : (
                    headings.map((heading, index) => {
                        // The label is the heading read as text; `heading.text`
                        // stays the Markdown source, which is what the click
                        // below navigates by.
                        const label = outlineHeadingLabel(heading.text);

                        return (
                            <button
                                key={heading.id}
                                type="button"
                                className={[
                                    "block w-full truncate py-[3px] pr-3 text-left transition-colors hover:bg-[var(--mdx-control-hover-bg)] hover:text-base-content",
                                    // Depth reads as weight as well as indent:
                                    // an indent alone is easy to lose at the
                                    // third level, and a document's shape is
                                    // the thing this list exists to show.
                                    heading.level <= 2
                                        ? "text-[13px] text-base-content/80"
                                        : "text-xs text-base-content/60",
                                ].join(" ")}
                                style={{
                                    paddingLeft: 12 + (heading.level - 1) * 12,
                                }}
                                // The source text, so a heading whose label is
                                // blank can still be identified on hover.
                                title={heading.text}
                                onClick={() => onHeadingClick?.(heading, index)}
                            >
                                {label.length > 0 ? (
                                    label
                                ) : (
                                    /*
                                     * A heading that says nothing — an escaped
                                     * space is the usual way this happens. It
                                     * is still a heading and still navigable,
                                     * so it keeps its row and says what it is.
                                     */
                                    <span className="text-base-content/40">
                                        （空标题）
                                    </span>
                                )}
                            </button>
                        );
                    })
                )}
            </div>

            <div
                {...resizeHandleProps}
                className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-base-content/10"
            />
        </aside>
    );
}
