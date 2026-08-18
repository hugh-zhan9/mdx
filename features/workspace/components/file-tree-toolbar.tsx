"use client";

import { FilePlus, FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
    IconButton,
    SearchField,
} from "../../../common/components/ui-controls";

interface FileTreeToolbarProps {
    query: string;
    canMutateSelection: boolean;
    onNewFolder: () => void;
    onNewMarkdownFile: () => void;
    onRename: () => void;
    onDelete: () => void;
    onRefresh: () => void;
    refreshing: boolean;
    onQueryChange: (query: string) => void;
}

export function FileTreeToolbar({
    query,
    canMutateSelection,
    onNewFolder,
    onNewMarkdownFile,
    onRename,
    onDelete,
    onRefresh,
    refreshing,
    onQueryChange,
}: FileTreeToolbarProps) {
    return (
        // Transparent, so it sits on the sidebar's ground rather than cutting a
        // lighter strip across the top of it.
        <div className="border-b border-[var(--mdx-separator)] px-2 py-2">
            {/*
             * The same icon button the window's own toolbar uses. This row used
             * to have a private copy of it, which had drifted to a different
             * resting tone, no pressed state, and a hover that painted the
             * sidebar's own colour — so nothing happened under the pointer.
             */}
            <div className="mb-2 flex min-w-0 items-center gap-1 [&>button]:shrink-0">
                <IconButton
                    label="新建文件夹"
                    icon={<FolderPlus />}
                    onClick={onNewFolder}
                />
                <IconButton
                    label="新建文档"
                    icon={<FilePlus />}
                    onClick={onNewMarkdownFile}
                />
                <IconButton
                    label={refreshing ? "正在刷新文件树" : "刷新文件树"}
                    icon={
                        <RefreshCw
                            className={refreshing ? "animate-spin" : undefined}
                        />
                    }
                    onClick={onRefresh}
                    disabled={refreshing}
                />
                <IconButton
                    label="重命名"
                    icon={<Pencil />}
                    onClick={onRename}
                    disabled={!canMutateSelection}
                />
                <IconButton
                    label="移到废纸篓"
                    icon={<Trash2 />}
                    onClick={onDelete}
                    disabled={!canMutateSelection}
                    destructive
                />
            </div>

            <SearchField
                value={query}
                onChange={onQueryChange}
                placeholder="搜索文件"
                label="搜索文件和文件夹名称"
            />
        </div>
    );
}
