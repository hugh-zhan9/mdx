// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { VisibleTextMatch } from "../lib/visible-text-search";
import {
    applyFindBarShortcut,
    buildVisibleTextIndexForMarkdown,
    createInitialFindReplaceState,
    findBarCountLabel,
    matchIndexAfterCurrentReplacement,
    nextMatchIndex,
    previousMatchIndex,
    replaceAllMatchesFromEnd,
    useEditorFindReplace,
} from "./use-editor-find-replace";
import type { FindReplaceState } from "./use-editor-find-replace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

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

describe("editor find replace visible text index", () => {
    it("rebuilds from the live DOM when mermaid visibility changes", () => {
        const root = document.createElement("div");
        document.body.append(root);
        const pre = document.createElement("pre");
        pre.className = "DOMD-Pre";
        pre.hidden = true;
        pre.setAttribute("aria-hidden", "true");
        const code = document.createElement("code");
        code.className = "DOMD-PreCode";
        code.textContent = "graph TD\n  HiddenRaw --> B";
        pre.append(code);
        root.append(pre);

        expect(buildVisibleTextIndexForMarkdown(root, "").text).toBe("");

        pre.hidden = false;
        pre.removeAttribute("hidden");
        pre.removeAttribute("aria-hidden");

        expect(buildVisibleTextIndexForMarkdown(root, "").text).toContain(
            "HiddenRaw",
        );

        root.remove();
    });

    it("invalidates hook matches when visibility revision changes", async () => {
        const host = document.createElement("div");
        const editorRoot = document.createElement("div");
        document.body.append(host, editorRoot);
        const reactRoot = createRoot(host);
        const pre = document.createElement("pre");
        pre.className = "DOMD-Pre";
        pre.hidden = true;
        pre.setAttribute("aria-hidden", "true");
        const code = document.createElement("code");
        code.className = "DOMD-PreCode";
        code.textContent = "graph TD\n  HiddenRaw --> B";
        pre.append(code);
        editorRoot.append(pre);
        let latestMatchCount = -1;

        function Harness({ visibilityRevision }: { visibilityRevision: number }) {
            const findReplace = useEditorFindReplace({
                editorRoot,
                focusEditor: () => {},
                markdown: "```mermaid\ngraph TD\n  HiddenRaw --> B\n```",
                replaceSelectedText: () => {},
                visibilityRevision,
            });
            const { setQuery } = findReplace.actions;
            useEffect(() => {
                setQuery("HiddenRaw");
            }, [setQuery]);
            useEffect(() => {
                latestMatchCount = findReplace.matchCount;
            }, [findReplace.matchCount]);
            return null;
        }

        await act(async () => {
            reactRoot.render(createElement(Harness, { visibilityRevision: 0 }));
        });
        await act(async () => {});

        expect(latestMatchCount).toBe(0);

        pre.hidden = false;
        pre.removeAttribute("hidden");
        pre.removeAttribute("aria-hidden");

        await act(async () => {
            reactRoot.render(createElement(Harness, { visibilityRevision: 1 }));
        });
        await act(async () => {});

        expect(latestMatchCount).toBe(1);

        act(() => reactRoot.unmount());
        editorRoot.remove();
        host.remove();
    });

    it("reselects the only match when navigating to the next match", async () => {
        const host = document.createElement("div");
        const editorRoot = document.createElement("div");
        document.body.append(host, editorRoot);
        const reactRoot = createRoot(host);
        const paragraph = document.createElement("p");
        paragraph.textContent = "raw";
        paragraph.scrollIntoView = vi.fn();
        editorRoot.append(paragraph);
        let goNext: (() => void) | null = null;

        function Harness() {
            const findReplace = useEditorFindReplace({
                editorRoot,
                focusEditor: () => {},
                markdown: "raw",
                replaceSelectedText: () => {},
            });
            const { openFind, setQuery } = findReplace.actions;
            useEffect(() => {
                openFind();
                setQuery("raw");
            }, [openFind, setQuery]);
            useEffect(() => {
                goNext = findReplace.actions.goNext;
            }, [findReplace.actions.goNext]);
            return null;
        }

        await act(async () => {
            reactRoot.render(createElement(Harness));
        });
        await act(async () => {});

        expect(paragraph.scrollIntoView).toHaveBeenCalledTimes(1);

        await act(async () => {
            goNext?.();
        });
        await act(async () => {});

        expect(paragraph.scrollIntoView).toHaveBeenCalledTimes(2);

        act(() => reactRoot.unmount());
        editorRoot.remove();
        host.remove();
    });

    it("clears the query when closing the find bar", async () => {
        const host = document.createElement("div");
        const editorRoot = document.createElement("div");
        document.body.append(host, editorRoot);
        const reactRoot = createRoot(host);
        let latestState: FindReplaceState | null = null;
        let close: (() => void) | null = null;

        function Harness() {
            const findReplace = useEditorFindReplace({
                editorRoot,
                focusEditor: () => {},
                markdown: "",
                replaceSelectedText: () => {},
            });
            const { openFind, setQuery } = findReplace.actions;
            useEffect(() => {
                openFind();
                setQuery("raw");
            }, [openFind, setQuery]);
            useEffect(() => {
                latestState = findReplace.state;
                close = findReplace.actions.close;
            }, [findReplace.actions.close, findReplace.state]);
            return null;
        }

        await act(async () => {
            reactRoot.render(createElement(Harness));
        });
        await act(async () => {});

        expect(latestState?.query).toBe("raw");

        await act(async () => {
            close?.();
        });
        await act(async () => {});

        expect(latestState?.isOpen).toBe(false);
        expect(latestState?.query).toBe("");

        act(() => reactRoot.unmount());
        editorRoot.remove();
        host.remove();
    });
});
