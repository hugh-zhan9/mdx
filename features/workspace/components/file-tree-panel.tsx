"use client";

import type { HTMLAttributes } from "react";
import type { FileTreeNode } from "../lib/types";

interface FileTreePanelProps {
    rootPath: string;
    fileTree: FileTreeNode[];
    collapsed: boolean;
    onToggleCollapsed: () => void;
    resizeHandleProps: HTMLAttributes<HTMLDivElement>;
}

export function FileTreePanel({
    rootPath,
    fileTree,
    collapsed,
    onToggleCollapsed,
    resizeHandleProps,
}: FileTreePanelProps) {
    if (collapsed) {
        return null;
    }

    return (
        <aside className="relative h-full min-h-0 overflow-hidden border-r border-base-300 bg-base-100">
            <div className="flex h-10 items-center justify-between border-b border-base-300 px-3">
                <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase text-base-content/60">
                        Files
                    </div>
                    <div className="truncate text-[11px] text-base-content/45">
                        {rootPath}
                    </div>
                </div>
                <button
                    type="button"
                    className="h-7 shrink-0 px-2 text-xs text-base-content/65 hover:bg-base-200"
                    onClick={onToggleCollapsed}
                    aria-label="Collapse file panel"
                    title="Collapse file panel"
                >
                    &lt;
                </button>
            </div>

            <div className="h-[calc(100%-2.5rem)] overflow-auto py-2 text-sm">
                {fileTree.length === 0 ? (
                    <div className="px-3 py-2 text-base-content/50">
                        No markdown files found.
                    </div>
                ) : (
                    <FileTreeList nodes={fileTree} depth={0} />
                )}
            </div>

            <div
                {...resizeHandleProps}
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40"
            />
        </aside>
    );
}

function FileTreeList({
    nodes,
    depth,
}: {
    nodes: FileTreeNode[];
    depth: number;
}) {
    return (
        <div>
            {nodes.map((node) => (
                <FileTreeItem key={node.path} node={node} depth={depth} />
            ))}
        </div>
    );
}

function FileTreeItem({
    node,
    depth,
}: {
    node: FileTreeNode;
    depth: number;
}) {
    const paddingLeft = 12 + depth * 14;

    if (node.kind === "folder") {
        return (
            <details open>
                <summary
                    className="cursor-default select-none truncate py-1 pr-3 text-base-content/75 hover:bg-base-200"
                    style={{ paddingLeft }}
                    title={node.path}
                >
                    <span className="mr-1 text-base-content/40">v</span>
                    {node.name}
                </summary>
                <FileTreeList nodes={node.children} depth={depth + 1} />
            </details>
        );
    }

    return (
        <button
            type="button"
            className="block w-full truncate py-1 pr-3 text-left text-base-content/70 hover:bg-base-200"
            style={{ paddingLeft }}
            title={node.path}
        >
            {node.name}
        </button>
    );
}
