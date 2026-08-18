"use client";

import { Code2 } from "lucide-react";
import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { ContextMenu } from "../../../common/components/context-menu";
import type { ContextMenuItem } from "../../../common/components/context-menu";
import { EmptyState } from "../../../common/components/ui-controls";
import { formatRelativeTime } from "../lib/note-index";
import type { NoteCard } from "../lib/note-index";

interface NoteListProps {
    notes: NoteCard[];
    /** The note being edited, so the list can say which row that is. */
    activePath: string | null;
    /** Now, passed in rather than read, so a row's age is a pure function. */
    nowMs: number;
    onOpenNote: (path: string) => void;
    /**
     * Moves a note to the trash. Absent while the workspace cannot delete.
     *
     * The row asks; it does not delete. Confirming, closing the tabs that were
     * showing the file and refreshing what lists it all belong to whoever owns
     * the workspace's files.
     */
    onDeleteNote?: (path: string, title: string) => void;
    /** Shows the note's file where it lives, without opening it. */
    onRevealNote?: (path: string) => void;
    onCopyNotePath?: (path: string) => void;
    /** Shown instead of the rows when there are none. */
    emptyTitle: string;
    emptyDescription: string;
}

/**
 * The workspace's notes as rows that say what they are.
 *
 * A row carries the note's own title, the first line of its prose and when it
 * changed — enough to recognise a note without opening it, which is the whole
 * reason to list notes rather than file names.
 */
export function NoteList({
    notes,
    activePath,
    nowMs,
    onOpenNote,
    onDeleteNote,
    onRevealNote,
    onCopyNotePath,
    emptyTitle,
    emptyDescription,
}: NoteListProps) {
    const [menu, setMenu] = useState<{
        note: NoteCard;
        x: number;
        y: number;
    } | null>(null);

    /**
     * What a right-click on a note offers.
     *
     * The same vocabulary a right-click on a tab offers, in the same order: what
     * to do with the file, then the one thing that throws it away. Deleting lives
     * here rather than on a button in the row — a row is a note to be read, not a
     * row of controls.
     */
    const menuItems = (note: NoteCard): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [];

        if (onRevealNote) {
            items.push({
                label: "在 Finder 中显示",
                onSelect: () => onRevealNote(note.path),
            });
        }

        if (onCopyNotePath) {
            items.push({
                label: "复制路径",
                onSelect: () => onCopyNotePath(note.path),
            });
        }

        if (onDeleteNote) {
            items.push({
                label: "移到废纸篓",
                onSelect: () => onDeleteNote(note.path, note.title),
                destructive: true,
                separatorBefore: items.length > 0,
            });
        }

        return items;
    };

    const openMenu = (
        note: NoteCard,
        event: ReactMouseEvent<HTMLLIElement>,
    ) => {
        if (menuItems(note).length === 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        setMenu({ note, x: event.clientX, y: event.clientY });
    };
    if (notes.length === 0) {
        return (
            <div className="flex min-h-36 items-center">
                <EmptyState title={emptyTitle} description={emptyDescription} />
            </div>
        );
    }

    return (
        <ul data-mdx-note-list="" className="flex flex-col gap-1 p-2">
            {notes.map((note) => {
                const active = note.path === activePath;

                return (
                    <li
                        key={note.path}
                        className="group relative"
                        onContextMenu={(event) => openMenu(note, event)}
                    >
                        <button
                            type="button"
                            data-mdx-note-card=""
                            data-active={active ? "true" : undefined}
                            title={note.path}
                            onClick={() => onOpenNote(note.path)}
                            className={[
                                // The selected row is marked down its leading
                                // edge as well as by its ground: a tinted card
                                // on a tinted column is a difference you have to
                                // go looking for.
                                "flex w-full min-w-0 flex-col gap-1 rounded-[var(--mdx-panel-radius)] border-l-2 px-2.5 py-2 text-left transition-colors",
                                active
                                    ? "border-l-primary bg-base-100 shadow-[var(--mdx-raised-shadow)]"
                                    : "border-l-transparent hover:bg-[var(--mdx-control-hover-bg)]",
                            ].join(" ")}
                        >
                            <div className="flex min-w-0 items-center gap-1.5">
                                <Code2
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5 shrink-0 text-base-content/40"
                                />
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">
                                    {note.title}
                                </span>
                            </div>

                            {/*
                             * Two lines of prose, clipped. A note with none yet
                             * keeps its row height so the list does not comb.
                             */}
                            {/*
                             * Two lines, with the leading Chinese needs at this
                             * size; the minimum height holds both so a note with
                             * one line of prose does not make the list comb.
                             */}
                            <p className="line-clamp-2 min-h-10 text-[13px] leading-5 text-base-content/60">
                                {note.excerpt}
                            </p>

                            <div className="flex min-w-0 justify-end">
                                <span className="shrink-0 text-[11px] tabular-nums text-base-content/45">
                                    {formatRelativeTime(note.modifiedMs, nowMs)}
                                </span>
                            </div>
                        </button>
                    </li>
                );
            })}
            {menu ? (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menuItems(menu.note)}
                    onClose={() => setMenu(null)}
                />
            ) : null}
        </ul>
    );
}
