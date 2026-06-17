# Editor Find/Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add current-document find/replace to the MDX editor with `Command+F`, `Command+R`, visible-text matching, case sensitivity toggle, replace current, and replace all.

**Architecture:** Add a small find/replace layer around the existing DOMD editor kernel instead of changing the closed-source editor package. A visible-text search library indexes editor DOM text nodes and maps matches to DOM ranges; a React hook owns Find Bar state and replacement operations; `EditorPane` hosts the compact inline Find Bar and keyboard shortcuts so both Workspace Mode and Document Mode inherit the feature.

**Tech Stack:** TypeScript, React 19, Vitest, DOM Selection/Range APIs, existing `@do-md/react` adapter.

---

## File Structure

- Create `features/editor/lib/visible-text-search.ts`
  - Build an index of visible DOM text nodes.
  - Exclude hidden DOMD syntax markers, non-visible nodes, and image/link source paths that are not visible editor text.
  - Find plain-text matches with optional case sensitivity.
  - Convert matches to DOM `Range` objects.
- Create `features/editor/lib/visible-text-search.test.ts`
  - Unit-test visible text indexing, matching, case sensitivity, hidden marker exclusion, code block inclusion, and link/image path exclusion.
- Create `features/editor/hooks/use-editor-find-replace.ts`
  - Own Find Bar state and actions.
  - Recompute matches from an editor root element and current query.
  - Select/scroll active matches.
  - Replace current and replace all through a replacement callback that can use the editor kernel insertion path.
- Create `features/editor/hooks/use-editor-find-replace.test.ts`
  - Unit-test hook reducer-style behavior through exported pure helpers from the hook file.
- Create `features/editor/components/editor-find-bar.tsx`
  - Render compact top inline Find Bar controls.
  - Handle `Enter`, `Shift+Enter`, and `Escape` inside inputs.
- Create `features/editor/components/editor-find-bar.test.tsx`
  - Unit-test the rendered bar using React element inspection, following the style of existing component tests.
- Modify `features/editor/components/editor-pane.tsx`
  - Host `EditorFindBar` above `DOMD`.
  - Keep a local editor root ref for indexing.
  - Capture `Command+F` and `Command+R`.
  - Wire replace operations to DOM selection plus existing `insertText`.
- Modify `features/editor/components/editor-kernel-adapter.tsx`
  - Add a small exported `replaceSelectionText` wrapper only if the implementation needs a named adapter method; otherwise keep using existing `insertText`.
- Test through existing commands:
  - `npm test -- features/editor/lib/visible-text-search.test.ts`
  - `npm test -- features/editor/hooks/use-editor-find-replace.test.ts`
  - `npm test -- features/editor/components/editor-find-bar.test.tsx`
  - `npm run lint`
  - `npm run build`

---

### Task 1: Visible Text Search Library

**Files:**
- Create: `features/editor/lib/visible-text-search.ts`
- Test: `features/editor/lib/visible-text-search.test.ts`

- [ ] **Step 1: Write failing tests for visible text indexing and matching**

