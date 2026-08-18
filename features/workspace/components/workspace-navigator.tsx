"use client";

import { Clock, FileStack, Inbox, Plus } from "lucide-react";
import type { HTMLAttributes, ReactNode, UIEvent } from "react";

import {
    IconButton,
    SearchField,
    SegmentedControl,
} from "../../../common/components/ui-controls";
import type {
    NoteCard,
    NoteGroup,
    NoteGroupCounts,
} from "../lib/note-index";
import type { MarkdownOutlineHeading } from "../lib/types";
import { NoteList } from "./note-list";
import { OutlinePanel } from "./outline-panel";

/** Which of the navigator's two lists is showing. */
export type NavigatorTab = "notes" | "outline";

interface WorkspaceNavigatorProps {
    /** The notes on screen, most recently edited first. */
    rows: NoteCard[];
    /** How many notes each group holds, whichever one is being listed. */
    counts: NoteGroupCounts;
    /** How many notes the current group and filter hold in total. */
    matched: number;
    /** Whether there are notes past the rows on screen. */
    hasMore: boolean;
    /** Asks for the next page, when the list is scrolled near its end. */
    onLoadMore: () => void;
    notesLoading: boolean;
    notesError: string | null;
    group: NoteGroup;
    onGroupChange: (group: NoteGroup) => void;
    query: string;
    onQueryChange: (query: string) => void;
    /** The note open in the editor, so its row can say so. */
    activePath: string | null;
    onOpenNote: (path: string) => void;
    /** Absent while the workspace cannot take a new file. */
    onCreateNote?: () => void;
    /** Absent while the workspace cannot delete one. */
    onDeleteNote?: (path: string, title: string) => void;
    /** The rest of what a right-click on a note offers. */
    onRevealNote?: (path: string) => void;
    onCopyNotePath?: (path: string) => void;
    /** Now, passed in rather than read, so every row's age agrees. */
    nowMs: number;
    tab: NavigatorTab;
    onTabChange: (tab: NavigatorTab) => void;
    headings: MarkdownOutlineHeading[];
    onHeadingClick: (heading: MarkdownOutlineHeading, index: number) => void;
    /**
     * The folder tree, rendered by the caller.
     *
     * Passed in rather than built here: the tree needs a dozen things from the
     * workspace session — mutations, search state, context menus — and threading
     * them through this component would make it a pipe rather than a layout.
     */
    tree: ReactNode;
    resizeHandleProps: HTMLAttributes<HTMLDivElement>;
    /** The rail's width, which the user can drag. */
    railWidth: number;
    railResizeHandleProps: HTMLAttributes<HTMLDivElement>;
}

const GROUPS: ReadonlyArray<{
    value: NoteGroup;
    label: string;
    icon: ReactNode;
}> = [
    { value: "all", label: "所有笔记", icon: <FileStack /> },
    { value: "recent", label: "最近编辑", icon: <Clock /> },
    { value: "unfiled", label: "未归类", icon: <Inbox /> },
];

const NAVIGATOR_TABS: ReadonlyArray<{ value: NavigatorTab; label: string }> = [
    { value: "notes", label: "笔记" },
    { value: "outline", label: "大纲" },
];

/**
 * How close to the end of the list counts as reaching it.
 *
 * Far enough that the next page is usually already there by the time the last
 * row is: asking only at the very bottom shows the reader the end of the list
 * and then moves it.
 */
const LOAD_MORE_DISTANCE_PX = 320;

/**
 * Everything you use to get to a document: the groups, the folders, the notes.
 *
 * Two columns in one panel. The narrow rail says which notes are being listed —
 * a group, or a folder — and the wider column is the list itself, which shares
 * its space with the current document's outline. They are one component because
 * they resize as one thing, and because the tab above the list is what decides
 * whether the outline needs a column of its own at all.
 */
