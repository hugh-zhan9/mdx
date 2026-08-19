/**
 * Stopping a Tauri event listener, safely.
 *
 * `listen()` hands back a function that removes the listener by looking its
 * registration up in a table the webview owns. When the window is being
 * destroyed that table goes with it — and that is exactly the moment React
 * unmounts and runs the cleanup that calls this — so the lookup throws on an
 * entry that is no longer there:
 *
 *     undefined is not an object (evaluating 'listeners[eventId].handlerId')
 *
 * There is nothing to stop at that point: the listener died with the window. The
 * failure is logged rather than swallowed silently, because a listener that
 * cannot be stopped in a window that is *not* closing would be a leak, and the
 * warning is the only thing that would say so.
 *
 * Both ways it can fail. The webview's `unregisterListener` is an async function,
 * so the lookup above throws into a rejected promise rather than up the stack: a
 * `try` around the call catches nothing, and the rejection surfaces as an
 * unhandled error with this cleanup at the bottom of its trace. A hot reload does
 * it too — the replaced module's cleanup runs against handler ids the new one has
 * already forgotten.
 */
export function stopListening(unlisten: (() => void) | null | undefined) {
    if (!unlisten) {
        return;
    }

    const report = (error: unknown) => {
        console.warn("Failed to stop a Tauri event listener.", error);
    };

    try {
        const stopped: unknown = unlisten();

        if (
            typeof stopped === "object" &&
            stopped !== null &&
            "then" in stopped &&
            typeof (stopped as PromiseLike<unknown>).then === "function"
        ) {
            void Promise.resolve(stopped as PromiseLike<unknown>).catch(report);
        }
    } catch (error) {
        report(error);
    }
}
