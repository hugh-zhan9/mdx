"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type {
    DragEvent,
    MouseEvent as ReactMouseEvent,
} from "react";
import type {
    FilteredFileTreeNode,
    HighlightSegment,
} from "../lib/types";

interface FileTreeNodeViewProps {
    node: FilteredFileTreeNode;
    depth: number;
    selectedPath: string | null;
    expandedPaths: Set<string>;
    searchActive: boolean;
    onSelect: (node: FilteredFileTreeNode) => void;
    onToggleFolder: (path: string) => void;
    onContextMenu: (
        node: FilteredFileTreeNode,
        event: ReactMouseEvent<HTMLButtonElement>,
    ) => void;
    onDoubleClick: (node: FilteredFileTreeNode) => void;
    onDragStart: (
        node: FilteredFileTreeNode,
        event: DragEvent<HTMLButtonElement>,
    ) => void;
    onDropOnFolder: (fromPath: string, targetDir: string) => void;
}

export function FileTreeNodeView({
    node,
    depth,
    selectedPath,
    expandedPaths,
    searchActive,
    onSelect,
    onToggleFolder,
    onContextMenu,
    onDoubleClick,
    onDragStart,
    onDropOnFolder,
}: FileTreeNodeViewProps) {
    const isSelected = selectedPath === node.path;
    const isFolder = node.kind === "folder";
    const isExpanded =
        isFolder && (searchActive || expandedPaths.has(node.path));
    const paddingLeft = 12 + depth * 14;
    const rowClassName = [
        "flex h-7 w-full min-w-0 items-center gap-1 truncate pr-3 text-left text-sm outline-none",
        isSelected
            ? "bg-primary/10 text-base-content"
            : "text-base-content/72 hover:bg-base-200",
    ].join(" ");

    return (
        <div>
            <button
                type="button"
                className={rowClassName}
                style={{ paddingLeft }}
                title={node.path}
                draggable
                onClick={(event) => {
                    if (shouldOpenFileTreeContextMenuFromClick(event)) {
                        onContextMenu(node, event);
                        return;
                    }

                    onSelect(node);

                    if (node.kind === "folder") {
                        onToggleFolder(node.path);
                    }
                }}
                onContextMenu={(event) => onContextMenu(node, event)}
                onDoubleClick={() => onDoubleClick(node)}
                onDragStart={(event) => onDragStart(node, event)}
                onDragOver={
                    isFolder
                        ? (event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                          }
                        : undefined
                }
                onDrop={
                    isFolder
                        ? (event) => {
                              event.preventDefault();
                              const fromPath =
                                  event.dataTransfer.getData("text/plain");

                              if (fromPath) {
                                  onDropOnFolder(fromPath, node.path);
                              }
                          }
                        : undefined
                }
            >
                <span className="inline-flex w-4 shrink-0 items-center justify-center text-base-content/65">
                    {node.kind === "folder" ? (
                        isExpanded ? (
                            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                        )
                    ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">
                    <HighlightedName
                        segments={
                            node.nameSegments ?? [
                                { text: node.name, highlighted: false },
                            ]
                        }
                    />
                </span>
            </button>

            {node.kind === "folder" && isExpanded ? (
                node.children.length > 0 ? (
                    <div>
                        {node.children.map((child) => (
                            <FileTreeNodeView
                                key={child.path}
                                node={child}
                                depth={depth + 1}
                                selectedPath={selectedPath}
                                expandedPaths={expandedPaths}
                                searchActive={searchActive}
                                onSelect={onSelect}
                                onToggleFolder={onToggleFolder}
                                onContextMenu={onContextMenu}
                                onDoubleClick={onDoubleClick}
                                onDragStart={onDragStart}
                                onDropOnFolder={onDropOnFolder}
                            />
                        ))}
                    </div>
                ) : (
                    <div
                        className="h-6 truncate pr-2 text-xs text-base-content/65"
                        style={{ paddingLeft: paddingLeft + 18 }}
                    >
                        空文件夹
                    </div>
                )
            ) : null}
        </div>
    );
}

export function shouldOpenFileTreeContextMenuFromClick(event: {
    button: number;
    ctrlKey: boolean;
}) {
    return event.ctrlKey && event.button === 0;
}

function HighlightedName({ segments }: { segments: HighlightSegment[] }) {
    return (
        <>
            {segments.map((segment, index) => (
                <span
                    key={`${segment.text}-${index}`}
                    className={
                        segment.highlighted
                            ? "bg-warning/25 text-base-content"
                            : undefined
                    }
                >
                    {segment.text}
                </span>
            ))}
        </>
    );
}
