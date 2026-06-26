"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarkdownSelectionOffsets } from "../../../packages/mdx-editor";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    isReplaceSafeMatch,
    rangeForVisibleTextMatch,
    selectionOffsetsForVisibleTextMatch,
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
    replaceSelectedText: (
        replacement: string,
        selectionOffsets?: MarkdownSelectionOffsets | null,
    ) => void;
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

interface ReplaceTarget {
    match: VisibleTextMatch;
    selectionOffsets: MarkdownSelectionOffsets;
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
    const [selectionRevision, setSelectionRevision] = useState(0);
    const visibleTextIndex = useMemo(() => {
        void visibilityRevision;
        if (!editorRoot) {
            return markdownFallbackIndex(markdown);
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

            const selectionOffsets = selectionOffsetsForVisibleTextMatch(
                visibleTextIndex,
                match,
            );
            if (!selectionOffsets) {
                return false;
            }

            replaceSelectedText(state.replacement, selectionOffsets);
            return true;
        },
        [replaceSelectedText, selectMatch, state.replacement, visibleTextIndex],
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
    }, [activeMatch, selectMatch, selectionRevision, state.isOpen]);

    const close = useCallback(() => {
        setState((current) => ({
            ...current,
            currentMatchIndex: 0,
            isOpen: false,
            query: "",
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
        setSelectionRevision((revision) => revision + 1);
    }, [matchCount]);

    const goPrevious = useCallback(() => {
        setState((current) => ({
            ...current,
            currentMatchIndex: previousMatchIndex(
                current.currentMatchIndex,
                matchCount,
            ),
        }));
        setSelectionRevision((revision) => revision + 1);
    }, [matchCount]);

    const openFind = useCallback(() => {
        setState((current) => applyFindBarShortcut(current, "find"));
    }, []);

    const openReplace = useCallback(() => {
        setState((current) => applyFindBarShortcut(current, "replace"));
    }, []);

    const replaceAll = useCallback(() => {
        const replacementTargets = matches
            .map((match) => ({
                match,
                selectionOffsets: selectionOffsetsForVisibleTextMatch(
                    visibleTextIndex,
                    match,
                ),
            }))
            .filter(
                (target): target is ReplaceTarget =>
                    target.selectionOffsets !== null,
            )
            .sort(
                (left, right) =>
                    Math.max(
                        right.selectionOffsets.anchor,
                        right.selectionOffsets.head,
                    ) -
                    Math.max(
                        left.selectionOffsets.anchor,
                        left.selectionOffsets.head,
                    ),
            );
        let replacementCount = 0;

        for (const target of replacementTargets) {
            replaceSelectedText(state.replacement, target.selectionOffsets);
            replacementCount += 1;
        }

        setState((current) => ({
            ...current,
            currentMatchIndex: 0,
        }));
        focusEditor();
        return replacementCount;
    }, [focusEditor, matches, replaceSelectedText, state.replacement, visibleTextIndex]);

    const replaceCurrent = useCallback(() => {
        if (
            !activeMatch ||
            !isReplaceSafeMatch(visibleTextIndex, activeMatch) ||
            !replaceMatch(activeMatch)
        ) {
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
    const index = buildVisibleTextIndex(editorRoot);

    if (index.text.length > 0 || markdown.length === 0) {
        return index;
    }

    if (editorRoot.childNodes.length === 0) {
        return markdownFallbackIndex(markdown);
    }

    if (isHybridShell(editorRoot) && !hasSearchableSurface(editorRoot)) {
        return markdownFallbackIndex(markdown);
    }

    return index;
}

export function markdownToSearchableText(markdown: string) {
    return markdown
        .replace(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/, "$1")
        .replace(/^#{1,6}[ \t]+/gm, "")
        .replace(/[*_~`[\]()!>#-]/g, "");
}

function markdownFallbackIndex(markdown: string) {
    return {
        segments: [],
        text: markdownToSearchableText(markdown),
    };
}

function hasSearchableSurface(editorRoot: HTMLElement): boolean {
    return Boolean(
        editorRoot.querySelector("[data-layout-dom-text-layer] *") ||
            editorRoot.querySelector("[data-layout-light-mirror] [data-mirror-block-id]") ||
            editorRoot.querySelector("[data-layout-canvas-layer]") ||
            editorRoot.querySelector("[data-layout-svg-layer]"),
    );
}

function isHybridShell(editorRoot: HTMLElement): boolean {
    return (
        editorRoot.hasAttribute("data-mdx-editor-column") ||
        editorRoot.querySelector("[data-hybrid-editor-host]") !== null
    );
}