Create `features/editor/lib/visible-text-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    rangeForVisibleTextMatch,
} from "./visible-text-search";

describe("visible text search", () => {
    it("finds visible paragraph text case-insensitively by default", () => {
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Raw material lives here.");

        const index = buildVisibleTextIndex(root);
        const matches = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        expect(index.text).toBe("Raw material lives here.");
        expect(matches).toEqual([
            {
                end: 3,
                start: 0,
            },
        ]);
    });

    it("honors case-sensitive matching", () => {
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Raw raw RAW");
        const index = buildVisibleTextIndex(root);

        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: false }),
        ).toHaveLength(3);
        expect(
            findVisibleTextMatches(index, "raw", { caseSensitive: true }),
        ).toEqual([{ start: 4, end: 7 }]);
    });

    it("includes visible code block text", () => {
        const root = element("div", "DOMD-Root");
        const pre = child(root, "pre", "DOMD-Pre");
        child(pre, "code", "DOMD-PreCode", "const raw = true;");

        const index = buildVisibleTextIndex(root);
        const matches = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        expect(index.text).toContain("const raw = true;");
        expect(matches).toEqual([{ start: 6, end: 9 }]);
    });

    it("excludes hidden markdown syntax marker elements", () => {
        const root = element("div", "DOMD-Root");
        const paragraph = child(root, "p", "DOMD-P");
        child(paragraph, "span", "DOMD-MdSymbol", "![");
        child(paragraph, "span", "DOMD-Plain", "Visible alt");
        child(paragraph, "span", "DOMD-MdSymbol", "](assets/raw.png)");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible alt");
        expect(
            findVisibleTextMatches(index, "assets/raw.png", {
                caseSensitive: false,
            }),
        ).toEqual([]);
    });

    it("excludes link hrefs while keeping visible link labels", () => {
        const root = element("div", "DOMD-Root");
        const link = child(root, "a", "DOMD-Link");
        link.setAttribute("href", "https://example.com/raw-secret");
        child(link, "span", "DOMD-Plain", "Raw label");

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Raw label");
        expect(
            findVisibleTextMatches(index, "raw label", {
                caseSensitive: false,
            }),
        ).toHaveLength(1);
        expect(
            findVisibleTextMatches(index, "raw-secret", {
                caseSensitive: false,
            }),
        ).toEqual([]);
    });

    it("excludes display-none nodes", () => {
        const root = element("div", "DOMD-Root");
        child(root, "p", "DOMD-P", "Visible");
        const hidden = child(root, "span", "DOMD-Plain", "Hidden raw");
        hidden.style.display = "none";

        const index = buildVisibleTextIndex(root);

        expect(index.text).toBe("Visible");
        expect(
            findVisibleTextMatches(index, "hidden", { caseSensitive: false }),
        ).toEqual([]);
    });

    it("creates a DOM range for a single-node match", () => {
        const root = element("div", "DOMD-Root");
        const paragraph = child(root, "p", "DOMD-P", "Find raw here");
        const index = buildVisibleTextIndex(root);
        const [match] = findVisibleTextMatches(index, "raw", {
            caseSensitive: false,
        });

        const range = rangeForVisibleTextMatch(index, match);

        expect(range?.startContainer).toBe(paragraph.firstChild);
        expect(range?.startOffset).toBe(5);
        expect(range?.endContainer).toBe(paragraph.firstChild);
        expect(range?.endOffset).toBe(8);
    });
});

function element(tagName: string, className = "", text = ""): HTMLElement {
    const node = document.createElement(tagName);
    node.className = className;
    if (text) {
        node.textContent = text;
    }
    return node;
}

function child(
    parent: HTMLElement,
    tagName: string,
    className = "",
    text = "",
): HTMLElement {
    const node = element(tagName, className, text);
    parent.appendChild(node);
    return node;
}
```

- [ ] **Step 2: Run the visible text search tests to verify they fail**

Run:

```bash
npm test -- features/editor/lib/visible-text-search.test.ts
```

Expected: FAIL because `visible-text-search.ts` does not exist.

- [ ] **Step 3: Implement visible text indexing and matching**

Create `features/editor/lib/visible-text-search.ts`:

```ts
export interface VisibleTextSegment {
    end: number;
    node: Text;
    start: number;
}

export interface VisibleTextIndex {
    segments: VisibleTextSegment[];
    text: string;
}

export interface VisibleTextMatch {
    end: number;
    start: number;
}

export interface VisibleTextSearchOptions {
    caseSensitive: boolean;
}

const HIDDEN_TEXT_CLASSES = new Set([
    "DOMD-MdSymbol",
    "DOMD-MdHideSymbol",
    "DOMD-UlListSymbol",
    "DOMD-OlListSymbol",
    "DOMD-FunctionSymbolHide",
    "DOMD-FunctionTextHide",
]);

export function buildVisibleTextIndex(root: ParentNode): VisibleTextIndex {
    const segments: VisibleTextSegment[] = [];
    let text = "";

    const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const value = node.textContent ?? "";
            if (!value) {
                return;
            }

            const start = text.length;
            text += value;
            segments.push({
                end: text.length,
                node: node as Text,
                start,
            });
            return;
        }

        if (!(node instanceof Element) || shouldSkipElement(node)) {
            return;
        }

        for (const child of node.childNodes) {
            visit(child);
        }
    };

    for (const child of root.childNodes) {
        visit(child);
    }

    return { segments, text };
}

export function findVisibleTextMatches(
    index: VisibleTextIndex,
    query: string,
    options: VisibleTextSearchOptions,
): VisibleTextMatch[] {
    if (!query) {
        return [];
    }

    const haystack = options.caseSensitive
        ? index.text
        : index.text.toLocaleLowerCase();
    const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
    const matches: VisibleTextMatch[] = [];
    let cursor = 0;

    while (cursor <= haystack.length - needle.length) {
        const foundAt = haystack.indexOf(needle, cursor);
        if (foundAt === -1) {
            break;
        }

        matches.push({
            start: foundAt,
            end: foundAt + needle.length,
        });
        cursor = foundAt + Math.max(needle.length, 1);
    }

    return matches;
}

export function rangeForVisibleTextMatch(
    index: VisibleTextIndex,
    match: VisibleTextMatch,
): Range | null {
    const start = segmentAt(index.segments, match.start);
    const end = segmentAt(index.segments, Math.max(match.end - 1, match.start));
    if (!start || !end) {
        return null;
    }

    const range = document.createRange();
    range.setStart(start.node, match.start - start.start);
    range.setEnd(end.node, match.end - end.start);
    return range;
}

function segmentAt(
    segments: VisibleTextSegment[],
    offset: number,
): VisibleTextSegment | null {
    return (
        segments.find(
            (segment) => offset >= segment.start && offset < segment.end,
        ) ?? null
    );
}

function shouldSkipElement(element: Element): boolean {
    if (element instanceof HTMLElement) {
        const style = element.style;
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            element.hidden ||
            element.getAttribute("aria-hidden") === "true"
        ) {
            return true;
        }
    }

    if (element instanceof HTMLImageElement) {
        return true;
    }

    for (const className of HIDDEN_TEXT_CLASSES) {
        if (element.classList.contains(className)) {
            return true;
        }
    }

    return false;
}
```

