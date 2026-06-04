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

    for (const className of HIDDEN_TEXT_CLASSES) {
        if (element.classList.contains(className)) {
            return true;
        }
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
