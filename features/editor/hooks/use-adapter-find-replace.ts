"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
    EditorFindMatch,
    EditorFindRequest,
    EditorFindResult,
    EditorSourceSelection,
} from "../../../packages/mdx-editor";
import {
    applyFindBarShortcut,
    createInitialFindReplaceState,
    findBarCountLabel,
    matchIndexAfterCurrentReplacement,
    nextMatchIndex,
    previousMatchIndex,
} from "../lib/find-bar-state";
import type { FindReplaceState } from "../lib/find-bar-state";

/**
 * What find and replace ask of the mounted editor.
 *
 * Every one of these is expressed in Markdown source offsets, which is why the
 * same four operations serve both editing surfaces: the visual surface and the
 * source surface answer `find` from the same document walk, and a range one of
 * them returned means the same characters in the other. Nothing here reaches a
 * rendered element, so a match is never something that only exists because a
 * preview drew it, and a replacement never lands on preview chrome.
 */
export interface AdapterFindHost {
    find(request: EditorFindRequest): EditorFindResult;
    /**
     * Paints every match, marking one as current.
     *
     * Distinct from `reveal`, which moves the caret to one of them. Counting
     * matches the user cannot see is most of a find feature and none of the
     * point, so the list is painted whenever it changes.
     */
    highlight(ranges: EditorSourceSelection[], activeIndex: number | null): void;
    /** Selects and scrolls to a match. Never moves keyboard focus. */
    reveal(range: EditorSourceSelection): void;
    /** Replaces the source a match covers, reporting whether it applied. */
    replace(range: EditorSourceSelection, text: string): Promise<boolean>;
    focus(): void;
}

export interface UseAdapterFindReplaceOptions {
    host: AdapterFindHost;
    /**
     * The Markdown the session holds. Every accepted edit changes it, which is
     * what makes a match list describe the document as it stands rather than as
     * it stood when the query was typed.
     */
    markdown: string;
    /**
     * Bumped whenever an editing surface finishes building. A surface that is
     * still mounting has no document to search, and a mode switch replaces the
     * one that answered last time.
     */
    surfaceGeneration: number;
}

const NO_MATCHES: EditorFindResult = { matches: [], activeMatchId: null };

/**
 * Find and replace driven entirely through the editor adapter.
 *
 * The bar's own behaviour — counting, labelling, cycling — is shared with the
 * surface being replaced. What differs is where matches come from: this asks
 * the adapter for the document's matches instead of walking what was rendered,
 * so a Mermaid diagram, KaTeX output and a NodeView's buttons cannot be counted
 * as document text, and a match in a collapsed or virtualised region is found
 * exactly like any other.
 */
