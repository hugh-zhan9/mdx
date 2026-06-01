"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import type { FilteredFileTreeNode } from "../lib/types";

interface FileTreeContextMenuProps {
    node: FilteredFileTreeNode | null;
    x: number;
    y: number;
    onClose: () => void;
    onCreateFolder: () => void;
    onCreateMarkdownFile: () => void;
    onRename: () => void;
    onDelete: () => void;
}

export function FileTreeContextMenu({
    node,
    x,
    y,
    onClose,
    onCreateFolder,
    onCreateMarkdownFile,
    onRename,
    onDelete,
}: FileTreeContextMenuProps) {
    if (!node) {
        return null;
    }

    const isFolder = node.kind === "folder";
    const handleClick = (
        handler: () => void,
    ) =>
        (event: ReactMouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            handler();
            onClose();
        };

    return (
        <div
            className="fixed z-30 min-w-44 border border-base-300 bg-base-100 py-1 text-sm shadow-lg"
            style={{ left: x, top: y }}
            onContextMenu={(event) => event.preventDefault()}
        >
            {isFolder ? (
                <>
                    <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-base-content/75 hover:bg-base-200"
                        onClick={handleClick(onCreateFolder)}
                    >
                        New folder
                    </button>
                    <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-base-content/75 hover:bg-base-200"
                        onClick={handleClick(onCreateMarkdownFile)}
                    >
                        New markdown file
                    </button>
                    <div className="my-1 border-t border-base-300" />
                </>
            ) : null}
            <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-base-content/75 hover:bg-base-200"
                onClick={handleClick(onRename)}
            >
                Rename
            </button>
            <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-error hover:bg-error/10"
                onClick={handleClick(onDelete)}
            >
                Delete
            </button>
        </div>
    );
}
