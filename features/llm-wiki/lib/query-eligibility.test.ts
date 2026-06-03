import { describe, expect, it } from "vitest";
import {
    canRunLlmWikiQuery,
    isCurrentLlmWikiQueryRequest,
} from "./query-eligibility";

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

describe("isCurrentLlmWikiQueryRequest", () => {
    it("rejects a stale same-root query after the generation changes", () => {
        expect(
            isCurrentLlmWikiQueryRequest({
                activeRootPath: "/wiki-a",
                requestRootPath: "/wiki-a",
                activeGeneration: 3,
                requestGeneration: 1,
            }),
        ).toBe(false);
    });

    it("allows only matching root and generation", () => {
        expect(
            isCurrentLlmWikiQueryRequest({
                activeRootPath: "/wiki-a",
                requestRootPath: "/wiki-a",
                activeGeneration: 2,
                requestGeneration: 2,
            }),
        ).toBe(true);

        expect(
            isCurrentLlmWikiQueryRequest({
                activeRootPath: "/wiki-b",
                requestRootPath: "/wiki-a",
                activeGeneration: 2,
                requestGeneration: 2,
            }),
        ).toBe(false);
    });
});
