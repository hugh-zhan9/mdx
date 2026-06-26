import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legacy editor removal governance", () => {
    it("does not expose legacy editor-view symbols from the public react index", () => {
        const source = readFileSync("packages/mdx-editor/react/index.ts", "utf8");
        const legacyVisibleEditorExport = ["Mdx", "Editor", "View"].join("");

        expect(source).not.toContain(legacyVisibleEditorExport);
    });
});