- [ ] **Step 4: Run visible text search tests again**

Run:

```bash
npm test -- features/editor/lib/visible-text-search.test.ts
```

Expected: PASS with all visible text search tests passing.

- [ ] **Step 5: Commit Task 1**

```bash
git add features/editor/lib/visible-text-search.ts features/editor/lib/visible-text-search.test.ts
git commit -m "Add visible text search helpers"
```

---

### Task 2: Find/Replace State Hook

**Files:**
- Create: `features/editor/hooks/use-editor-find-replace.ts`
- Test: `features/editor/hooks/use-editor-find-replace.test.ts`

- [ ] **Step 1: Write failing tests for state transitions and replacement planning**

Create `features/editor/hooks/use-editor-find-replace.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
    applyFindBarShortcut,
    createInitialFindReplaceState,
    findBarCountLabel,
    nextMatchIndex,
    previousMatchIndex,
    replaceAllMatchesFromEnd,
} from "./use-editor-find-replace";
import type { VisibleTextMatch } from "../lib/visible-text-search";

describe("find replace state helpers", () => {
    it("opens find mode for Command+F", () => {
        const state = createInitialFindReplaceState();

        expect(applyFindBarShortcut(state, "find")).toEqual({
            caseSensitive: false,
            currentMatchIndex: 0,
            isOpen: true,
            isReplaceExpanded: false,
            query: "",
            replacement: "",
        });
    });

    it("opens expanded replace mode for Command+R", () => {
        const state = createInitialFindReplaceState();

        expect(applyFindBarShortcut(state, "replace")).toEqual({
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

    it("formats count labels", () => {
        expect(findBarCountLabel(0, 0)).toBe("0/0");
        expect(findBarCountLabel(0, 3)).toBe("1/3");
        expect(findBarCountLabel(2, 3)).toBe("3/3");
    });

    it("replaces all matches from end to start", () => {
        const calls: VisibleTextMatch[] = [];
        const matches: VisibleTextMatch[] = [
            { start: 0, end: 3 },
            { start: 8, end: 11 },
            { start: 14, end: 17 },
        ];

        replaceAllMatchesFromEnd(matches, (match) => {
            calls.push(match);
            return true;
        });

        expect(calls).toEqual([
            { start: 14, end: 17 },
            { start: 8, end: 11 },
            { start: 0, end: 3 },
        ]);
    });

    it("continues replace all when one match cannot be applied", () => {
        const apply = vi
            .fn<(match: VisibleTextMatch) => boolean>()
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

        const replaced = replaceAllMatchesFromEnd(
            [
                { start: 0, end: 3 },
                { start: 8, end: 11 },
                { start: 14, end: 17 },
            ],
            apply,
        );

        expect(replaced).toBe(2);
        expect(apply).toHaveBeenCalledTimes(3);
    });
});
```

- [ ] **Step 2: Run hook helper tests to verify they fail**

Run:

