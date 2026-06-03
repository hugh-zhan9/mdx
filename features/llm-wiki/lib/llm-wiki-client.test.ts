import { describe, expect, it, vi } from "vitest";
import { tauriCore } from "@/common/lib/tauri";
import { queryWiki } from "./llm-wiki-client";

vi.mock("@/common/lib/tauri", () => ({
    tauriCore: vi.fn(),
}));

describe("queryWiki", () => {
    it("invokes the real LLM Wiki query command with root path and question", async () => {
        const invoke = vi.fn(async () => ({
            answer: "回答",
            references: [],
            insufficientContext: false,
        }));
        vi.mocked(tauriCore).mockResolvedValue({
            invoke,
        } as unknown as Awaited<ReturnType<typeof tauriCore>>);

        await expect(queryWiki("/tmp/wiki", "怎么使用？")).resolves.toEqual({
            answer: "回答",
            references: [],
            insufficientContext: false,
        });

        expect(invoke).toHaveBeenCalledWith("llm_wiki_query", {
            rootPath: "/tmp/wiki",
            question: "怎么使用？",
        });
    });
});
