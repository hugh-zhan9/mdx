import { describe, expect, it } from "vitest";
import { ensureGrammar, tokenize } from "./prism";

describe("editor code tokenization", () => {
    it("keeps markdown fenced code as plain text", async () => {
        const markdown = [
            "# 这里不应该变成标题",
            "[百度](http://baidu.com)",
            "![图片](.assets/a.png)",
            "> [!WARNING]",
        ].join("\n");

        expect(tokenize(markdown, "md")).toEqual([]);
        expect(tokenize(markdown, "markdown")).toEqual([]);
        await expect(ensureGrammar("md")).resolves.toBe(false);
    });

    it("still highlights programming languages", () => {
        expect(tokenize("const value = 1;", "ts").length).toBeGreaterThan(0);
    });
});
