import type { PersistedWindowSize } from "./types";

export const DEFAULT_WINDOW_SIZE: PersistedWindowSize = {
    width: 900,
    height: 700,
};

export const MIN_WINDOW_SIZE: PersistedWindowSize = {
    width: 720,
    height: 480,
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
