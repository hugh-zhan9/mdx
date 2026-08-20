// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    BACKGROUND_ACCEPT,
    BACKGROUND_IMAGE_TYPES,
    MAX_BACKGROUND_BYTES,
    backgroundImageUrl,
    clearStoredBackgroundImage,
    releaseBackgroundImageUrl,
    storeBackgroundImage,
} from "./background-image";

/**
 * The stored copy, and the blob URL the page paints with.
 *
 * The blob lifecycle is the part of this feature that can be wrong without
 * looking wrong: an extra read is invisible, a missing revoke is invisible, and a
 * revoke of the URL that is currently painted shows up as a background that
 * vanishes for no reason. So the reads are counted and the revokes are recorded.
 *
 * `URL.createObjectURL` is stubbed because jsdom does not implement it — which
 * is convenient here, since counting revocations is most of the point.
 */

let created: Array<{ url: string; blob: Blob }> = [];
let revoked: string[] = [];

beforeEach(() => {
    created = [];
    revoked = [];
    let next = 0;

    Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: (blob: Blob) => {
            const url = `blob:${String(next)}`;
            next += 1;
            created.push({ url, blob });
            return url;
        },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: (url: string) => revoked.push(url),
    });
});

afterEach(() => {
    // Module state outlives a test, so the next one starts with nothing held.
    releaseBackgroundImageUrl();
});

/** An `invoke` that answers immediately, counting the reads it was asked for. */
function immediate(bytes = new Uint8Array([1, 2, 3])) {
    const invoke = vi.fn(async () => bytes.buffer);

    return { invoke: invoke as unknown as <T>() => Promise<T>, calls: invoke };
}

/**
 * Lets the reads that have been started reach their `invoke`.
 *
 * `backgroundImageUrl` awaits the bridge before it calls anything, so a read is
 * not yet outstanding on the turn it was started.
 */
const started = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An `invoke` whose reads are resolved by the test, in the order it chooses. */
function deferred() {
    const resolvers: Array<(bytes: ArrayBuffer) => void> = [];
    const invoke = vi.fn(
        () =>
            new Promise<ArrayBuffer>((resolve) => {
                resolvers.push(resolve);
            }),
    );

    return {
        invoke: invoke as unknown as <T>() => Promise<T>,
        resolve: (index: number) =>
            resolvers[index](new Uint8Array([index]).buffer),
    };
}

describe("reading the stored image", () => {
    it("answers with a blob typed from the file's extension", async () => {
        const { invoke } = immediate();

        const url = await backgroundImageUrl("abc.jpeg", { invoke });

        expect(url).toBe("blob:0");
        expect(created[0].blob.type).toBe("image/jpeg");
    });

    it("reads the file once, however often it is asked for", async () => {
        const { invoke, calls } = immediate();

        await backgroundImageUrl("abc.png", { invoke });
        await backgroundImageUrl("abc.png", { invoke });

        expect(calls).toHaveBeenCalledTimes(1);
        expect(created).toHaveLength(1);
    });

    it("gives two callers asking at once the same read", async () => {
        const { invoke, calls } = immediate();

        const [first, second] = await Promise.all([
            backgroundImageUrl("abc.png", { invoke }),
            backgroundImageUrl("abc.png", { invoke }),
        ]);

        expect(first).toBe(second);
        expect(calls).toHaveBeenCalledTimes(1);
        expect(created).toHaveLength(1);
    });

    it("revokes the picture it replaces", async () => {
        const { invoke } = immediate();

        const first = await backgroundImageUrl("a.png", { invoke });
        await backgroundImageUrl("b.png", { invoke });

        expect(revoked).toEqual([first]);
    });

    it("revokes what it holds when the background is taken off", async () => {
        const { invoke } = immediate();
        const url = await backgroundImageUrl("a.png", { invoke });

        releaseBackgroundImageUrl();

        expect(revoked).toEqual([url]);
    });
});