```bash
npm test -- features/editor/hooks/use-editor-find-replace.test.ts
```

Expected: FAIL because `use-editor-find-replace.ts` does not exist.

- [ ] **Step 3: Implement state helpers and hook skeleton**

Create `features/editor/hooks/use-editor-find-replace.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    buildVisibleTextIndex,
    findVisibleTextMatches,
    rangeForVisibleTextMatch,
} from "../lib/visible-text-search";
import type {
    VisibleTextIndex,
    VisibleTextMatch,
} from "../lib/visible-text-search";

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
    markdown: string;
    replaceSelectedText: (replacement: string) => void;
    focusEditor: () => void;
}

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
    mode: "find" | "replace",
): FindReplaceState {
    return {
        ...state,
        isOpen: true,
        isReplaceExpanded: mode === "replace" ? true : state.isReplaceExpanded,
    };
}

export function nextMatchIndex(current: number, total: number): number {
    if (total <= 0) {
        return 0;
    }
    return (current + 1) % total;
}

export function previousMatchIndex(current: number, total: number): number {
    if (total <= 0) {
        return 0;
    }
    return (current - 1 + total) % total;
}

export function findBarCountLabel(current: number, total: number): string {
    if (total <= 0) {
        return "0/0";
    }
    return `${Math.min(current + 1, total)}/${total}`;
}

export function replaceAllMatchesFromEnd(
    matches: VisibleTextMatch[],
    apply: (match: VisibleTextMatch) => boolean,
): number {
    let replaced = 0;

    for (const match of [...matches].reverse()) {
        if (apply(match)) {
            replaced += 1;
        }
    }

    return replaced;
}

export function useEditorFindReplace({
    editorRoot,
    focusEditor,
    markdown,
    replaceSelectedText,
}: UseEditorFindReplaceOptions) {
    const [state, setState] = useState(createInitialFindReplaceState);
    const indexRef = useRef<VisibleTextIndex>({ segments: [], text: "" });
    const matches = useMemo(() => {
        if (!editorRoot || !state.query) {
            return [];
        }

        const index = buildVisibleTextIndex(editorRoot);
        indexRef.current = index;
        return findVisibleTextMatches(index, state.query, {
            caseSensitive: state.caseSensitive,
        });
    }, [editorRoot, markdown, state.caseSensitive, state.query]);

    const activeMatch = matches[state.currentMatchIndex] ?? null;

    const selectMatch = useCallback((match: VisibleTextMatch | null) => {
        if (!match) {
            return false;
        }

        const range = rangeForVisibleTextMatch(indexRef.current, match);
        if (!range) {
            return false;
        }

        const selection = window.getSelection();
        if (!selection) {
            return false;
        }

        selection.removeAllRanges();
        selection.addRange(range);
        range.startContainer.parentElement?.scrollIntoView({
            block: "center",
            inline: "nearest",
        });
        return true;
    }, []);

    useEffect(() => {
        setState((current) =>
            current.currentMatchIndex >= matches.length
                ? { ...current, currentMatchIndex: 0 }
                : current,
        );
    }, [matches.length]);

    useEffect(() => {
        if (state.isOpen) {
            selectMatch(activeMatch);
        }
    }, [activeMatch, selectMatch, state.isOpen]);

    const openFind = useCallback(() => {
        setState((current) => applyFindBarShortcut(current, "find"));
    }, []);

    const openReplace = useCallback(() => {
        setState((current) => applyFindBarShortcut(current, "replace"));
    }, []);

    const close = useCallback(() => {
        setState((current) => ({ ...current, isOpen: false }));
        focusEditor();
    }, [focusEditor]);

    const setQuery = useCallback((query: string) => {
        setState((current) => ({ ...current, currentMatchIndex: 0, query }));
    }, []);

    const setReplacement = useCallback((replacement: string) => {
        setState((current) => ({ ...current, replacement }));
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

    const goNext = useCallback(() => {
        setState((current) => ({
            ...current,
            currentMatchIndex: nextMatchIndex(
                current.currentMatchIndex,
                matches.length,
            ),
        }));
    }, [matches.length]);

    const goPrevious = useCallback(() => {
        setState((current) => ({
            ...current,
            currentMatchIndex: previousMatchIndex(
                current.currentMatchIndex,
                matches.length,
            ),
        }));
    }, [matches.length]);

    const replaceCurrent = useCallback(() => {
        if (!selectMatch(activeMatch)) {
            return false;
        }

        replaceSelectedText(state.replacement);
        return true;
    }, [activeMatch, replaceSelectedText, selectMatch, state.replacement]);

    const replaceAll = useCallback(() => {
        return replaceAllMatchesFromEnd(matches, (match) => {
            if (!selectMatch(match)) {
                return false;
            }
            replaceSelectedText(state.replacement);
            return true;
        });
    }, [matches, replaceSelectedText, selectMatch, state.replacement]);

    return {
        activeMatch,
        countLabel: findBarCountLabel(state.currentMatchIndex, matches.length),
        matchCount: matches.length,
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
```

