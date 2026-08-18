"use client";

import { ContextMenu } from "../../../common/components/context-menu";
import type { ContextMenuItem } from "../../../common/components/context-menu";
import type { FilteredFileTreeNode } from "../lib/types";

interface FileTreeContextMenuProps {
    node: FilteredFileTreeNode | null;
    x: number;
    y: number;
    onClose: () => void;
    onCreateFolder: () => void;
    onCreateMarkdownFile: () => void;
    onFocusFolder: () => void;
    /** Whether the tree is already showing one folder rather than all of them. */
    focused: boolean;
    onShowWholeTree: () => void;
    onRename: () => void;
    onDelete: () => void;
}

/**
 * What a right-click on the tree offers, in the shared menu every right-click
 * in this app opens.
 */
export function FileTreeContextMenu({
    node,
    x,
    y,
    onClose,
    onCreateFolder,
    onCreateMarkdownFile,
    onFocusFolder,
    focused,
    onShowWholeTree,
    onRename,
    onDelete,
}: FileTreeContextMenuProps) {
    if (!node) {
        return null;
    }

    // Only a folder can be created inside, so only a folder offers it.
    const items: ContextMenuItem[] =
        node.kind === "folder"
            ? [
                  { label: "新建文件夹", onSelect: onCreateFolder },
                  { label: "新建文档", onSelect: onCreateMarkdownFile },
                  {
                      label: "只看这个文件夹",
                      onSelect: onFocusFolder,
                      separatorBefore: true,
                  },
                  ...(focused
                      ? [{ label: "显示全部", onSelect: onShowWholeTree }]
                      : []),
                  {
                      label: "重命名",
                      onSelect: onRename,
                      separatorBefore: true,
                  },
                  {
                      label: "移到废纸篓",
                      onSelect: onDelete,
                      destructive: true,
                  },
              ]
            : [
                  ...(focused
                      ? [
                            {
                                label: "显示全部",
                                onSelect: onShowWholeTree,
                            },
                        ]
                      : []),
                  { label: "重命名", onSelect: onRename },
                  {
                      label: "移到废纸篓",
                      onSelect: onDelete,
                      destructive: true,
                  },
              ];

    return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