describe("a read that is abandoned while it is running", () => {
    it("drops its own blob rather than leaving one nothing will revoke", async () => {
        const { invoke, resolve } = deferred();
        const reading = backgroundImageUrl("a.png", { invoke });
        await started();

        // What removing the background does while the first read is still out.
        releaseBackgroundImageUrl();
        resolve(0);

        await expect(reading).rejects.toThrow();
        // Created and then immediately given up: the alternative is a blob held
        // for the life of the window for a background that is no longer set.
        expect(created).toHaveLength(1);
        expect(revoked).toEqual([created[0].url]);
    });

    it("does not revoke the picture that replaced it", async () => {
        const { invoke, resolve } = deferred();
        const first = backgroundImageUrl("a.png", { invoke });
        await started();
        const second = backgroundImageUrl("b.png", { invoke });
        await started();

        // Out of order on purpose: the read for B finishes and is painted, then
        // the abandoned read for A comes back. A must not take B's URL with it.
        resolve(1);
        const painted = await second;
        resolve(0);
        await expect(first).rejects.toThrow();

        expect(revoked).not.toContain(painted);
        expect(await backgroundImageUrl("b.png", { invoke })).toBe(painted);
    });
});

describe("storing a chosen file", () => {
    it("refuses a kind of file that could not be read back", async () => {
        const { invoke, calls } = immediate();

        await expect(
            storeBackgroundImage(new File(["x"], "notes.md"), { invoke }),
        ).rejects.toThrow(/不支持/);
        expect(calls).not.toHaveBeenCalled();
    });

    it("refuses a file over the cap before it crosses the bridge", async () => {
        const { invoke, calls } = immediate();
        const big = new File(["x"], "big.png");
        Object.defineProperty(big, "size", { value: MAX_BACKGROUND_BYTES + 1 });

        await expect(storeBackgroundImage(big, { invoke })).rejects.toThrow(
            /上限/,
        );
        expect(calls).not.toHaveBeenCalled();
    });

    it("answers with the name Rust stored it under", async () => {
        const invoke = vi.fn(async () => ({ fileName: "hash.png" }));

        const stored = await storeBackgroundImage(
            new File(["x"], "光.png"),
            { invoke: invoke as unknown as <T>() => Promise<T> },
        );

        expect(stored).toBe("hash.png");
    });

    it("drops the blob it was holding when the copy is deleted", async () => {
        const { invoke } = immediate();
        const url = await backgroundImageUrl("a.png", { invoke });

        await clearStoredBackgroundImage({ invoke });

        expect(revoked).toEqual([url]);
    });
});

/**
 * Two values live in both languages. Rust decides what it will store; this side
 * decides what the picker offers and how the blob is typed. A comment claiming
 * they agree is not the same as them agreeing.
 */
describe("agreement with Rust", () => {
    it("offers exactly the extensions Rust will store", () => {
        const assets = readFileSync("src-tauri/src/assets.rs", "utf8");
        const list = /IMAGE_EXTENSIONS: &\[&str\] = &\[([^\]]*)\]/.exec(assets);
        const extensions = [...(list?.[1] ?? "").matchAll(/"([a-z0-9]+)"/g)].map(
            (match) => match[1],
        );

        expect(extensions.length).toBeGreaterThan(0);
        expect(Object.keys(BACKGROUND_IMAGE_TYPES).sort()).toEqual(
            extensions.sort(),
        );
        for (const extension of extensions) {
            expect(BACKGROUND_ACCEPT).toContain(`.${extension}`);
        }
    });

    it("caps an image at the size Rust caps it at", () => {
        const background = readFileSync("src-tauri/src/background.rs", "utf8");
        const cap = /MAX_BACKGROUND_BYTES: usize = ([0-9 *]+);/.exec(background);
        const bytes = (cap?.[1] ?? "")
            .split("*")
            .map((part) => Number.parseInt(part.trim(), 10))
            .reduce((product, part) => product * part, 1);

        expect(bytes).toBe(MAX_BACKGROUND_BYTES);
    });
});
