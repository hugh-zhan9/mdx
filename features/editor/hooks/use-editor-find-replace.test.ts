import { describe, expect, it } from "vitest";
import type { VisibleTextMatch } from "../lib/visible-text-search";
import {
    applyFindBarShortcut,
    createInitialFindReplaceState,
    findBarCountLabel,
    matchIndexAfterCurrentReplacement,
    nextMatchIndex,
    previousMatchIndex,
    replaceAllMatchesFromEnd,
} from "./use-editor-find-replace";

describe("editor find replace state", () => {
    it("opens the find bar without expanding replace", () => {
        expect(
            applyFindBarShortcut(createInitialFindReplaceState(), "find"),
        ).toEqual({
            caseSensitive: false,
            currentMatchIndex: 0,
            isOpen: true,
            isReplaceExpanded: false,
            query: "",
            replacement: "",
        });
    });

    it("opens the find bar with replace expanded", () => {
        expect(
            applyFindBarShortcut(createInitialFindReplaceState(), "replace"),
        ).toEqual({
            caseSensitive: false,
            currentMatchIndex: 0,
            isOpen: true,
            isReplaceExpanded: true,
            query: "",
            replacement: "",
        });
    });

    it("wraps next and previous match indexes", () => {
        expect(nextMatchIndex(0, 3)).toBe(1);
        expect(nextMatchIndex(2, 3)).toBe(0);
        expect(previousMatchIndex(0, 3)).toBe(2);
        expect(previousMatchIndex(2, 3)).toBe(1);
        expect(nextMatchIndex(0, 0)).toBe(0);
        expect(previousMatchIndex(0, 0)).toBe(0);
    });

    it("formats the match count label", () => {
        expect(findBarCountLabel(0, 0)).toBe("0/0");
        expect(findBarCountLabel(0, 3)).toBe("1/3");
        expect(findBarCountLabel(2, 3)).toBe("3/3");
    });

    it("keeps the next logical match active after replacing the current match", () => {
        expect(matchIndexAfterCurrentReplacement(0, 3)).toBe(0);
        expect(matchIndexAfterCurrentReplacement(1, 3)).toBe(1);
        expect(matchIndexAfterCurrentReplacement(2, 3)).toBe(1);
        expect(matchIndexAfterCurrentReplacement(0, 1)).toBe(0);
        expect(matchIndexAfterCurrentReplacement(0, 0)).toBe(0);
    });

    it("applies replacements from the end of the matches", () => {
        const applied: VisibleTextMatch[] = [];
        const matches: VisibleTextMatch[] = [
            { start: 0, end: 3 },
            { start: 8, end: 11 },
            { start: 16, end: 19 },
        ];

        const count = replaceAllMatchesFromEnd(matches, (match) => {
            applied.push(match);
            return true;
        });

        expect(count).toBe(3);
        expect(applied).toEqual([
            { start: 16, end: 19 },
            { start: 8, end: 11 },
            { start: 0, end: 3 },
        ]);
    });

    it("continues replacing after a failed replacement and returns the replacement count", () => {
        const attempted: VisibleTextMatch[] = [];
        const matches: VisibleTextMatch[] = [
            { start: 0, end: 3 },
            { start: 8, end: 11 },
            { start: 16, end: 19 },
        ];

        const count = replaceAllMatchesFromEnd(matches, (match) => {
            attempted.push(match);
            return match.start !== 8;
        });

        expect(count).toBe(2);
        expect(attempted).toEqual([
            { start: 16, end: 19 },
            { start: 8, end: 11 },
            { start: 0, end: 3 },
        ]);
    });
});