- [ ] **Step 4: Run hook helper tests again**

Run:

```bash
npm test -- features/editor/hooks/use-editor-find-replace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add features/editor/hooks/use-editor-find-replace.ts features/editor/hooks/use-editor-find-replace.test.ts
git commit -m "Add editor find replace state"
```

---

### Task 3: Find Bar Component

**Files:**
- Create: `features/editor/components/editor-find-bar.tsx`
- Test: `features/editor/components/editor-find-bar.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `features/editor/components/editor-find-bar.test.tsx`:

```tsx
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { EditorFindBar } from "./editor-find-bar";

describe("EditorFindBar", () => {
    it("renders find controls and count label", () => {
        const tree = renderBar({
            countLabel: "1/3",
            query: "raw",
        });
        const inputs = collectElements(tree, "input");
        const buttons = collectElements(tree, "button");

        expect(inputs[0]?.props.value).toBe("raw");
        expect(textContent(tree)).toContain("1/3");
        expect(buttons.map((button) => button.props["aria-label"])).toContain(
            "下一处",
        );
    });

    it("renders replace controls when expanded", () => {
        const tree = renderBar({
            isReplaceExpanded: true,
            replacement: "source",
        });
        const inputs = collectElements(tree, "input");

        expect(inputs[1]?.props.value).toBe("source");
        expect(textContent(tree)).toContain("替换全部");
    });

    it("submits next and previous from the find input", () => {
        const onNext = vi.fn();
        const onPrevious = vi.fn();
        const tree = renderBar({ onNext, onPrevious });
        const findInput = collectElements(tree, "input")[0];
        const onKeyDown = findInput?.props.onKeyDown as
            | ((event: KeyboardEventLike) => void)
            | undefined;

        onKeyDown?.(keyEvent("Enter"));
        onKeyDown?.(keyEvent("Enter", { shiftKey: true }));

        expect(onNext).toHaveBeenCalledTimes(1);
        expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it("closes on Escape", () => {
        const onClose = vi.fn();
        const tree = renderBar({ onClose });
        const findInput = collectElements(tree, "input")[0];
        const onKeyDown = findInput?.props.onKeyDown as
            | ((event: KeyboardEventLike) => void)
            | undefined;

        onKeyDown?.(keyEvent("Escape"));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

interface KeyboardEventLike {
    key: string;
    preventDefault: () => void;
    shiftKey: boolean;
}

function keyEvent(
    key: string,
    options: Partial<KeyboardEventLike> = {},
): KeyboardEventLike {
    return {
        key,
        preventDefault: vi.fn(),
        shiftKey: false,
        ...options,
    };
}

function renderBar(overrides: Partial<Parameters<typeof EditorFindBar>[0]> = {}) {
    return EditorFindBar({
        caseSensitive: false,
        countLabel: "0/0",
        isReplaceExpanded: false,
        matchCount: 0,
        onCaseSensitiveToggle: () => {},
        onClose: () => {},
        onNext: () => {},
        onPrevious: () => {},
        onQueryChange: () => {},
        onReplaceAll: () => {},
        onReplaceCurrent: () => {},
        onReplacementChange: () => {},
        onReplaceToggle: () => {},
        query: "",
        replacement: "",
        ...overrides,
    });
}

function collectElements(
    node: ReactElement | null,
    type: string,
): ReactElement<Record<string, unknown>>[] {
    if (!node || !isValidElement(node)) {
        return [];
    }

    const props = node.props as Record<string, unknown>;
    const children = props.children;
    const directChildren = Array.isArray(children) ? children : [children];
    const nested = directChildren.flatMap((child) =>
        isValidElement(child) ? collectElements(child, type) : [],
    );

    return [
        ...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []),
        ...nested,
    ];
}

function textContent(node: unknown): string {
    if (node === null || node === undefined || typeof node === "boolean") {
        return "";
    }
    if (typeof node === "string" || typeof node === "number") {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(textContent).join("");
    }
    if (isValidElement(node)) {
        return textContent((node.props as { children?: unknown }).children);
    }
    return "";
}
```

- [ ] **Step 2: Run component tests to verify they fail**

Run:

```bash
npm test -- features/editor/components/editor-find-bar.test.tsx
```

Expected: FAIL because `editor-find-bar.tsx` does not exist.

- [ ] **Step 3: Implement the Find Bar component**

Create `features/editor/components/editor-find-bar.tsx`:

```tsx
"use client";

export interface EditorFindBarProps {
    caseSensitive: boolean;
    countLabel: string;
    isReplaceExpanded: boolean;
    matchCount: number;
    query: string;
    replacement: string;
    onCaseSensitiveToggle: () => void;
    onClose: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onQueryChange: (query: string) => void;
    onReplaceAll: () => void;
    onReplaceCurrent: () => void;
    onReplacementChange: (replacement: string) => void;
    onReplaceToggle: () => void;
}

export function EditorFindBar({
    caseSensitive,
    countLabel,
    isReplaceExpanded,
    matchCount,
    onCaseSensitiveToggle,
    onClose,
    onNext,
    onPrevious,
    onQueryChange,
    onReplaceAll,
    onReplaceCurrent,
    onReplacementChange,
    onReplaceToggle,
    query,
    replacement,
}: EditorFindBarProps) {
    const canReplace = query.length > 0 && matchCount > 0;
    const handleFindKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
                onPrevious();
            } else {
                onNext();
            }
        }

        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        }
    };
    const handleReplaceKeyDown = (
        event: React.KeyboardEvent<HTMLInputElement>,
    ) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onReplaceCurrent();
        }

        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        }
    };

    return (
        <div className="border-b border-base-300 bg-base-100 px-2 py-2">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
                    <span
                        aria-hidden="true"
                        className="shrink-0 text-sm text-base-content/55"
                    >
                        /
                    </span>
                    <input
                        aria-label="查找"
                        className="input input-sm input-bordered min-w-36 flex-1 text-sm"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        onKeyDown={handleFindKeyDown}
                    />
                    <span className="min-w-10 text-right text-xs tabular-nums text-base-content/60">
                        {countLabel}
                    </span>
                </div>
                <button
                    aria-label="上一处"
                    className="btn btn-ghost btn-sm btn-square"
                    disabled={matchCount === 0}
                    type="button"
                    onClick={onPrevious}
                >
                    <span aria-hidden="true">↑</span>
                </button>
                <button
                    aria-label="下一处"
                    className="btn btn-ghost btn-sm btn-square"
                    disabled={matchCount === 0}
                    type="button"
                    onClick={onNext}
                >
                    <span aria-hidden="true">↓</span>
                </button>
                <button
                    aria-label="大小写敏感"
                    aria-pressed={caseSensitive}
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={onCaseSensitiveToggle}
                >
                    Aa
                </button>
                <button
                    aria-label="替换"
                    aria-pressed={isReplaceExpanded}
                    className="btn btn-ghost btn-sm btn-square"
                    type="button"
                    onClick={onReplaceToggle}
                >
                    <span aria-hidden="true">⇄</span>
                </button>
                <button
                    aria-label="关闭查找"
                    className="btn btn-ghost btn-sm btn-square"
                    type="button"
                    onClick={onClose}
                >
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            {isReplaceExpanded ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-0 sm:pl-6">
                    <input
                        aria-label="替换为"
                        className="input input-sm input-bordered min-w-36 flex-1 text-sm sm:max-w-md"
                        value={replacement}
                        onChange={(event) =>
                            onReplacementChange(event.target.value)
                        }
                        onKeyDown={handleReplaceKeyDown}
                    />
                    <button
                        className="btn btn-sm"
                        disabled={!canReplace}
                        type="button"
                        onClick={onReplaceCurrent}
                    >
                        替换
                    </button>
                    <button
                        className="btn btn-sm"
                        disabled={!canReplace}
                        type="button"
                        onClick={onReplaceAll}
                    >
                        替换全部
                    </button>
                </div>
            ) : null}
        </div>
    );
}
```

- [ ] **Step 4: Run component tests again**

Run:

```bash
npm test -- features/editor/components/editor-find-bar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add features/editor/components/editor-find-bar.tsx features/editor/components/editor-find-bar.test.tsx
git commit -m "Add editor find bar"
```

---

### Task 4: EditorPane Integration

**Files:**
- Modify: `features/editor/components/editor-pane.tsx`
- Test: `features/editor/components/editor-pane.test.tsx`

- [ ] **Step 1: Write failing integration tests for shortcuts**

Create `features/editor/components/editor-pane.test.tsx`:

```tsx
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { isEditorFindShortcut, isEditorReplaceShortcut } from "./editor-pane";

