// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBackground, type BackgroundControls } from "./use-background";
import {
    BACKGROUND_ROOT_ATTRIBUTE,
    DEFAULT_BACKGROUND_OPACITY,
    applyBackgroundToRoot,
    readBackgroundSetting,
    writeBackgroundSetting,
} from "./background-preference";

/**
 * Choosing, adjusting and removing the background.
 *
 * The stored copy is the part that reaches Rust, so it is replaced here; the
 * preference, the veil and what lands on the root element are the real thing.
 * What these pin is the order things happen in, because that is where this can
 * be wrong without looking wrong: removing has to take the background off the
 * window even when deleting the copy fails, and a preference naming a file that
 * is gone has to say so rather than leave a window that quietly ignores it.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const spies = vi.hoisted(() => ({
    storeBackgroundImage: vi.fn(async () => "stored.png"),
    clearStoredBackgroundImage: vi.fn(async () => {}),
    backgroundImageUrl: vi.fn(async () => "blob:stored"),
    releaseBackgroundImageUrl: vi.fn(() => {}),
}));

vi.mock("./background-image", async (importOriginal) => ({
    // The fit options are data the panel and the stylesheet both read; only the
    // four functions that would reach the filesystem are replaced.
    ...(await importOriginal<typeof import("./background-image")>()),
    ...spies,
}));

function installStorage(): void {
    const entries = new Map<string, string>();

    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: {
            get length() {
                return entries.size;
            },
            clear: () => entries.clear(),
            getItem: (key: string) => entries.get(key) ?? null,
            key: (index: number) => [...entries.keys()][index] ?? null,
            removeItem: (key: string) => entries.delete(key),
            setItem: (key: string, value: string) => {
                entries.set(key, value);
            },
        } as unknown as Storage,
    });
}

/**
 * What the mounted hook currently returns.
 *
 * Published from an effect rather than during render: assigning to something
 * outside the component while rendering is a side effect, and one this suite has
 * no need for — every assertion runs after `act` has flushed.
 */
const held: { controls: BackgroundControls | null } = { controls: null };
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

function Probe() {
    const controls = useBackground();

    useEffect(() => {
        held.controls = controls;
    });

    return null;
}

function mount() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Probe />));
}

beforeEach(() => {
    installStorage();
    vi.clearAllMocks();
    spies.storeBackgroundImage.mockImplementation(async () => "stored.png");
    spies.backgroundImageUrl.mockImplementation(async () => "blob:stored");
    spies.clearStoredBackgroundImage.mockImplementation(async () => {});
});

afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    held.controls = null;
    root = null;
    host = null;
    applyBackgroundToRoot(document.documentElement, null);
    localStorage.clear();
});

const picture = () => new File([new Uint8Array([1, 2, 3])], "光.png", {
    type: "image/png",
});

describe("choosing a background", () => {
    it("stores the file and remembers it at the default strength", async () => {
        mount();

        await act(async () => {
            await held.controls?.choose(picture());
        });

        expect(spies.storeBackgroundImage).toHaveBeenCalledTimes(1);
        expect(readBackgroundSetting()).toEqual({
            fileName: "stored.png",
            opacity: DEFAULT_BACKGROUND_OPACITY,
            fit: "cover",
        });
        expect(
            document.documentElement.getAttribute(BACKGROUND_ROOT_ATTRIBUTE),
        ).toBe("cover");
    });

    it("keeps the strength and layout when the picture is swapped", async () => {
        writeBackgroundSetting({
            fileName: "old.png",
            opacity: 0.42,
            fit: "tile",
        });
        spies.storeBackgroundImage.mockImplementation(async () => "new.png");
        mount();

        await act(async () => {
            await held.controls?.choose(picture());
        });

        expect(readBackgroundSetting()).toEqual({
            fileName: "new.png",
            opacity: 0.42,
            fit: "tile",
        });
    });

    it("reports a file it could not store and changes nothing", async () => {
        spies.storeBackgroundImage.mockImplementation(() => {
            throw new Error("图片超过 12 MiB 上限");
        });
        mount();

        await act(async () => {
            await held.controls?.choose(picture());
        });

        expect(held.controls?.error).toBe("图片超过 12 MiB 上限");
        expect(readBackgroundSetting()).toBeNull();
    });
});

