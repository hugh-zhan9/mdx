"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    rangeForVisibleTextMatch,
} from "../lib/visible-text-search";
import type { VisibleTextMatch } from "../lib/visible-text-search";

export interface FindReplaceState {
    caseSensitive: boolean;
    currentMatchIndex: number;
    isOpen: boolean;
    isReplaceExpanded: boolean;
    query: string;
    replacement: string;
}

export interface UseEditorFindReplaceOptions {
    editorRoot: HTMLElement | null;
    focusEditor: () => void;
    markdown: string;
    replaceSelectedText: (replacement: string) => void;
    visibilityRevision?: number;
}

type FindBarShortcut = "find" | "replace";

export function createInitialFindReplaceState(): FindReplaceState {
    return {
        caseSensitive: false,
        currentMatchIndex: 0,
        isOpen: false,
        isReplaceExpanded: false,
        query: "",
        replacement: "",
    };
}

export function applyFindBarShortcut(
    state: FindReplaceState,
    shortcut: FindBarShortcut,
): FindReplaceState {
    return {
        ...state,
        currentMatchIndex: 0,
        isOpen: true,
        isReplaceExpanded:
            shortcut === "replace" ? true : state.isReplaceExpanded,
    };
}

export function nextMatchIndex(currentMatchIndex: number, total: number): number {
    if (total <= 0) {
        return 0;
    }

    return (currentMatchIndex + 1) % total;
}

export function previousMatchIndex(
    currentMatchIndex: number,
    total: number,
): number {
    if (total <= 0) {
        return 0;
    }

    return (currentMatchIndex - 1 + total) % total;
}

export function findBarCountLabel(
    currentMatchIndex: number,
    total: number,
): string {
    if (total <= 0) {
        return "0/0";
    }

    return `${Math.min(currentMatchIndex + 1, total)}/${total}`;
}

export function matchIndexAfterCurrentReplacement(
    currentMatchIndex: number,
    currentMatchCount: number,
): number {
    if (currentMatchCount <= 1) {
        return 0;
    }

    return Math.min(currentMatchIndex, currentMatchCount - 2);
}

export function replaceAllMatchesFromEnd(
    matches: VisibleTextMatch[],
    applyReplacement: (match: VisibleTextMatch) => boolean,
): number {
    let replacementCount = 0;

    for (let index = matches.length - 1; index >= 0; index -= 1) {
        if (applyReplacement(matches[index])) {
            replacementCount += 1;
        }
    }

    return replacementCount;
}

export function useEditorFindReplace({
    editorRoot,
    focusEditor,
    markdown,
    replaceSelectedText,
    visibilityRevision = 0,
}: UseEditorFindReplaceOptions) {
    const [state, setState] = useState<FindReplaceState>(
        createInitialFindReplaceState,
    );
    const visibleTextIndex = useMemo(() => {
        void visibilityRevision;
        if (!editorRoot) {
            return { segments: [], text: "" };
        }

        return buildVisibleTextIndexForMarkdown(editorRoot, markdown);
    }, [editorRoot, markdown, visibilityRevision]);
    const matches = useMemo(
        () =>
            findVisibleTextMatches(visibleTextIndex, state.query, {
                caseSensitive: state.caseSensitive,
            }),
        [state.caseSensitive, state.query, visibleTextIndex],
    );
    const matchCount = matches.length;
    const currentMatchIndex =
        state.currentMatchIndex < matchCount ? state.currentMatchIndex : 0;
    const activeMatch = matches[currentMatchIndex] ?? null;
    const countLabel = findBarCountLabel(currentMatchIndex, matchCount);

    const selectMatch = useCallback(
        (match: VisibleTextMatch | null) => {
            if (!match || typeof window === "undefined") {
                return false;
            }

            const selection = window.getSelection?.();
            if (!selection) {
                return false;
            }

            const range = rangeForVisibleTextMatch(visibleTextIndex, match);
            if (!range) {
                return false;
            }

            selection.removeAllRanges();
            selection.addRange(range);
            range.startContainer.parentElement?.scrollIntoView?.({
                block: "nearest",
                inline: "nearest",
            });
            return true;
        },
        [visibleTextIndex],
    );

    const replaceMatch = useCallback(
        (match: VisibleTextMatch) => {
            if (!selectMatch(match)) {
                return false;
            }

            replaceSelectedText(state.replacement);
            return true;
        },
        [replaceSelectedText, selectMatch, state.replacement],
    );

    useEffect(() => {
        if (state.currentMatchIndex < matchCount || state.currentMatchIndex === 0) {
            return;
        }

        let isCurrent = true;
        queueMicrotask(() => {
            if (!isCurrent) {
                return;
            }

            setState((current) => ({
                ...current,
                currentMatchIndex: 0,
            }));
        });

        return () => {
            isCurrent = false;
        };
    }, [matchCount, state.currentMatchIndex]);

    useEffect(() => {
        if (!state.isOpen) {
            return;
        }

        selectMatch(activeMatch);
    }, [activeMatch, selectMatch, state.isOpen]);

    const close = useCallback(() => {
        setState((current) => ({
            ...current,
            isOpen: false,
        }));
        focusEditor();
    }, [focusEditor]);

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

    const replaceAll = useCallback(() => {
        const replacementCount = replaceAllMatchesFromEnd(matches, replaceMatch);
        setState((current) => ({
            ...current,
            currentMatchIndex: 0,
        }));
        focusEditor();
        return replacementCount;
    }, [focusEditor, matches, replaceMatch]);

    const replaceCurrent = useCallback(() => {
        if (!activeMatch || !replaceMatch(activeMatch)) {
            return false;
        }

        setState((current) => ({
            ...current,
            currentMatchIndex: matchIndexAfterCurrentReplacement(
                current.currentMatchIndex,
                matchCount,
            ),
        }));
        focusEditor();
        return true;
    }, [activeMatch, focusEditor, matchCount, replaceMatch]);

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

export function buildVisibleTextIndexForMarkdown(
    editorRoot: HTMLElement,
    markdown: string,
) {
    void markdown;

    return buildVisibleTextIndex(editorRoot);
}
