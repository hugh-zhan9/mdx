import type { MarkdownSelectionOffsets } from "../../../packages/mdx-editor";
import {
    isMdxSyntaxElement,
    MDX_MERMAID_PREVIEW_SELECTOR,
} from "./editor-dom-contract";

export interface VisibleTextSegment {
    end: number;
    sourceTextLength: number | null;
    selectionOffsets: MarkdownSelectionOffsets | null;
    isMirror: boolean;
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
    const ordinaryIndex = buildVisibleTextIndexInternal(root, {
        ordinaryTextByBlockId: new Map(),
        skipMirrorSubtrees: true,
    });

    if (ordinaryIndex.text.length === 0) {
        return buildVisibleTextIndexInternal(root, {
            ordinaryTextByBlockId: new Map(),
            skipMirrorSubtrees: false,
        });
    }

    return buildVisibleTextIndexInternal(root, {
        ordinaryTextByBlockId: buildOrdinaryTextByBlockId(ordinaryIndex.segments),
        skipMirrorSubtrees: false,
    });
}

interface VisibleTextBuildOptions {
    ordinaryTextByBlockId: Map<string, string>;
    skipMirrorSubtrees: boolean;
}

function buildVisibleTextIndexInternal(
    root: ParentNode,
    options: VisibleTextBuildOptions,
): VisibleTextIndex {
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
                sourceTextLength: sourceTextLengthForTextNode(node as Text),
                selectionOffsets: selectionOffsetsForTextNode(node as Text),
                isMirror: isMirrorTextNode(node),
                node: node as Text,
                start,
            });
            return;
        }

        if (!isElement(node) || shouldSkipElement(node)) {
            return;
        }

        const element = node;

        if (isMirrorContainer(element)) {
            if (options.skipMirrorSubtrees) {
                return;
            }

            for (const child of element.childNodes) {
                if (
                    shouldIncludeMirrorNode(
                        child,
                        options.ordinaryTextByBlockId,
                    )
                ) {
                    visit(child);
                }
            }
            return;
        }

        for (const child of element.childNodes) {
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

export function selectionOffsetsForVisibleTextMatch(
    index: VisibleTextIndex,
    match: VisibleTextMatch,
): MarkdownSelectionOffsets | null {
    const start = segmentAt(index.segments, match.start);
    const end = segmentAt(index.segments, Math.max(match.end - 1, match.start));
    if (!start || !end) {
        return null;
    }

    const startOffsets = start.selectionOffsets;
    const endOffsets = end.selectionOffsets;
    if (!startOffsets || !endOffsets) {
        return null;
    }

    if (!isReplaceSafeMatch(index, match)) {
        return null;
    }

    return {
        anchor: startOffsets.anchor + (match.start - start.start),
        head: endOffsets.anchor + (match.end - end.start),
    };
}

export function isReplaceSafeMatch(
    index: VisibleTextIndex,
    match: VisibleTextMatch,
): boolean {
    const start = segmentAt(index.segments, match.start);
    const end = segmentAt(index.segments, Math.max(match.end - 1, match.start));
    if (!start || !end) {
        return false;
    }

    if (!start.isMirror && !end.isMirror) {
        return true;
    }

    if (start !== end) {
        return false;
    }

    if (!start.isMirror || start.sourceTextLength === null) {
        return false;
    }

    return match.end - match.start === start.sourceTextLength;
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
    if (isMirrorContainer(element)) {
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

function shouldIncludeMirrorNode(
    node: Node,
    ordinaryTextByBlockId: Map<string, string>,
): boolean {
    const value = node.textContent ?? "";
    if (!value) {
        return false;
    }

    const blockId = mirrorBlockIdForNode(node);
    if (!blockId) {
        return true;
    }

    const ordinaryText = ordinaryTextByBlockId.get(blockId);
    if (!ordinaryText) {
        return true;
    }

    return !ordinaryText.includes(value);
}

function buildOrdinaryTextByBlockId(
    segments: VisibleTextSegment[],
): Map<string, string> {
    const ordinaryTextByBlockId = new Map<string, string>();

    for (const segment of segments) {
        if (segment.isMirror) {
            continue;
        }

        const blockId = blockIdForTextNode(segment.node);
        if (!blockId) {
            continue;
        }

        const value = segment.node.textContent ?? "";
        if (!value) {
            continue;
        }

        ordinaryTextByBlockId.set(
            blockId,
            `${ordinaryTextByBlockId.get(blockId) ?? ""}${value}`,
        );
    }

    return ordinaryTextByBlockId;
}

function isElement(node: ParentNode | Node): node is Element {
    return typeof Element !== "undefined" && node instanceof Element;
}

function isMirrorContainer(node: Node): boolean {
    return (
        isElement(node) &&
        node.getAttribute("data-layout-light-mirror") !== null
    );
}

function isMirrorTextNode(node: Node): boolean {
    const parent = node.parentNode;
    return (
        node.nodeType === 3 &&
        parent !== null &&
        isElement(parent) &&
        parent.closest("[data-layout-light-mirror]") !== null
    );
}

function mirrorBlockIdForNode(node: Node): string | null {
    if (isElement(node)) {
        return node.getAttribute("data-mirror-block-id");
    }

    const parent = node.parentNode;
    if (parent === null || !isElement(parent)) {
        return null;
    }

    return parent.getAttribute("data-mirror-block-id");
}

function blockIdForTextNode(node: Text): string | null {
    const parent = node.parentNode;
    if (parent === null || !isElement(parent)) {
        return null;
    }

    return (
        parent.getAttribute("data-layout-block-id") ??
        parent.closest("[data-layout-block-id]")?.getAttribute(
            "data-layout-block-id",
        ) ??
        null
    );
}

function selectionOffsetsForTextNode(
    node: Text,
): MarkdownSelectionOffsets | null {
    const parent = node.parentNode;
    if (parent === null || !isElement(parent)) {
        return null;
    }

    const host =
        closestWithAttributes(parent, "data-layout-pm-from", "data-layout-pm-to") ??
        closestWithAttributes(parent, "data-mirror-pm-from", "data-mirror-pm-to");
    if (!host) {
        return null;
    }

    const startAttribute =
        host.getAttribute("data-layout-pm-from") ??
        host.getAttribute("data-mirror-pm-from");
    const endAttribute =
        host.getAttribute("data-layout-pm-to") ??
        host.getAttribute("data-mirror-pm-to");
    if (!startAttribute || !endAttribute) {
        return null;
    }

    const anchor = Number.parseInt(startAttribute, 10);
    const head = Number.parseInt(endAttribute, 10);
    if (!Number.isFinite(anchor) || !Number.isFinite(head) || head < anchor) {
        return null;
    }

    return { anchor, head };
}

function sourceTextLengthForTextNode(node: Text): number | null {
    const offsets = selectionOffsetsForTextNode(node);
    if (!offsets) {
        return null;
    }

    return Math.max(0, offsets.head - offsets.anchor);
}

function closestWithAttributes(
    element: Element,
    startAttribute: string,
    endAttribute: string,
): Element | null {
    let current: Element | null = element;

    while (current) {
        if (
            current.getAttribute(startAttribute) !== null &&
            current.getAttribute(endAttribute) !== null
        ) {
            return current;
        }

        current = current.parentElement;
    }

    return null;
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
