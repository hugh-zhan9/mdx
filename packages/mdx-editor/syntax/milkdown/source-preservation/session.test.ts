import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_TOKEN, isProductMetadata, nextSourceId } from "./session";

/**
 * The token is built once, while the module is first evaluated, so the only way
 * to observe how it is built is to evaluate the module again under a watched
 * entropy source.
 */
async function freshToken(
    getRandomValues?: (array: Uint8Array) => Uint8Array,
): Promise<string> {
    vi.resetModules();
    if (getRandomValues) vi.stubGlobal("crypto", { getRandomValues });
    else vi.stubGlobal("crypto", undefined);
    const reloaded = await import("./session");
    return reloaded.SESSION_TOKEN;
}

/** Captured before any stub replaces `globalThis.crypto`. */
const entropy = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

const realRandomValues = (array: Uint8Array): Uint8Array => entropy(array);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe("the session token", () => {
    it("is drawn from the platform's entropy source, once", async () => {
        const draws = vi.fn(realRandomValues);
        const token = await freshToken(draws);

        expect(draws).toHaveBeenCalledTimes(1);
        expect(draws.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
        expect(draws.mock.calls[0][0].length).toBe(16);
        expect(token).toMatch(/^[0-9a-f]{32}$/);
    });

    it("differs between two evaluations of the module", async () => {
        // A constant would satisfy every other assertion here; only two
        // separate evaluations can tell a secret from a literal.
        const first = await freshToken(vi.fn(realRandomValues));
        const second = await freshToken(vi.fn(realRandomValues));

        expect(first).not.toBe(second);
    });

    it("refuses to exist without a real entropy source", async () => {
        // No fallback: a guessable token is the same as no token at all, and a
        // guessable one would be trusted for the whole session.
        await expect(freshToken()).rejects.toThrow(
            "crypto.getRandomValues",
        );
    });

    it("recognises only its own token as this product's", () => {
        expect(isProductMetadata(SESSION_TOKEN)).toBe(true);
        expect(isProductMetadata(null)).toBe(false);
        expect(isProductMetadata(undefined)).toBe(false);
        expect(isProductMetadata("")).toBe(false);
        expect(isProductMetadata(`${SESSION_TOKEN}0`)).toBe(false);
    });
});

describe("preserved source ids", () => {
    it("never repeats, so two identical slices stay distinguishable", () => {
        const ids = [nextSourceId(), nextSourceId(), nextSourceId()];
        expect(new Set(ids).size).toBe(3);
    });
});
