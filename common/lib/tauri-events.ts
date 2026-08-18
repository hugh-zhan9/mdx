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
 */
export function stopListening(unlisten: (() => void) | null | undefined) {
    if (!unlisten) {
        return;
    }

    try {
        unlisten();
    } catch (error) {
        console.warn("Failed to stop a Tauri event listener.", error);
    }
}
