// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    BACKGROUND_IMAGE_PROPERTY,
    BACKGROUND_ROOT_ATTRIBUTE,
    BACKGROUND_VEIL_PROPERTY,
    DEFAULT_BACKGROUND_OPACITY,
    applyBackgroundToRoot,
    clampOpacity,
    parseBackgroundSetting,
    readBackgroundSetting,
    veilStrength,
    writeBackgroundSetting,
} from "./background-preference";

/**
 * The background image's stored value, and what it puts on the page.
 *
 * Two properties are worth pinning here. The stored value is read back from
 * ordinary storage the user can edit and then names a file a command will read,
 * so a value that is not one has to come back as no background rather than as a
 * repaired guess. And the veil is the inverse of the strength the user chose —
 * getting that backwards is a slider that fades the picture the wrong way.
 */

/**
 * A storage of our own.
 *
 * The environment this suite runs in already has a `localStorage` global that is
 * not a working one, and the module under test reads whichever it finds. Rather
 * than testing around that, the global is replaced with a plain map for the
 * duration — which is also what makes each test start from empty.
 */
function installStorage(): Storage {
    const entries = new Map<string, string>();
    const storage = {
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
    } as unknown as Storage;

    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: storage,
    });

    return storage;
}

beforeEach(() => {
    installStorage();
});

afterEach(() => {
    localStorage.clear();
    applyBackgroundToRoot(document.documentElement, null);
});

describe("stored value", () => {
    it("keeps a name, a strength and a layout", () => {
        expect(
            parseBackgroundSetting({
                fileName: "abc.png",
                opacity: 0.3,
                fit: "tile",
            }),
        ).toEqual({ fileName: "abc.png", opacity: 0.3, fit: "tile" });
    });

    it("fills in the strength and layout it was not given", () => {
        expect(parseBackgroundSetting({ fileName: "abc.png" })).toEqual({
            fileName: "abc.png",
            opacity: DEFAULT_BACKGROUND_OPACITY,
            fit: "cover",
        });
    });

    it("refuses a name that is not a single file name", () => {
        for (const fileName of [
            "../secret.png",
            "sub/abc.png",
            "..\\secret.png",
            ".hidden.png",
            "   ",
            "",
        ]) {
            expect(parseBackgroundSetting({ fileName })).toBeNull();
        }
    });

    it("refuses a value that is not a stored setting at all", () => {
        for (const raw of [null, undefined, 3, "abc.png", [], {}]) {
            expect(parseBackgroundSetting(raw)).toBeNull();
        }
    });

    it("brings a strength outside the range back into it", () => {
        expect(clampOpacity(-1)).toBe(0);
        expect(clampOpacity(4)).toBe(1);
    });

    it("falls back to the default for a strength that is not a number", () => {
        // Not a clamp: there is no nearest edge to a value that is not on the
        // line, and 0 would be a background nobody can see.
        expect(clampOpacity(Number.NaN)).toBe(DEFAULT_BACKGROUND_OPACITY);
    });

    it("survives a round trip through storage", () => {
        writeBackgroundSetting({
            fileName: "abc.png",
            opacity: 0.4,
            fit: "tile",
        });

        expect(readBackgroundSetting()).toEqual({
            fileName: "abc.png",
            opacity: 0.4,
            fit: "tile",
        });
    });

    it("reads as no background when the stored text is not a setting", () => {
        localStorage.setItem("backgroundImage", "{not json");

        expect(readBackgroundSetting()).toBeNull();
    });

    it("answers with the same object while nothing has changed", () => {
        // It is a `useSyncExternalStore` snapshot: a fresh object every call is
        // a render loop, not a slow read.
        writeBackgroundSetting({ fileName: "abc.png", opacity: 0.2, fit: "cover" });

        const first = readBackgroundSetting();

        expect(readBackgroundSetting()).toBe(first);

        writeBackgroundSetting({ fileName: "abc.png", opacity: 0.5, fit: "cover" });

        expect(readBackgroundSetting()).not.toBe(first);
        expect(readBackgroundSetting()?.opacity).toBe(0.5);
    });

    it("answers with a new object after a write, even an identical one", () => {
        // A write is an event. Re-choosing a picture whose stored copy had gone
        // missing writes a byte-identical preference, and if that still read as
        // the same object the effect that paints would never run again — the file
        // would be back with no way to make it appear.
        writeBackgroundSetting({ fileName: "a.png", opacity: 0.2, fit: "cover" });

        const first = readBackgroundSetting();

        writeBackgroundSetting({ fileName: "a.png", opacity: 0.2, fit: "cover" });

        expect(readBackgroundSetting()).not.toBe(first);
        expect(readBackgroundSetting()).toEqual(first);
    });
});

describe("what reaches the page", () => {
    it("sets the image, the veil and the layout", () => {
        const root = document.documentElement;

        applyBackgroundToRoot(root, {
            url: "blob:abc",
            opacity: 0.25,
            fit: "tile",
        });

        expect(root.getAttribute(BACKGROUND_ROOT_ATTRIBUTE)).toBe("tile");
        expect(root.style.getPropertyValue(BACKGROUND_IMAGE_PROPERTY)).toBe(
            'url("blob:abc")',
        );
        expect(root.style.getPropertyValue(BACKGROUND_VEIL_PROPERTY)).toBe("75%");
    });

    it("takes everything back off when there is no background", () => {
        const root = document.documentElement;
        applyBackgroundToRoot(root, {
            url: "blob:abc",
            opacity: 0.25,
            fit: "cover",
        });

        applyBackgroundToRoot(root, null);

        // The attribute is what the stylesheet keys off, so its absence is the
        // whole of "no background": no layer is painted rather than a clear one.
        expect(root.hasAttribute(BACKGROUND_ROOT_ATTRIBUTE)).toBe(false);
        expect(root.style.getPropertyValue(BACKGROUND_IMAGE_PROPERTY)).toBe("");
        expect(root.style.getPropertyValue(BACKGROUND_VEIL_PROPERTY)).toBe("");
    });

    it("closes the quotes a URL could otherwise end early", () => {
        const root = document.documentElement;

        applyBackgroundToRoot(root, {
            url: 'blob:a"); background: red; --x: url("b',
            opacity: 0.5,
            fit: "cover",
        });

        const value = root.style.getPropertyValue(BACKGROUND_IMAGE_PROPERTY);

        expect(value.startsWith('url("')).toBe(true);
        expect(value).toContain('\\"');
        expect(root.style.background).toBe("");
    });

    it("veils the image by the inverse of the strength asked for", () => {
        expect(veilStrength(0)).toBe("100%");
        expect(veilStrength(1)).toBe("0%");
        expect(veilStrength(0.12)).toBe("88%");
    });
});
