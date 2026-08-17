"use client";

import {
    FilePlus,
    FolderPlus,
    Pencil,
    RefreshCw,
    Search,
    Trash2,
} from "lucide-react";
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
        // Transparent, so it sits on the sidebar's ground rather than cutting a
        // lighter strip across the top of it.
        <div className="border-b border-[var(--mdx-separator)] px-2 py-2">
            <div className="mb-2 flex min-w-0 items-center gap-1">
                <ToolbarButton
                    label="新建文件夹"
                    icon={<FolderPlus />}
                    onClick={onNewFolder}
                />
                <ToolbarButton
                    label="新建文档"
                    icon={<FilePlus />}
                    onClick={onNewMarkdownFile}
                />
                <ToolbarButton
                    label={refreshing ? "正在刷新文件树" : "刷新文件树"}
                    icon={<RefreshCw className={refreshing ? "animate-spin" : undefined} />}
                    onClick={onRefresh}
                    disabled={refreshing}
                />
                <ToolbarButton
                    label="重命名"
                    icon={<Pencil />}
                    onClick={onRename}
                    disabled={!canMutateSelection}
                />
                <ToolbarButton
                    label="移到废纸篓"
                    icon={<Trash2 />}
                    onClick={onDelete}
                    disabled={!canMutateSelection}
                    // Red on hover, neutral at rest: a toolbar that is red
                    // before anything is even selected is warning about
                    // nothing, and it is the loudest thing on screen.
                    className="hover:bg-error/10 hover:text-error"
                />
            </div>

            {/*
             * A filled, borderless field, as macOS draws a search box. An
             * outlined white box on a tinted sidebar reads as a form control
             * borrowed from a web page.
             */}
            <label className="flex min-w-0 items-center gap-2 rounded-[var(--mdx-control-radius)] bg-base-content/6 px-2.5 transition-colors focus-within:bg-base-content/9 focus-within:ring-2 focus-within:ring-primary/25">
                <Search
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-base-content/55"
                />
                <input
                    type="search"
                    className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs text-base-content outline-none transition-colors placeholder:text-base-content/65 focus:outline-none"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="搜索文件"
                    aria-label="搜索文件和文件夹名称"
                />
            </label>
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
                "inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-[var(--mdx-control-radius)] text-base-content/75 outline-none transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:bg-transparent [&>svg]:h-4 [&>svg]:w-4",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
            {...props}
        >
            <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center"
            >
                {icon}
            </span>
        </button>
    );
}
