/**
 * Where a revealed range should come to rest.
 *
 * A fraction of the viewport height, measured from its top. Landing the target
 * a little below the top edge leaves the lines above it visible, which is what
 * makes a jump read as "here is that heading, in its context" rather than "the
 * document moved".
 */
const REVEAL_OFFSET_FRACTION = 0.25;

/**
 * The nearest ancestor that actually scrolls, or null if nothing does.
 *
 * Asked of the editor's own DOM rather than assumed, because the element that
 * scrolls is decided by the stylesheet: the editor root carries `overflow-y`
 * today, and a layout change could move it without this file being touched.
 */
export function findScrollableAncestor(
    element: HTMLElement | null,
): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current) {
        const style = current.ownerDocument.defaultView?.getComputedStyle(
            current,
        );
        const overflowY = style?.overflowY;
        const scrolls = overflowY === "auto" || overflowY === "scroll";
        if (scrolls && current.scrollHeight > current.clientHeight) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

/**
 * Scrolls so that `targetTop` sits a comfortable way down the viewport.
 *
 * `targetTop` is a viewport coordinate, as `getBoundingClientRect` and
 * ProseMirror's `coordsAtPos` both report. Called after the selection has
 * already been placed, so it moves the view and nothing else.
 *
 * This is deliberately not `scrollIntoView`: that scrolls the minimum distance
 * needed to make something visible, so a target below the fold stops at the
 * very bottom edge of the window. For a jump the user asked for — an outline
 * heading, a CLI focus — arriving at the bottom edge looks like the jump
 * missed.
 */
export function scrollTargetIntoComfortableView(
    scroller: HTMLElement | null,
    targetTop: number,
): void {
    if (!scroller) return;
    const viewport = scroller.getBoundingClientRect();
    // No layout to work from — a zero-height box, as in a test environment —
    // means there is no meaningful place to scroll to.
    if (scroller.clientHeight === 0) return;
    const desiredTop =
        viewport.top + scroller.clientHeight * REVEAL_OFFSET_FRACTION;
    const delta = targetTop - desiredTop;
    if (delta === 0) return;
    scroller.scrollTop += delta;
}