describe("adjusting it", () => {
    it("keeps the strength inside the range", async () => {
        writeBackgroundSetting({
            fileName: "a.png",
            opacity: 0.2,
            fit: "cover",
        });
        mount();

        act(() => held.controls?.setOpacity(4));

        expect(readBackgroundSetting()?.opacity).toBe(1);
    });

    it("does nothing when there is no background to adjust", () => {
        mount();

        act(() => held.controls?.setOpacity(0.5));
        act(() => held.controls?.setFit("tile"));

        expect(readBackgroundSetting()).toBeNull();
    });
});

describe("removing it", () => {
    it("takes the background off the window and deletes the copy", async () => {
        writeBackgroundSetting({
            fileName: "a.png",
            opacity: 0.3,
            fit: "cover",
        });
        mount();

        await act(async () => {
            await held.controls?.remove();
        });

        expect(readBackgroundSetting()).toBeNull();
        expect(spies.clearStoredBackgroundImage).toHaveBeenCalledTimes(1);
        expect(
            document.documentElement.hasAttribute(BACKGROUND_ROOT_ATTRIBUTE),
        ).toBe(false);
    });

    it("still takes it off the window when the copy cannot be deleted", async () => {
        writeBackgroundSetting({
            fileName: "a.png",
            opacity: 0.3,
            fit: "cover",
        });
        spies.clearStoredBackgroundImage.mockImplementation(() => {
            throw new Error("权限不足");
        });
        mount();

        await act(async () => {
            await held.controls?.remove();
        });

        // The preference is written before the copy is deleted, precisely so a
        // failure here is a message rather than a background that will not go.
        expect(readBackgroundSetting()).toBeNull();
        expect(
            document.documentElement.hasAttribute(BACKGROUND_ROOT_ATTRIBUTE),
        ).toBe(false);
        expect(held.controls?.error).toBe("权限不足");
    });
});

describe("a stored image that is gone", () => {
    it("is painted again once the same picture is chosen back", async () => {
        writeBackgroundSetting({
            fileName: "same.png",
            opacity: 0.3,
            fit: "cover",
        });
        spies.backgroundImageUrl.mockImplementation(async () => {
            throw new Error("无法读取背景图");
        });

        await act(async () => {
            mount();
        });

        expect(held.controls?.error).toBe("无法读取背景图");

        // Re-picking the original file stores it back under the same
        // content-hash name, so the preference written is byte-identical to the
        // one already there. Nothing about the choice changes — only whether the
        // file is on disk — and it has to take effect anyway.
        spies.storeBackgroundImage.mockImplementation(async () => "same.png");
        spies.backgroundImageUrl.mockImplementation(async () => "blob:same");

        await act(async () => {
            await held.controls?.choose(picture());
        });

        expect(
            document.documentElement.getAttribute(BACKGROUND_ROOT_ATTRIBUTE),
        ).toBe("cover");
        expect(held.controls?.error).toBeNull();
    });

    it("paints nothing, says why, and keeps the choice", async () => {
        writeBackgroundSetting({
            fileName: "gone.png",
            opacity: 0.3,
            fit: "cover",
        });
        spies.backgroundImageUrl.mockImplementation(async () => {
            throw new Error("无法读取背景图");
        });

        await act(async () => {
            mount();
        });

        expect(
            document.documentElement.hasAttribute(BACKGROUND_ROOT_ATTRIBUTE),
        ).toBe(false);
        expect(held.controls?.error).toBe("无法读取背景图");
        // Not forgotten: the file may come back, and silently dropping the
        // choice would be a second surprise on top of the first.
        expect(readBackgroundSetting()?.fileName).toBe("gone.png");
    });
});
