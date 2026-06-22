import type { MarkdownOutlineHeading } from "./types";

const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";
const SCROLL_OPTIONS: ScrollIntoViewOptions = {
    behavior: "instant",
    block: "start",
    inline: "nearest",
};

export function findRenderedHeadingByIndex(
    root: ParentNode | null,
    headingIndex: number,
): HTMLElement | null {
    if (!root || !Number.isInteger(headingIndex) || headingIndex < 0) {
        return null;
    }

    return (
        Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR))[
            headingIndex
        ] ?? null
    );
}

export function scrollRenderedHeadingIntoView(
    root: ParentNode | null,
    heading: MarkdownOutlineHeading | number,
    headings: MarkdownOutlineHeading[] = [],
) {
    const renderedHeading =
        typeof heading === "number"
            ? findRenderedHeadingByIndex(root, heading)
            : findRenderedHeading(root, heading, headings);

    if (!renderedHeading) {
        return false;
    }

    renderedHeading.scrollIntoView(SCROLL_OPTIONS);
    return true;
}

function findRenderedHeading(
    root: ParentNode | null,
    heading: MarkdownOutlineHeading,
    headings: MarkdownOutlineHeading[],
) {
    if (!root) {
        return null;
    }

    const expectedTag = `H${heading.level}`;
    const duplicateIndex = headings
        .slice(0, Math.max(0, headings.indexOf(heading)))
        .filter(
            (candidate) =>
                candidate.level === heading.level && candidate.text === heading.text,
        ).length;
    let seen = 0;

    for (const element of Array.from(
        root.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
    )) {
        if (
            element.tagName !== expectedTag ||
            normalizedText(element.textContent) !== heading.text
        ) {
            continue;
        }

        if (seen === duplicateIndex) {
            return element;
        }

        seen += 1;
    }

    return null;
}

function normalizedText(text: string | null) {
    return (text ?? "").replace(/\s+/g, " ").trim();
}
