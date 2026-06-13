import { describe, expect, it, vi } from "vitest";
import { tauriCore } from "@/common/lib/tauri";
import { detectMemoryWorkspace, recallMemory } from "./memory-client";

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: vi.fn(),
}));

describe("memory-client", () => {
  it("invokes memory workspace detection with rootPath", async () => {
    const invoke = vi.fn(async () => ({
      mode: "memory",
      has_memory: true,
      can_initialize: false,
      missing_paths: [],
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    const result = await detectMemoryWorkspace("/tmp/ws");

    expect(result.has_memory).toBe(true);
    expect(invoke).toHaveBeenCalledWith("memory_detect_workspace", {
      rootPath: "/tmp/ws",
    });
  });

  it("forwards nested recall requests in snake_case", async () => {
    const invoke = vi.fn(async () => ({
      working: null,
      memories: [],
      threads: [],
      wiki_refs: [],
      truncated: false,
      byte_count: 0,
      index_degraded: false,
      warnings: [],
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await recallMemory("/tmp/ws", {
      query: "auth",
      byte_budget: 4096,
      thread_ids: ["codex:1"],
      include_wiki_refs: true,
    });

    expect(invoke).toHaveBeenCalledWith("memory_recall", {
      rootPath: "/tmp/ws",
      request: {
        query: "auth",
        byte_budget: 4096,
        thread_ids: ["codex:1"],
        include_wiki_refs: true,
      },
    });
  });
});
