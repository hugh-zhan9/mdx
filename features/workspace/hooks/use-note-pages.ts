"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadNotePage } from "../lib/note-index-client";
import { noteCard } from "../lib/note-index";
import type { NoteCard, NoteGroup, NoteGroupCounts } from "../lib/note-index";

const EMPTY_COUNTS: NoteGroupCounts = { all: 0, recent: 0, unfiled: 0 };

/**
 * How many more notes each request for more asks for.
 *
 * A screen holds about a dozen rows, so this is several screens of scrolling per
 * round trip without being a page nobody reads the end of.
 */
const PAGE_SIZE = 60;

interface NotePagesState {
    /** The notes on screen, most recently edited first. */
    rows: NoteCard[];
    /** How many notes each group holds, whichever one is being listed. */
    counts: NoteGroupCounts;
    /** How many notes the current group and filter hold in total. */
    matched: number;
    /** Whether what is on screen is older than what is being asked for. */
    loading: boolean;
    error: string | null;
    /** Whether the list has notes past the ones it is showing. */
    hasMore: boolean;
    /** Asks for another page of rows. */
    loadMore: () => void;
}

/** What one completed read produced, stamped with what it was a read of. */
interface LoadedPage {
    for: string;
    rootPath: string;
    rows: NoteCard[];
    counts: NoteGroupCounts;
    matched: number;
    error: string | null;
}

/**
 * The note list's rows, a page at a time.
 *
 * The window only ever grows from the top of the list — the request is always
 * "the first N" rather than "the next N" — so a page arriving twice, or out of
 * order, cannot duplicate a row or leave a hole. Re-reading the rows already on
 * screen costs one file read each, against a workspace walk that costs the same
 * whichever page is asked for.
 *
 * `revalidateKey` is what makes the list stale: the caller already learns about
 * file changes and saves and says so by changing it.
 */
export function useNotePages(
    rootPath: string | null,
    isDesktop: boolean,
    request: {
        group: NoteGroup;
        query: string;
        focusPath: string | null;
        revalidateKey: string;
    },
): NotePagesState {
    const { group, query, focusPath, revalidateKey } = request;
    const [loaded, setLoaded] = useState<LoadedPage | null>(null);
    /**
     * How many rows are being asked for, and what for.
     *
     * Held together so that changing the group or the filter starts again at one
     * page: a window of six hundred rows opened for one list is not a window the
     * next list has any reason to inherit.
     */
    const [window_, setWindow] = useState({ key: "", size: PAGE_SIZE });
    const requestRef = useRef(0);

    /**
     * What this list is a list of, as one comparable value.
     *
     * Joined with NUL, the way the surface cache joins its own key: it cannot
     * occur in a path, a group, a folder or a typed query, so no two different
     * requests can spell the same key. A space could — the filter is free text.
     */
    const key =
        rootPath !== null && isDesktop
            ? [rootPath, group, query, focusPath ?? "", revalidateKey].join(
                  "\u0000",
              )
            : null;
    const wanted = window_.key === key ? window_.size : PAGE_SIZE;
    const target = key === null ? null : `${key}\u0000${wanted}`;

    useEffect(() => {
        if (target === null || rootPath === null) {
            return;
        }

        requestRef.current += 1;
        const request = requestRef.current;

        void loadNotePage({
            rootPath,
            group,
            query,
            focusPath,
            offset: 0,
            limit: wanted,
        })
            .then((page) => {
                if (requestRef.current !== request) return;

                setLoaded({
                    for: target,
                    rootPath,
                    rows: page.notes.map(noteCard),
                    counts: page.counts,
                    matched: page.matched,
                    error: null,
                });
            })
            .catch((error: unknown) => {
                if (requestRef.current !== request) return;

                setLoaded({
                    for: target,
                    rootPath,
                    rows: [],
                    counts: EMPTY_COUNTS,
                    matched: 0,
                    error:
                        error instanceof Error
                            ? error.message
                            : "读取笔记列表失败。",
                });
            });
        // `target` carries the group, the filter and the window, so it is the
        // one thing that decides whether this has to be asked again.
    }, [focusPath, group, query, rootPath, target, wanted]);

    const loadMore = useCallback(() => {
        if (key === null) return;

        setWindow((current) => ({
            key,
            size:
                (current.key === key ? current.size : PAGE_SIZE) + PAGE_SIZE,
        }));
    }, [key]);

    return useMemo(() => {
        // A read of another workspace says nothing about this one.
        const current = loaded?.rootPath === rootPath ? loaded : null;
        const rows = current?.rows ?? [];

        return {
            rows,
            counts: current?.counts ?? EMPTY_COUNTS,
            matched: current?.matched ?? 0,
            loading: target !== null && current?.for !== target,
            error: current?.error ?? null,
            hasMore: (current?.matched ?? 0) > rows.length,
            loadMore,
        };
    }, [loadMore, loaded, rootPath, target]);
}
