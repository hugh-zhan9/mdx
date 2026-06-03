import { describe, expect, it } from "vitest";
import { canRunLlmWikiQuery } from "./query-eligibility";

describe("canRunLlmWikiQuery", () => {
    it("only allows non-empty questions for ready LLM Wiki workspaces", () => {
        expect(
            canRunLlmWikiQuery({
                isReady: true,
                mode: "llmWiki",
                question: "  如何查询？ ",
            }),
        ).toBe(true);

        expect(
            canRunLlmWikiQuery({
                isReady: false,
                mode: "llmWiki",
                question: "如何查询？",
            }),
        ).toBe(false);
        expect(
            canRunLlmWikiQuery({
                isReady: true,
                mode: "ordinary",
                question: "如何查询？",
            }),
        ).toBe(false);
        expect(
            canRunLlmWikiQuery({
                isReady: true,
                mode: "llmWiki",
                question: "   ",
            }),
        ).toBe(false);
    });
});