export function useAdapterFindReplace({
    host,
    markdown,
    surfaceGeneration,
}: UseAdapterFindReplaceOptions) {
    const [state, setState] = useState<FindReplaceState>(
        createInitialFindReplaceState,
    );

    const result = useMemo(() => {
        if (!state.isOpen || state.query.length === 0) {
            return NO_MATCHES;
        }

        return host.find({
            query: state.query,
            caseSensitive: state.caseSensitive,
            wholeWord: false,
        });
        // `markdown` and `surfaceGeneration` are deliberately unread inside the
        // body: they are not inputs to the query, they are what says the answer
        // has to be asked for again. The adapter searches whatever document is
        // mounted right now, so a cached result outlives the document it
        // described the moment either of them moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        host,
        markdown,
        surfaceGeneration,
        state.caseSensitive,
        state.isOpen,
        state.query,
    ]);

    const matches: EditorFindMatch[] = result.matches;
    const matchCount = matches.length;
    const currentMatchIndex =
        state.currentMatchIndex < matchCount ? state.currentMatchIndex : 0;
    const activeMatch = matches[currentMatchIndex] ?? null;
    const countLabel = findBarCountLabel(currentMatchIndex, matchCount);

    // Painting follows the match list for the same reason revealing follows the
    // active match: it is a property of what find currently knows, not of the
    // gesture that changed it. Closing the bar clears the highlights, which is
    // why this runs on close too rather than bailing out early.
    useEffect(() => {
        host.highlight(
            state.isOpen ? matches.map((match) => match.range) : [],
            state.isOpen ? currentMatchIndex : null,
        );
    }, [currentMatchIndex, host, matches, state.isOpen]);

    // The highlights belong to the mounted surface, so they go when it does. A
    // surface built after this one starts with none, and a bar left open across
    // a mode switch repaints through the effect above.
    useEffect(() => {
        return () => {
            host.highlight([], null);
        };
    }, [host]);

    // Revealing is what "the current match" means to the user, so it follows the
    // match rather than the gesture that changed it: typing a query, stepping to
    // the next one and replacing all land here alike.
    useEffect(() => {
        if (!state.isOpen || !activeMatch) {
            return;
        }

        host.reveal(activeMatch.range);
    }, [activeMatch, host, state.isOpen]);

    const close = useCallback(() => {
        setState((current) => ({
            ...current,
            currentMatchIndex: 0,
            isOpen: false,
            query: "",
        }));
        host.focus();
    }, [host]);

    const goNext = useCallback(() => {
        setState((current) => ({
            ...current,
            currentMatchIndex: nextMatchIndex(
                current.currentMatchIndex,
                matchCount,
            ),
        }));
    }, [matchCount]);

    const goPrevious = useCallback(() => {
        setState((current) => ({
            ...current,
            currentMatchIndex: previousMatchIndex(
                current.currentMatchIndex,
                matchCount,
            ),
        }));
    }, [matchCount]);

    const openFind = useCallback(() => {
        setState((current) => applyFindBarShortcut(current, "find"));
    }, []);

    const openReplace = useCallback(() => {
        setState((current) => applyFindBarShortcut(current, "replace"));
    }, []);

    const replaceCurrent = useCallback(async () => {
        if (!activeMatch) {
            return false;
        }

        const applied = await host.replace(activeMatch.range, state.replacement);
        if (!applied) {
            return false;
        }

        setState((current) => ({
            ...current,
            currentMatchIndex: matchIndexAfterCurrentReplacement(
                current.currentMatchIndex,
                matchCount,
            ),
        }));
        host.focus();
        return true;
    }, [activeMatch, host, matchCount, state.replacement]);

    const replaceAll = useCallback(async () => {
        // Last match first. A replacement only moves the text that follows it,
        // so working backwards leaves every remaining range describing exactly
        // the characters it was found at — no offset is adjusted by hand, and a
        // replacement that is refused cannot shift the ones still to come.
        let replacementCount = 0;

        for (let index = matches.length - 1; index >= 0; index -= 1) {
            const applied = await host.replace(
                matches[index].range,
                state.replacement,
            );
            if (applied) {
                replacementCount += 1;
            }
        }

        setState((current) => ({ ...current, currentMatchIndex: 0 }));
        host.focus();
        return replacementCount;
    }, [host, matches, state.replacement]);

    const setQuery = useCallback((query: string) => {
        setState((current) => ({
            ...current,
            currentMatchIndex: 0,
            query,
        }));
    }, []);

    const setReplacement = useCallback((replacement: string) => {
        setState((current) => ({
            ...current,
            replacement,
        }));
    }, []);

    const toggleCaseSensitive = useCallback(() => {
        setState((current) => ({
            ...current,
            caseSensitive: !current.caseSensitive,
            currentMatchIndex: 0,
        }));
    }, []);

    const toggleReplaceExpanded = useCallback(() => {
        setState((current) => ({
            ...current,
            isReplaceExpanded: !current.isReplaceExpanded,
        }));
    }, []);

    return {
        activeMatch,
        countLabel,
        currentMatchIndex,
        matchCount,
        matches,
        state,
        actions: {
            close,
            goNext,
            goPrevious,
            openFind,
            openReplace,
            replaceAll,
            replaceCurrent,
            setQuery,
            setReplacement,
            toggleCaseSensitive,
            toggleReplaceExpanded,
        },
    };
}
