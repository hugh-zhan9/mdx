import { afterEach, describe, expect, it, vi } from "vitest";

import { stopListening } from "./tauri-events";

describe("stopListening", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("stops the listener it was given", () => {
        const unlisten = vi.fn();

        stopListening(unlisten);

        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it("has nothing to stop when there is no listener", () => {
        expect(() => stopListening(null)).not.toThrow();
        expect(() => stopListening(undefined)).not.toThrow();
    });

    it("survives a window that took its listeners with it", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        // What Tauri throws when the webview's listener table is already gone,
        // which is exactly when a React cleanup runs during window teardown.
        const unlisten = vi.fn(() => {
            throw new TypeError(
                "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
            );
        });

        expect(() => stopListening(unlisten)).not.toThrow();
        // Reported rather than swallowed: in a window that is not closing, a
        // listener that cannot be stopped is a leak, and this is what says so.
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
