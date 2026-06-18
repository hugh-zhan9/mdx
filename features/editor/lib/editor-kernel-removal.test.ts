import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("closed editor kernel removal", () => {
    it("does not keep the removed proprietary editor kernel artifacts", () => {
        const removedDistPath = `.packages/@do-md/${"dist"}`;
        const removedTypePath = `types/${"do-md-react.d.ts"}`;

        expect(existsSync(removedDistPath)).toBe(false);
        expect(existsSync(removedTypePath)).toBe(false);
    });
});