describe("editor find/replace shortcuts", () => {
    it("recognizes Command+F and Ctrl+F without alt", () => {
        expect(
            isEditorFindShortcut({
                altKey: false,
                code: "KeyF",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(true);
        expect(
            isEditorFindShortcut({
                altKey: false,
                code: "KeyF",
                ctrlKey: true,
                metaKey: false,
            }),
        ).toBe(true);
        expect(
            isEditorFindShortcut({
                altKey: true,
                code: "KeyF",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(false);
    });

    it("recognizes Command+R and Ctrl+R without alt", () => {
        expect(
            isEditorReplaceShortcut({
                altKey: false,
                code: "KeyR",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(true);
        expect(
            isEditorReplaceShortcut({
                altKey: false,
                code: "KeyR",
                ctrlKey: true,
                metaKey: false,
            }),
        ).toBe(true);
        expect(
            isEditorReplaceShortcut({
                altKey: true,
                code: "KeyR",
                ctrlKey: false,
                metaKey: true,
            }),
        ).toBe(false);
    });
});
```

- [ ] **Step 2: Run editor pane tests to verify they fail**

Run:

```bash
npm test -- features/editor/components/editor-pane.test.tsx
```

Expected: FAIL because `isEditorFindShortcut` and `isEditorReplaceShortcut` are not exported.

- [ ] **Step 3: Integrate Find Bar into EditorPane**

Modify `features/editor/components/editor-pane.tsx`:

1. Add imports:

```tsx
import { useRef, useState } from "react";
import { EditorFindBar } from "./editor-find-bar";
import { useEditorFindReplace } from "../hooks/use-editor-find-replace";
```

If `useRef` and `useState` are added to an existing React import, keep one import statement.

2. Export shortcut helpers near other local helpers:

```tsx
export interface EditorShortcutLike {
    altKey: boolean;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
}

export function isEditorFindShortcut(event: EditorShortcutLike): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.code === "KeyF"
    );
}

export function isEditorReplaceShortcut(event: EditorShortcutLike): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.code === "KeyR"
    );
}
```

3. In `EditorPaneInner`, add local refs/state after `bridge`:

```tsx
const localEditorViewportRef = useRef<HTMLDivElement | null>(null);
const [editorRoot, setEditorRoot] = useState<HTMLElement | null>(null);
const assignEditorViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
        localEditorViewportRef.current = node;
        if (editorViewportRef && "current" in editorViewportRef) {
            editorViewportRef.current = node;
        }
        setEditorRoot(node?.querySelector(".DOMD-Root") ?? null);
    },
    [editorViewportRef],
);
const findReplace = useEditorFindReplace({
    editorRoot,
    focusEditor: focus,
    markdown: bridge.currentMarkdown,
    replaceSelectedText: insertText,
});
```

4. Update `handleEditorKeyDownCapture` to handle find/replace before select-all:

```tsx
const handleEditorKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isEditorFindShortcut(event.nativeEvent)) {
            event.preventDefault();
            event.stopPropagation();
            findReplace.actions.openFind();
            return;
        }

        if (isEditorReplaceShortcut(event.nativeEvent)) {
            event.preventDefault();
            event.stopPropagation();
            findReplace.actions.openReplace();
            return;
        }

        if (!isSelectAllShortcut(event.nativeEvent)) {
            return;
        }

        const selectTarget = resolveScopedSelectAllTarget(
            event.target instanceof HTMLElement ? event.target : null,
            event.currentTarget,
            elementFromNode(window.getSelection()?.anchorNode ?? null),
        );
        if (!selectTarget) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        selectElementContents(selectTarget as HTMLElement);
    },
    [findReplace.actions],
);
```

If React dependency stability makes `findReplace.actions` unsuitable, destructure `openFind` and `openReplace` and include only those functions plus existing dependencies.

5. Render Find Bar above the viewport:

```tsx
return (
    <div className="flex h-full min-h-0 flex-col">
        {findReplace.state.isOpen ? (
            <EditorFindBar
                caseSensitive={findReplace.state.caseSensitive}
                countLabel={findReplace.countLabel}
                isReplaceExpanded={findReplace.state.isReplaceExpanded}
                matchCount={findReplace.matchCount}
                query={findReplace.state.query}
                replacement={findReplace.state.replacement}
                onCaseSensitiveToggle={
                    findReplace.actions.toggleCaseSensitive
                }
                onClose={findReplace.actions.close}
                onNext={findReplace.actions.goNext}
                onPrevious={findReplace.actions.goPrevious}
                onQueryChange={findReplace.actions.setQuery}
                onReplaceAll={findReplace.actions.replaceAll}
                onReplaceCurrent={findReplace.actions.replaceCurrent}
                onReplacementChange={findReplace.actions.setReplacement}
                onReplaceToggle={findReplace.actions.toggleReplaceExpanded}
            />
        ) : null}
        <div
            ref={assignEditorViewportRef}
            className="min-h-0 flex-1 overflow-auto bg-base-100"
        >
            ...
        </div>
    </div>
);
```

Keep all existing paste, drop, wikilink, CLI insert, and selection sync behavior.

- [ ] **Step 4: Run editor pane shortcut tests**

Run:

```bash
npm test -- features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run focused editor tests**

