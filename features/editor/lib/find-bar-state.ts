/**
 * What the find bar shows, independent of how matches are found.
 *
 * The two editing surfaces locate matches by different means — one walks the
 * document through the editor adapter, the other scans what was rendered — but
 * the bar above them counts, labels and cycles matches identically. That shared
 * behaviour is here, with no editor, no DOM and no match representation in it,
 * so neither surface can drift from the other on what "3/7" means or on which
 * match "next" reaches from the last one.
 */

export interface FindReplaceState {
    caseSensitive: boolean;
    currentMatchIndex: number;
    isOpen: boolean;
    isReplaceExpanded: boolean;
    query: string;
    replacement: string;
}

export type FindBarShortcut = "find" | "replace";

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
