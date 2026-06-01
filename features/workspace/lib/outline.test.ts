import { describe, expect, it } from "vitest";
import { parseMarkdownOutline } from "./outline";

describe("parseMarkdownOutline", () => {
    it("parses h1-h6 in source order", () => {
        const headings = parseMarkdownOutline("# One\n\n## Two\n### Three");
        expect(headings.map((h) => h.text)).toEqual(["One", "Two", "Three"]);
        expect(headings.map((h) => h.level)).toEqual([1, 2, 3]);
    });

    it("ignores code fences and invalid heading markers", () => {
        const headings = parseMarkdownOutline(
            "# One\n```md\n## Hidden\n```\n####### Nope\n###### Six",
        );
        expect(headings.map((h) => h.text)).toEqual(["One", "Six"]);
        expect(headings.map((h) => h.level)).toEqual([1, 6]);
    });
});
