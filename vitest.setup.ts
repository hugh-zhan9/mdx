import { afterAll } from "vitest";

/**
 * Gives jsdom the range measurement both editors call before scrolling.
 *
 * Asking either surface to reveal a range — an outline heading, a CLI focus,
 * a caret restored with its tab — makes it scroll, and scrolling means asking
 * where the range currently is. jsdom implements no layout and does not
 * implement `Range.getClientRects` at all, so that question throws:
 * CodeMirror's measure pass reports `getClientRects is not a function` as an
 * unhandled error, and ProseMirror's throws inside `dispatch`, where the
 * surface catches it and reports the selection as having failed — a real
 * command turned into a spurious `invalid_range`.
 *
 * Empty rects are the honest answer here rather than a convenient one: in a
 * document with no layout, nothing has a position. Both editors already handle
 * that, by declining to scroll. What they cannot handle is the question being
 * unanswerable, which is what this fixes — and only in tests, because a browser
 * has always answered it.
 */
function installRangeMeasurementPolyfill(): void {
    if (typeof Range === "undefined") return;

    const emptyRect = () =>
        ({
            bottom: 0,
            height: 0,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect;

    if (typeof Range.prototype.getClientRects !== "function") {
        Range.prototype.getClientRects = function getClientRects() {
            const rects: DOMRect[] = [];
            return Object.assign(rects, {
                item: (index: number) => rects[index] ?? null,
            }) as unknown as DOMRectList;
        };
    }

    if (typeof Range.prototype.getBoundingClientRect !== "function") {
        Range.prototype.getBoundingClientRect = emptyRect;
    }
}

installRangeMeasurementPolyfill();

/**
 * Gives jsdom the size observer the relation graph builds on mount.
 *
 * The graph lays itself out in the pixels its element actually has, which means
 * constructing a `ResizeObserver` — a class jsdom does not implement at all, so the
 * constructor throws and the whole panel fails to mount. Reporting nothing is the
 * honest answer in an environment with no layout: the graph keeps its pre-measured
 * default size, which is exactly what it draws before the first observation in a
 * browser too. What it cannot survive is the class being absent.
 */
function installResizeObserverPolyfill(): void {
    if (typeof globalThis.ResizeObserver === "function") return;

    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

installResizeObserverPolyfill();

/**
 * Answers the question ProseMirror asks when it is clicked.
 *
 * A mousedown makes it ask what is at those coordinates, which is
 * `document.elementFromPoint` — a method jsdom does not implement at all. Its own
 * feature check only guards the shadow-root case (`view.root.elementFromPoint ?
 * view.root : doc`) and then calls the method on the document regardless, so the
 * call throws:
 *
 *     elementFromPoint is not a function
 *
 * Thrown inside a native event dispatch, it lands outside every `try` in the test
 * and is reported as an unhandled error. Locally that only printed a warning;
 * `vitest run` in CI exits non-zero on it, which is what turned a green suite into
 * a red release job.
 *
 * Null is the honest answer, and one ProseMirror already handles: it falls back to
 * the editor's own bounding box, finds that the coordinates are not inside it, and
 * reports no position — which is exactly right in a document that has no layout.
 */
function installElementFromPointPolyfill(): void {
    if (typeof Document === "undefined") return;

    if (typeof Document.prototype.elementFromPoint !== "function") {
        Document.prototype.elementFromPoint = function elementFromPoint() {
            return null;
        };
    }

    if (typeof Document.prototype.elementsFromPoint !== "function") {
        Document.prototype.elementsFromPoint = function elementsFromPoint() {
            return [];
        };
    }
}

installElementFromPointPolyfill();

/**
 * Lets Milkdown's readiness timers finish in the environment that started them.
 *
 * `@milkdown/ctx`'s `Timer.start()` schedules a rejection three seconds out and
 * discards the `setTimeout` handle. Nothing can cancel it: `Clock.remove()`
 * deletes a map entry, `Editor.destroy()` never touches the clock, and no
 * public API is handed the timer. So every editor a test builds leaves ten
 * callbacks that fire three seconds later, each calling the bare global
 * `removeEventListener`.
 *
 * A test file whose environment is torn down inside those three seconds leaves
 * them to run with no globals at all, and the run reports `ReferenceError:
 * removeEventListener is not defined` as an unhandled error — attributed to
 * whichever file happens to be running, with the warning that it "might cause
 * false positive tests". The callbacks are inert (see
 * `packages/mdx-editor/test/milkdown-timer-leak.test.ts`, which pins exactly
 * what they can and cannot do), but the noise is not: it is the channel a real
 * post-teardown error would arrive on, and sixteen standing entries in it are
 * sixteen places to lose one.
 *
 * So the environment is held open instead of the error being suppressed. The
 * timers run, in the environment they were started in, and anything they really
 * did would still be reported. A file that started no timer waits not at all,
 * and a file whose last editor is already older than the timeout waits not at
 * all either, so the whole suite pays this once or twice rather than per file.
 */

/** `createTimer`'s default timeout in `@milkdown/ctx`. */
const TIMER_TIMEOUT_MS = 3000;

/** Slack for the gap between `start()` and the listener registration below. */
const SETTLE_MARGIN_MS = 250;

/** The readiness timers `Editor.create()` waits on, by event name. */
const READINESS_TIMERS = new Set([
    "CommandsReady",
    "ConfigReady",
    "EditorStateReady",
    "EditorViewReady",
    "InitReady",
    "KeymapReady",
    "ParserReady",
    "PasteRuleReady",
    "SchemaReady",
    "SerializerReady",
]);

/** When a readiness timer last started, or 0 if none has in this file. */
let lastStarted = 0;

// Only jsdom files have these globals, and only they can build a Milkdown
// editor at all — the timer's own `addEventListener` call would already have
// thrown otherwise.
const register = globalThis.addEventListener;
if (typeof register === "function") {
    globalThis.addEventListener = function trackReadinessTimers(
        this: unknown,
        type: string,
        listener: never,
        options: never,
    ) {
        if (READINESS_TIMERS.has(type)) lastStarted = Date.now();
        return register.call(globalThis, type, listener, options);
    } as typeof globalThis.addEventListener;
}

afterAll(async () => {
    if (lastStarted === 0) return;
    const remaining =
        TIMER_TIMEOUT_MS + SETTLE_MARGIN_MS - (Date.now() - lastStarted);
    if (remaining <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, remaining));
});

/**
 * jsdom does not implement `scrollIntoView`.
 *
 * Filled in here rather than guarded in the components: the app runs in a real
 * WebView where every element has it, and a component that checked would be
 * carrying a branch that only exists for the test environment.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
        // Nothing to scroll in a document with no layout.
    };
}
