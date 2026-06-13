import { describe, expect, it } from "vitest";
import { formatMemoryError } from "./memory-error";

describe("formatMemoryError", () => {
  it("formats structured workspace errors with the error code", () => {
    expect(
      formatMemoryError({
        error_code: "llm_wiki_not_ready",
        message: "LLM Wiki is not initialized",
      }),
    ).toBe("llm_wiki_not_ready: LLM Wiki is not initialized");
  });

  it("preserves plain string errors", () => {
    expect(formatMemoryError("failed")).toBe("failed");
  });
});
