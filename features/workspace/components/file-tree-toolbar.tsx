"use client";

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
            <div className="mb-2 min-w-0">
                <div className="text-xs font-semibold uppercase text-base-content/60">
                    文件树
                </div>
            </div>
            <div className="grid min-w-0 grid-cols-3 gap-1">
                <button
                    type="button"
                    className="min-h-8 px-1 py-1 text-[11px] leading-tight text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                    onClick={onNewFolder}
                    title="新建文件夹"
                >
                    新建文件夹
                </button>
                <button
                    type="button"
                    className="min-h-8 px-1 py-1 text-[11px] leading-tight text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                    onClick={onNewMarkdownFile}
                    title="新建 Markdown 文档"
                >
                    新建文档
                </button>
                <button
                    type="button"
                    className="min-h-8 px-1 py-1 text-[11px] leading-tight text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                    onClick={onRefresh}
                    title="刷新"
                >
                    刷新
                </button>
            </div>
            <div className="mt-1 grid min-w-0 grid-cols-2 gap-1">
                <button
                    type="button"
                    className="min-h-8 px-1 py-1 text-[11px] leading-tight text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                    onClick={onRename}
                    disabled={!canMutateSelection}
                    title="重命名选中的文件或文件夹"
                >
                    重命名
                </button>
                <button
                    type="button"
                    className="min-h-8 px-1 py-1 text-[11px] leading-tight text-error hover:bg-error/10 disabled:text-base-content/30"
                    onClick={onDelete}
                    disabled={!canMutateSelection}
                    title="移动选中的文件或文件夹到废纸篓"
                >
                    移到废纸篓
                </button>
            </div>
            <input
                type="search"
                className="mt-2 h-7 w-full border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索名称"
                aria-label="搜索文件和文件夹名称"
            />
        </div>
    );
}
