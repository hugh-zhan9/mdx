import {
    isMdxSyntaxElement,
    MDX_MERMAID_PREVIEW_SELECTOR,
} from "./editor-dom-contract";

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

export function buildVisibleTextIndex(root: ParentNode): VisibleTextIndex {
    const segments: VisibleTextSegment[] = [];
    let text = "";

    if (isElement(root) && shouldSkipElement(root)) {
        return { segments, text };
    }

    const visit = (node: Node) => {
        if (node.nodeType === 3) {
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

        if (!isElement(node) || shouldSkipElement(node)) {
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

    const matches: VisibleTextMatch[] = [];
    let cursor = 0;

    while (cursor <= index.text.length - query.length) {
        const foundAt = findMatchAtOrAfter(
            index.text,
            query,
            cursor,
            options.caseSensitive,
        );
        if (foundAt === -1) {
            break;
        }

        matches.push({
            start: foundAt,
            end: foundAt + query.length,
        });
        cursor = foundAt + Math.max(query.length, 1);
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

    if (
        typeof document === "undefined" ||
        typeof document.createRange !== "function"
    ) {
        return null;
    }

    const range = document.createRange();
    range.setStart(start.node, match.start - start.start);
    range.setEnd(end.node, match.end - end.start);
    return range;
}

function findMatchAtOrAfter(
    text: string,
    query: string,
    startOffset: number,
    caseSensitive: boolean,
): number {
    for (
        let candidate = startOffset;
        candidate <= text.length - query.length;
        candidate += 1
    ) {
        if (matchesAt(text, query, candidate, caseSensitive)) {
            return candidate;
        }
    }

    return -1;
}

function matchesAt(
    text: string,
    query: string,
    startOffset: number,
    caseSensitive: boolean,
): boolean {
    for (let queryOffset = 0; queryOffset < query.length; queryOffset += 1) {
        const textUnit = text[startOffset + queryOffset];
        const queryUnit = query[queryOffset];

        if (caseSensitive) {
            if (textUnit !== queryUnit) {
                return false;
            }
            continue;
        }

        if (lowerSingleCodeUnit(textUnit) !== lowerSingleCodeUnit(queryUnit)) {
            return false;
        }
    }

    return true;
}

function lowerSingleCodeUnit(value: string): string {
    const lower = value.toLowerCase();
    return lower.length === 1 ? lower : value;
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
    if (element.getAttribute("data-layout-light-mirror") !== null) {
        return false;
    }

    if (isHtmlElement(element)) {
        const style = element.style;
        const computedStyle = getComputedStyleForElement(element);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            computedStyle?.display === "none" ||
            computedStyle?.visibility === "hidden" ||
            element.hidden ||
            element.getAttribute("aria-hidden") === "true"
        ) {
            return true;
        }
    }

    if (isImageElement(element)) {
        return true;
    }

    if (
        element.matches(MDX_MERMAID_PREVIEW_SELECTOR) ||
        Boolean(element.closest(MDX_MERMAID_PREVIEW_SELECTOR))
    ) {
        return true;
    }

    if (isMdxSyntaxElement(element)) {
        return true;
    }

    return false;
}

function isElement(node: ParentNode | Node): node is Element {
    return typeof Element !== "undefined" && node instanceof Element;
}

function isHtmlElement(element: Element): element is HTMLElement {
    return (
        typeof HTMLElement !== "undefined" && element instanceof HTMLElement
    );
}

function isImageElement(element: Element): element is HTMLImageElement {
    return (
        typeof HTMLImageElement !== "undefined" &&
        element instanceof HTMLImageElement
    );
}

function getComputedStyleForElement(element: Element): CSSStyleDeclaration | null {
    if (
        typeof window === "undefined" ||
        typeof window.getComputedStyle !== "function"
    ) {
        return null;
    }

    return window.getComputedStyle(element);
}
