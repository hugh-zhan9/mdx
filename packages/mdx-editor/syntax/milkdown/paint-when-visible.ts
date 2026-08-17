/**
 * Defers a node view's expensive painting until it is on screen.
 *
 * Opening a document mounts a node view for every node in it, and some of them
 * paint by running a real typesetting or diagramming engine. Measured on this
 * repo's own fixtures, KaTeX accounts for roughly five sixths of the time it
 * takes to open a maths-heavy file — all of it spent on formulae the reader
 * cannot see, most of which they will never scroll to.
 *
 * What the reader can see still paints immediately: the observer reports
 * already-visible elements on its first callback, which runs before paint.
 *
 * Where there is no `IntersectionObserver` — jsdom, or a server render — the
 * work happens at once. That is the honest fallback: an environment that cannot
 * report visibility cannot defer safely, because nothing would ever arrive to
 * trigger the paint, and a formula that never renders is worse than a slow one.
 */
export function paintWhenVisible(
    element: HTMLElement,
    paint: () => void,
): () => void {
    const observe = globalThis.IntersectionObserver;
    if (typeof observe !== "function") {
        paint();
        return () => {};
    }

    let painted = false;
    const observer = new observe(
        (entries) => {
            if (painted) return;
            if (!entries.some((entry) => entry.isIntersecting)) return;
            painted = true;
            observer.disconnect();
            paint();
        },
        {
            // Paint a screen ahead of the scroll, so content is ready by the
            // time it is looked at rather than appearing after it arrives.
            rootMargin: "100% 0px",
        },
    );
    observer.observe(element);

    return () => {
        observer.disconnect();
    };
}
