import { describe, expect, it } from "vitest";
import {
    DEFAULT_WINDOW_SIZE,
    MIN_WINDOW_SIZE,
    normalizePersistedWindowSize,
} from "./window-size";

describe("normalizePersistedWindowSize", () => {
    it("falls back to the Tauri config default for missing or invalid sizes", () => {
        expect(normalizePersistedWindowSize(undefined)).toEqual(
            DEFAULT_WINDOW_SIZE,
        );
        expect(
            normalizePersistedWindowSize({
                width: Number.NaN,
                height: 820,
            }),
        ).toEqual(DEFAULT_WINDOW_SIZE);
    });

    it("clamps restored sizes to the minimum workspace window size", () => {
        expect(
            normalizePersistedWindowSize({
                width: 320,
                height: 240,
            }),
        ).toEqual(MIN_WINDOW_SIZE);
    });

    it("rounds valid physical window sizes", () => {
        expect(
            normalizePersistedWindowSize({
                width: 1280.4,
                height: 768.6,
            }),
        ).toEqual({
            width: 1280,
            height: 769,
        });
    });
});
