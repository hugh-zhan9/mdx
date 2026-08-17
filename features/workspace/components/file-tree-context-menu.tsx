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
            className="fixed z-30 min-w-48 rounded-lg bg-base-100 py-1 text-sm shadow-[0_0_0_0.5px_color-mix(in_srgb,var(--color-base-content)_14%,transparent),0_12px_32px_-8px_color-mix(in_srgb,var(--color-base-content)_40%,transparent)]"
            style={{ left: x, top: y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
        >
            {isFolder ? (
                <>
                    <button
                        type="button"
                        className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-base-content/75 hover:bg-base-200"
                        onClick={handleClick(onCreateFolder)}
                    >
                        新建文件夹
                    </button>
                    <button
                        type="button"
                        className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-base-content/75 hover:bg-base-200"
                        onClick={handleClick(onCreateMarkdownFile)}
                    >
                        新建文档
                    </button>
                    <div className="my-1 border-t border-[var(--mdx-separator)]" />
                </>
            ) : null}
            <button
                type="button"
                className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-base-content/75 hover:bg-base-200"
                onClick={handleClick(onRename)}
            >
                重命名
            </button>
            <button
                type="button"
                className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-error hover:bg-error/10"
                onClick={handleClick(onDelete)}
            >
                移到废纸篓
            </button>
        </div>
    );
}