Run:

```bash
npm test -- features/editor/lib/visible-text-search.test.ts features/editor/hooks/use-editor-find-replace.test.ts features/editor/components/editor-find-bar.test.tsx features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add features/editor/components/editor-pane.tsx features/editor/components/editor-pane.test.tsx
git commit -m "Wire find replace into editor pane"
```

---

### Task 5: Final Verification And Documentation Notes

**Files:**
- Modify only if needed: `README.md`, `README.zh-CN.md`

- [ ] **Step 1: Run all focused editor tests**

Run:

```bash
npm test -- features/editor/lib/visible-text-search.test.ts features/editor/hooks/use-editor-find-replace.test.ts features/editor/components/editor-find-bar.test.tsx features/editor/components/editor-pane.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS and output includes `Compiled successfully` and `Running TypeScript`.

- [ ] **Step 5: Run Rust tests to guard unchanged Tauri integration**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Verify diff scope**

Run:

```bash
git diff --stat HEAD
```

Expected: only these implementation files should appear:

```text
features/editor/components/editor-find-bar.tsx
features/editor/components/editor-find-bar.test.tsx
features/editor/components/editor-pane.tsx
features/editor/components/editor-pane.test.tsx
features/editor/hooks/use-editor-find-replace.ts
features/editor/hooks/use-editor-find-replace.test.ts
features/editor/lib/visible-text-search.ts
features/editor/lib/visible-text-search.test.ts
```

- [ ] **Step 7: Commit final cleanup if needed**

If formatting or documentation notes changed files after earlier commits, commit them:

```bash
git add features/editor README.md README.zh-CN.md
git commit -m "Polish editor find replace"
```

If there are no changes, skip this commit.

---

## Self-Review Checklist

- Spec coverage:
  - `Command+F` and `Command+R` are covered by Task 4 shortcut integration.
  - Top inline Find Bar is covered by Tasks 3 and 4.
  - Current-document only is covered by `EditorPane`-local integration.
  - Visible text only is covered by Task 1 DOM indexing tests.
  - Code blocks are included by Task 1 tests.
  - Markdown hidden symbols, link hrefs, and image paths are excluded by Task 1 tests.
  - Plain-text matching and case toggle are covered by Tasks 1, 2, and 3.
  - Replace current and replace all are covered by Tasks 2, 3, and 4.
  - Workspace Mode and Document Mode share `EditorPane`; manual verification in Task 5 covers both.
  - Non-editor previews do not render `EditorPane`, so Find Bar is unavailable there.
- Placeholder scan:
  - No `TBD`, `TODO`, "implement later", or "add appropriate tests" placeholders remain.
- Type consistency:
  - `VisibleTextMatch`, `VisibleTextIndex`, and `FindReplaceState` names are consistent across tests, hook, and component.
  - `EditorFindBarProps` names match the props used in `EditorPane`.
  - Shortcut helper interfaces use only keyboard fields present on native keyboard events.
- Risk notes:
  - The Find Bar intentionally uses text/symbol controls and does not add an icon package.
  - If DOM selection plus `insertText` cannot reliably replace selected text, stop and report the blocker instead of falling back to Markdown source replacement.
