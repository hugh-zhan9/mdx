import { describe, expect, it, vi } from "vitest";
import { tauriCore } from "@/common/lib/tauri";
import {
  addMemory,
  appendWorkingMemory,
  detectMemoryWorkspace,
  getMemoryBackendStatus,
  getMemoryIntegrationStatus,
  recallMemory,
} from "./memory-client";

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

  it("forwards working append requests", async () => {
    const invoke = vi.fn(async () => "# Working Memory\n");
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await appendWorkingMemory("/tmp/ws", "Focus", "修复 memory");

    expect(invoke).toHaveBeenCalledWith("memory_working_append", {
      rootPath: "/tmp/ws",
      section: "Focus",
      text: "修复 memory",
    });
  });

  it("forwards memory add requests", async () => {
    const invoke = vi.fn(async () => ({
      path: "memory/memories/focus.md",
      frontmatter: {},
      body: "修复 memory",
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await addMemory("/tmp/ws", {
      title: "目标：修复 memory",
      body: "修复 memory",
      tags: ["working-memory"],
    });

    expect(invoke).toHaveBeenCalledWith("memory_add", {
      rootPath: "/tmp/ws",
      request: {
        title: "目标：修复 memory",
        body: "修复 memory",
        tags: ["working-memory"],
      },
    });
  });

  it("fetches backend status and integration status", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "memory_backend_status") {
        return {
          ok: true,
          daemon: { status: "running", last_error: null },
          storage: { backend: "sqlite", status: "ready" },
          queue: { depth: 0, oldest_job_age_seconds: null },
          projection: { status: "ready", dirty_count: 0 },
          today: { captured_events: 0, pending_candidates: 0 },
        };
      }
      return [
        {
          agent_source: "codex",
          installed: true,
          enabled: true,
          authorized: true,
          hook_version: "1",
          last_event_at: null,
          last_error: null,
          doctor_status: "ok",
        },
      ];
    });
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await getMemoryBackendStatus("/tmp/ws");
    await getMemoryIntegrationStatus("/tmp/ws");

    expect(invoke).toHaveBeenCalledWith("memory_backend_status", {
      rootPath: "/tmp/ws",
    });
    expect(invoke).toHaveBeenCalledWith("memory_integration_status", {
      rootPath: "/tmp/ws",
    });
  });
});
