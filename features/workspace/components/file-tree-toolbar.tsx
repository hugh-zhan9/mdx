"use client";

import type React from "react";

interface FileTreeToolbarProps {
    query: string;
    canMutateSelection: boolean;
    onNewFolder: () => void;
    onNewMarkdownFile: () => void;
    onRename: () => void;
    onDelete: () => void;
    onRefresh: () => void;
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
    onQueryChange,
}: FileTreeToolbarProps) {
    return (
        <div className="border-b border-base-300 bg-base-100 px-2 py-2">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0 truncate text-xs font-semibold text-base-content/75">
                    文件树
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <ToolbarButton onClick={onNewFolder}>
                        新建文件夹
                    </ToolbarButton>
                    <ToolbarButton onClick={onNewMarkdownFile}>
                        新建文档
                    </ToolbarButton>
                    <ToolbarButton onClick={onRefresh}>刷新</ToolbarButton>
                </div>
            </div>
            <div className="mb-2 flex min-w-0 items-center gap-1">
                <ToolbarButton
                    onClick={onRename}
                    disabled={!canMutateSelection}
                >
                    重命名
                </ToolbarButton>
                <ToolbarButton
                    onClick={onDelete}
                    disabled={!canMutateSelection}
                    className="text-error hover:bg-error/10 hover:text-error"
                >
                    移到废纸篓
                </ToolbarButton>
                <div className="min-w-0 flex-1 truncate pl-1 text-[11px] leading-5 text-base-content/65">
                    {canMutateSelection
                        ? "操作当前选中的文件或文件夹"
                        : "选择文件或文件夹后可操作"}
                </div>
            </div>
            <input
                type="search"
                className="h-7 w-full border border-base-300 bg-base-100 px-2 text-xs text-base-content outline-none transition-colors placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索 Markdown 文件"
                aria-label="搜索文件和文件夹名称"
            />
        </div>
    );
}

function ToolbarButton({
    className,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={[
                "h-7 shrink-0 px-2 text-xs text-base-content/75 outline-none transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:bg-transparent",
                className,
            ].filter(Boolean).join(" ")}
            {...props}
        />
    );
}