export function WorkspaceNavigator({
    rows,
    counts,
    matched,
    hasMore,
    onLoadMore,
    notesLoading,
    notesError,
    group,
    onGroupChange,
    query,
    onQueryChange,
    activePath,
    onOpenNote,
    onCreateNote,
    onDeleteNote,
    onRevealNote,
    onCopyNotePath,
    nowMs,
    tab,
    onTabChange,
    headings,
    onHeadingClick,
    tree,
    resizeHandleProps,
    railWidth,
    railResizeHandleProps,
}: WorkspaceNavigatorProps) {
    /**
     * Asks for the next page as the end of the list comes into view.
     *
     * The list is a window onto a workspace that can hold tens of thousands of
     * notes, so it grows as it is read rather than being drawn all at once.
     */
    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        if (!hasMore || notesLoading) {
            return;
        }

        const list = event.currentTarget;
        const remaining =
            list.scrollHeight - list.scrollTop - list.clientHeight;

        if (remaining <= LOAD_MORE_DISTANCE_PX) {
            onLoadMore();
        }
    };

    return (
        <aside
            data-mdx-workspace-navigator=""
            className="relative flex h-full min-h-0 overflow-hidden border-r border-[var(--mdx-separator)] bg-[var(--mdx-sidebar-bg)]"
        >
            <div
                className="relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-[var(--mdx-separator)]"
                style={{ width: railWidth }}
            >
                <nav className="shrink-0 p-2" aria-label="笔记分组">
                    {GROUPS.map((entry) => {
                        const active = group === entry.value;

                        return (
                            <button
                                key={entry.value}
                                type="button"
                                aria-pressed={active}
                                onClick={() => onGroupChange(entry.value)}
                                className={[
                                    "flex h-8 w-full min-w-0 items-center gap-2 rounded-[var(--mdx-control-radius)] px-2 text-left text-sm transition-colors",
                                    active
                                        ? "bg-base-content/10 text-base-content"
                                        : "text-base-content/85 hover:bg-[var(--mdx-control-hover-bg)]",
                                ].join(" ")}
                            >
                                <span
                                    aria-hidden="true"
                                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-base-content/55 [&>svg]:h-4 [&>svg]:w-4"
                                >
                                    {entry.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                    {entry.label}
                                </span>
                                {/*
                                 * The count is the group's own, not the
                                 * filter's: a number that changed as you typed
                                 * would stop being the size of the group.
                                 */}
                                <span className="shrink-0 text-[11px] tabular-nums text-base-content/45">
                                    {counts[entry.value]}
                                </span>
                            </button>
                        );
                    })}
                </nav>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-[var(--mdx-separator)]">
                    <div className="shrink-0 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-base-content/45">
                        文件夹
                    </div>
                    {/*
                     * The tree keeps its own scrolling and its own toolbar. Its
                     * border and resize handle belong to the panel it used to be,
                     * so they are turned off here rather than in it: this panel
                     * has one edge and one handle, and they are its own.
                     */}
                    <div className="min-h-0 flex-1 overflow-hidden [&>aside]:h-full [&>aside]:border-r-0 [&>aside>div:last-child]:hidden">
                        {tree}
                    </div>
                </div>

                {/*
                 * The rail's own edge. The tree used to be as wide as I decided
                 * it should be; how much room a folder path needs is the user's
                 * business, not mine.
                 */}
                <div
                    {...railResizeHandleProps}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-base-content/10"
                />
            </div>

            <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--mdx-content-bg)]">
                <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-2">
                    <SegmentedControl
                        variant="tabs"
                        label="笔记或大纲"
                        value={tab}
                        options={NAVIGATOR_TABS}
                        onChange={onTabChange}
                    />
                    <IconButton
                        label="新建笔记"
                        icon={<Plus />}
                        onClick={onCreateNote}
                        disabled={!onCreateNote}
                    />
                </div>

                {tab === "notes" ? (
                    <>
                        <div className="shrink-0 px-2 pb-2">
                            {/*
                             * By name, which is what can be answered over a
                             * whole workspace without reading every note. The
                             * file tree's own search reads contents.
                             */}
                            <SearchField
                                value={query}
                                onChange={onQueryChange}
                                placeholder="按名称筛选…"
                                label="按文件名筛选笔记"
                            />
                        </div>
                        <div className="flex shrink-0 items-center justify-between px-3 pb-1 text-[11px] text-base-content/45">
                            <span className="tabular-nums">{matched} 篇</span>
                            {notesLoading ? <span>读取中</span> : null}
                        </div>
                        <div
                            className="min-h-0 flex-1 overflow-auto"
                            onScroll={handleListScroll}
                        >
                            {notesError ? (
                                <p className="px-3 py-4 text-xs leading-relaxed text-warning">
                                    {notesError}
                                </p>
                            ) : (
                                <NoteList
                                    notes={rows}
                                    activePath={activePath}
                                    nowMs={nowMs}
                                    onOpenNote={onOpenNote}
                                    onDeleteNote={onDeleteNote}
                                    onRevealNote={onRevealNote}
                                    onCopyNotePath={onCopyNotePath}
                                    emptyTitle={
                                        query.trim().length > 0
                                            ? "没有匹配的笔记"
                                            : "这里还没有笔记"
                                    }
                                    emptyDescription={
                                        query.trim().length > 0
                                            ? "换个词，或者清空筛选看这一组的全部笔记。"
                                            : "用上面的加号新建一篇，或者从左边的文件夹里打开一个。"
                                    }
                                />
                            )}
                        </div>
                    </>
                ) : (
                    /*
                     * The outline, in the column the note list was using. It
                     * draws its own panel, whose left border and resize handle
                     * belong to the column it used to be and not to this one.
                     */
                    <div className="min-h-0 flex-1 overflow-hidden [&>aside]:h-full [&>aside]:border-l-0 [&>aside]:bg-transparent [&>aside>div:last-child]:hidden">
                        <OutlinePanel
                            headings={headings}
                            collapsed={false}
                            onHeadingClick={onHeadingClick}
                            resizeHandleProps={{}}
                        />
                    </div>
                )}
            </div>

            <div
                {...resizeHandleProps}
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-base-content/10"
            />
        </aside>
    );
}
