import type { PersistedWindowSize } from "./types";

export const DEFAULT_WINDOW_SIZE: PersistedWindowSize = {
    width: 1440,
    height: 900,
};

export const MIN_WINDOW_SIZE: PersistedWindowSize = {
    width: 1100,
    height: 640,
};

export function normalizePersistedWindowSize(
    windowSize: PersistedWindowSize | undefined | null,
): PersistedWindowSize {
    if (
        !windowSize ||
        !Number.isFinite(windowSize.width) ||
        !Number.isFinite(windowSize.height)
    ) {
        return { ...DEFAULT_WINDOW_SIZE };
    }

    return {
        width: Math.max(Math.round(windowSize.width), MIN_WINDOW_SIZE.width),
        height: Math.max(Math.round(windowSize.height), MIN_WINDOW_SIZE.height),
    };
}
