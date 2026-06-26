// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { MarkdownSelectionOffsets } from "../../../packages/mdx-editor";
import type { VisibleTextMatch } from "../lib/visible-text-search";
import { findVisibleTextMatches } from "../lib/visible-text-search";
import {
    applyFindBarShortcut,
    buildVisibleTextIndexForMarkdown,
    createInitialFindReplaceState,
    findBarCountLabel,
    markdownToSearchableText,
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
    it("falls back to markdown text when the editor DOM index is empty", () => {
        const root = document.createElement("div");
        const markdown = [
            "---",
            "title: Markdown 语法支持检查",
            "---",
            "",
            "# Markdown 语法支持检查",
        ].join("\n");

        const index = buildVisibleTextIndexForMarkdown(root, markdown);

        expect(index.text).toContain("语法");
        expect(
            findVisibleTextMatches(index, "语法", { caseSensitive: false }),
        ).toHaveLength(2);
    });

    it("keeps Chinese markdown content searchable after lightweight cleanup", () => {
        expect(markdownToSearchableText("# Markdown 语法支持检查")).toContain(
            "语法",
        );
    });

    it("rebuilds from the live DOM when mermaid visibility changes", () => {
        const root = document.createElement("div");
        document.body.append(root);
        const pre = createCodeBlock("mermaid", "graph TD\n  HiddenRaw --> B");
        pre.hidden = true;
        pre.setAttribute("aria-hidden", "true");
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

    it("includes hidden mirror semantic text without duplicating ordinary DOM matches", () => {
        const root = document.createElement("div");
        document.body.append(root);

        const paragraph = document.createElement("p");
        paragraph.textContent = "Plain paragraph";
        paragraph.setAttribute("data-layout-block-id", "paragraph-1");
        root.append(paragraph);

        const mirror = document.createElement("div");
        mirror.setAttribute("data-layout-light-mirror", "");
        mirror.style.display = "none";
        const mirrorBlock = document.createElement("div");
        mirrorBlock.textContent = "Plain paragraph";
        mirrorBlock.setAttribute("data-mirror-block-id", "paragraph-1");
        mirror.append(mirrorBlock);
        const mirrorCanvasOnly = document.createElement("div");
        mirrorCanvasOnly.textContent = "x squared";
        mirrorCanvasOnly.setAttribute("data-mirror-block-id", "math-1");
        mirror.append(mirrorCanvasOnly);
        root.append(mirror);

        const preview = document.createElement("div");
        preview.setAttribute("data-mdx-mermaid-preview", "mermaid-3");
        preview.textContent = "GeneratedLabel";
        root.append(preview);

        const index = buildVisibleTextIndexForMarkdown(root, "# ignored fallback");

        expect(
            findVisibleTextMatches(index, "x squared", {
                caseSensitive: false,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(index, "Plain paragraph", {
                caseSensitive: false,
            }),
        ).toHaveLength(1);
        expect(index.text).toContain("x squared");
        expect(index.text).not.toContain("GeneratedLabel");

        root.remove();
    });

    it("preserves mirror matches when the same ordinary DOM text belongs to a different block", () => {
        const root = document.createElement("div");
        document.body.append(root);

        const paragraph = document.createElement("p");
        paragraph.textContent = "x squared";
        paragraph.setAttribute("data-layout-block-id", "paragraph-1");
        root.append(paragraph);

        const mirror = document.createElement("div");
        mirror.setAttribute("data-layout-light-mirror", "");
        mirror.style.display = "none";
        const mirrorBlock = document.createElement("div");
        mirrorBlock.textContent = "x squared";
        mirrorBlock.setAttribute("data-mirror-block-id", "math-1");
        mirror.append(mirrorBlock);
        root.append(mirror);

        const index = buildVisibleTextIndexForMarkdown(root, "");

        expect(
            findVisibleTextMatches(index, "x squared", {
                caseSensitive: false,
            }),
        ).toHaveLength(2);

        root.remove();
    });

    it("invalidates hook matches when visibility revision changes", async () => {
        const host = document.createElement("div");
        const editorRoot = document.createElement("div");
        document.body.append(host, editorRoot);
        const reactRoot = createRoot(host);
        const pre = createCodeBlock("mermaid", "graph TD\n  HiddenRaw --> B");
        pre.hidden = true;
        pre.setAttribute("aria-hidden", "true");
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

        const stateAfterOpen = latestState as FindReplaceState | null;
        expect(stateAfterOpen?.query).toBe("raw");

        await act(async () => {
            close?.();
        });
        await act(async () => {});

        const stateAfterClose = latestState as FindReplaceState | null;
        expect(stateAfterClose?.isOpen).toBe(false);
        expect(stateAfterClose?.query).toBe("");

        act(() => reactRoot.unmount());
        editorRoot.remove();
        host.remove();
    });

    it("replaces mirror matches with explicit markdown selection offsets", async () => {
        const host = document.createElement("div");
        const editorRoot = document.createElement("div");
        document.body.append(host, editorRoot);
        const reactRoot = createRoot(host);
        const replaceSelectedText = vi.fn();
        const paragraph = document.createElement("span");
        paragraph.textContent = "Before ";
        paragraph.setAttribute("data-layout-block-id", "paragraph-1");
        paragraph.setAttribute("data-layout-pm-from", "0");
        paragraph.setAttribute("data-layout-pm-to", "7");
        editorRoot.append(paragraph);
        const mirror = document.createElement("div");
        mirror.setAttribute("data-layout-light-mirror", "");
        mirror.style.display = "none";
        const mirrorBlock = document.createElement("div");
        mirrorBlock.textContent = "x^2";
        mirrorBlock.setAttribute("data-mirror-block-id", "math-1");
        mirrorBlock.setAttribute("data-mirror-pm-from", "8");
        mirrorBlock.setAttribute("data-mirror-pm-to", "11");
        mirror.append(mirrorBlock);
        editorRoot.append(mirror);
        let replaceCurrent: (() => boolean) | null = null;

        function Harness() {
            const findReplace = useEditorFindReplace({
                editorRoot,
                focusEditor: () => {},
                markdown: "Before $x^2$ after",
                replaceSelectedText,
            });
            const { openReplace, setQuery, setReplacement } = findReplace.actions;
            useEffect(() => {
                openReplace();
                setQuery("x^2");
                setReplacement("z^2");
            }, [openReplace, setQuery, setReplacement]);
            useEffect(() => {
                replaceCurrent = findReplace.actions.replaceCurrent;
            }, [findReplace.actions.replaceCurrent]);
            return null;
        }

        await act(async () => {
            reactRoot.render(createElement(Harness));
        });
        await act(async () => {});

        await act(async () => {
            replaceCurrent?.();
        });
        await act(async () => {});

        expect(replaceSelectedText).toHaveBeenCalledWith(
            "z^2",
            {
                anchor: 8,
                head: 11,
            } satisfies MarkdownSelectionOffsets,
        );

        act(() => reactRoot.unmount());
        editorRoot.remove();
        host.remove();
    });

    it("replaces all matches in markdown-offset order when mirror and ordinary matches interleave", async () => {
        const host = document.createElement("div");
        const editorRoot = document.createElement("div");
        document.body.append(host, editorRoot);
        const reactRoot = createRoot(host);
        const replaceSelectedText = vi.fn();
        const ordinary = document.createElement("span");
        ordinary.textContent = "x^2";
        ordinary.setAttribute("data-layout-block-id", "paragraph-1");
        ordinary.setAttribute("data-layout-pm-from", "6");
        ordinary.setAttribute("data-layout-pm-to", "9");
        editorRoot.append(ordinary);
        const mirror = document.createElement("div");
        mirror.setAttribute("data-layout-light-mirror", "");
        mirror.style.display = "none";
        const mirrorBlock = document.createElement("div");
        mirrorBlock.textContent = "x^2";
        mirrorBlock.setAttribute("data-mirror-block-id", "math-1");
        mirrorBlock.setAttribute("data-mirror-pm-from", "1");
        mirrorBlock.setAttribute("data-mirror-pm-to", "4");
        mirror.append(mirrorBlock);
        editorRoot.append(mirror);
        let replaceAll: (() => number) | null = null;

        function Harness() {
            const findReplace = useEditorFindReplace({
                editorRoot,
                focusEditor: () => {},
                markdown: "$x^2$ x^2",
                replaceSelectedText,
            });
            const { openReplace, setQuery, setReplacement } = findReplace.actions;
            useEffect(() => {
                openReplace();
                setQuery("x^2");
                setReplacement("zz^22");
            }, [openReplace, setQuery, setReplacement]);
            useEffect(() => {
                replaceAll = findReplace.actions.replaceAll;
            }, [findReplace.actions.replaceAll]);
            return null;
        }

        await act(async () => {
            reactRoot.render(createElement(Harness));
        });
        await act(async () => {});

        let count = 0;
        await act(async () => {
            count = replaceAll?.() ?? 0;
        });
        await act(async () => {});

        expect(count).toBe(2);
        expect(replaceSelectedText.mock.calls).toEqual([
            ["zz^22", { anchor: 6, head: 9 }],
            ["zz^22", { anchor: 1, head: 4 }],
        ]);

        act(() => reactRoot.unmount());
        editorRoot.remove();
        host.remove();
    });

    it("refuses replaceCurrent for semantic mirror text that is not source-equivalent", async () => {
        const host = document.createElement("div");
        const editorRoot = document.createElement("div");
        document.body.append(host, editorRoot);
        const reactRoot = createRoot(host);
        const replaceSelectedText = vi.fn();
        const mirror = document.createElement("div");
        mirror.setAttribute("data-layout-light-mirror", "");
        mirror.style.display = "none";
        const mirrorBlock = document.createElement("div");
        mirrorBlock.textContent = "x squared";
        mirrorBlock.setAttribute("data-mirror-block-id", "math-1");
        mirrorBlock.setAttribute("data-mirror-pm-from", "1");
        mirrorBlock.setAttribute("data-mirror-pm-to", "4");
        mirror.append(mirrorBlock);
        editorRoot.append(mirror);
        let replaceCurrent: (() => boolean) | null = null;

        function Harness() {
            const findReplace = useEditorFindReplace({
                editorRoot,
                focusEditor: () => {},
                markdown: "$x^2$",
                replaceSelectedText,
            });
            const { openReplace, setQuery, setReplacement } = findReplace.actions;
            useEffect(() => {
                openReplace();
                setQuery("x squared");
                setReplacement("z squared");
            }, [openReplace, setQuery, setReplacement]);
            useEffect(() => {
                replaceCurrent = findReplace.actions.replaceCurrent;
            }, [findReplace.actions.replaceCurrent]);
            return null;
        }

        await act(async () => {
            reactRoot.render(createElement(Harness));
        });
        await act(async () => {});

        let replaced = true;
        await act(async () => {
            replaced = replaceCurrent?.() ?? true;
        });
        await act(async () => {});

        expect(replaced).toBe(false);
        expect(replaceSelectedText).not.toHaveBeenCalled();

        act(() => reactRoot.unmount());
        editorRoot.remove();
        host.remove();
    });
});

function createCodeBlock(language: string, text: string): HTMLPreElement {
    const pre = document.createElement("pre");
    pre.setAttribute("data-mdx-code-block", "");
    pre.setAttribute("data-mdx-node-type", "code_block");
    pre.setAttribute("data-mdx-language", language);
    const code = document.createElement("code");
    code.textContent = text;
    pre.append(code);
    return pre;
}
