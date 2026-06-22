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
    headingIndex: number,
) {
    const heading = findRenderedHeadingByIndex(root, headingIndex);

    if (!heading) {
        return false;
    }

    heading.scrollIntoView(SCROLL_OPTIONS);
    return true;
}
