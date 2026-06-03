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
        <div className="border-b border-base-300 bg-base-100 px-2 py-2">
            <div className="mb-2 flex min-w-0 items-center gap-1">
                <ToolbarButton
                    label="新建文件夹"
                    icon="📁"
                    onClick={onNewFolder}
                />
                <ToolbarButton
                    label="新建文档"
                    icon="＋"
                    onClick={onNewMarkdownFile}
                />
                <ToolbarButton
                    label={refreshing ? "正在刷新文件树" : "刷新文件树"}
                    icon={refreshing ? "…" : "↻"}
                    onClick={onRefresh}
                    disabled={refreshing}
                />
                <ToolbarButton
                    label="重命名"
                    icon="✎"
                    onClick={onRename}
                    disabled={!canMutateSelection}
                />
                <ToolbarButton
                    label="移到废纸篓"
                    icon="⌫"
                    onClick={onDelete}
                    disabled={!canMutateSelection}
                    className="text-error hover:bg-error/10 hover:text-error"
                />
            </div>

            <input
                type="search"
                className="h-7 w-full border border-base-300 bg-base-100 px-2 text-xs text-base-content outline-none transition-colors placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索文件"
                aria-label="搜索文件和文件夹名称"
            />
        </div>
    );
}

function ToolbarButton({
    label,
    icon,
    className,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    icon: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            className={[
                "flex h-7 w-7 shrink-0 items-center justify-center text-sm text-base-content/75 outline-none transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:bg-transparent",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
            {...props}
        >
            <span aria-hidden="true">{icon}</span>
        </button>
    );
}
