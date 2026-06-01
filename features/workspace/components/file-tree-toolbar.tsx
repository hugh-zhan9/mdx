"use client";

interface FileTreeToolbarProps {
    rootPath: string;
    query: string;
    canChooseWorkspace: boolean;
    onChooseWorkspace: () => void;
    onNewFolder: () => void;
    onNewMarkdownFile: () => void;
    onRefresh: () => void;
    onQueryChange: (query: string) => void;
}

export function FileTreeToolbar({
    rootPath,
    query,
    canChooseWorkspace,
    onChooseWorkspace,
    onNewFolder,
    onNewMarkdownFile,
    onRefresh,
    onQueryChange,
}: FileTreeToolbarProps) {
    return (
        <div className="border-b border-base-300 bg-base-100 px-2 py-2">
            <div className="mb-2 min-w-0">
                <div className="text-xs font-semibold uppercase text-base-content/60">
                    Files
                </div>
                <button
                    type="button"
                    className="block w-full min-w-0 truncate text-left text-[11px] text-base-content/45 hover:text-base-content/75 disabled:hover:text-base-content/45"
                    onClick={onChooseWorkspace}
                    disabled={!canChooseWorkspace}
                    title={rootPath}
                >
                    {rootPath}
                </button>
            </div>
            <div className="flex min-w-0 items-center gap-1">
                <button
                    type="button"
                    className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                    onClick={onNewFolder}
                    title="New folder"
                >
                    Folder
                </button>
                <button
                    type="button"
                    className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                    onClick={onNewMarkdownFile}
                    title="New markdown file"
                >
                    MD
                </button>
                <button
                    type="button"
                    className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-200 disabled:text-base-content/30"
                    onClick={onRefresh}
                    title="Refresh"
                >
                    Refresh
                </button>
            </div>
            <input
                type="search"
                className="mt-2 h-7 w-full border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search names"
                aria-label="Search file names"
            />
        </div>
    );
}
