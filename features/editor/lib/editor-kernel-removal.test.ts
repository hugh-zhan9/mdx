import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legacy editor removal governance", () => {
    it("does not expose legacy editor-view symbols from the public react index", () => {
        // That entry no longer exists: the directory went with the publishing and
        // PDF chain that was its only consumer. The guarantee is written to hold
        // either way rather than asserting the absence of the file — a react
        // entry added back for some other reason is not a violation, and one
        // added back exporting the legacy view still is.
        const entry = "packages/mdx-editor/react/index.ts";
        const source = existsSync(entry) ? readFileSync(entry, "utf8") : "";
        const legacyVisibleEditorExport = ["Mdx", "Editor", "View"].join("");

        expect(source).not.toContain(legacyVisibleEditorExport);
    });
});
