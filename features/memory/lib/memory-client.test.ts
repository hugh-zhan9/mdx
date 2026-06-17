import { describe, expect, it, vi } from "vitest";
import { tauriCore } from "@/common/lib/tauri";
import {
  addMemory,
  appendWorkingMemory,
  detectMemoryWorkspace,
  dryRunMemoryStorageMigration,
  getMemoryBackendStatus,
  getMemoryIntegrationStatus,
  recallMemory,
  runMemoryStorageMigration,
  setMemoryConfig,
  updateMemoryConfig,
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

  it("forwards memory config set requests", async () => {
    const invoke = vi.fn(async () => ({
      version: 2,
      memory: { enabled: true },
      agent_backend: {
        enabled: true,
        capture_enabled: false,
        recall_injection_enabled: true,
        distill_enabled: true,
        auto_accept: false,
        context_byte_budget: 4096,
      },
      projection: { enabled: true },
      agents: {
        codex: { enabled: false, paused: false },
        claude: { enabled: false, paused: false },
        cursor: { enabled: false, paused: false },
      },
      storage: {
        backend: "sqlite",
        sqlite_path: null,
        postgres_url_ref: null,
      },
      provider: {
        mode: "reuse_llm",
        provider: null,
        model: null,
      },
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await setMemoryConfig("/tmp/ws", {
      scope: "workspace",
      key: "agent_backend.capture_enabled",
      enabled: false,
    });

    expect(invoke).toHaveBeenCalledWith("memory_config_set", {
      rootPath: "/tmp/ws",
      request: {
        scope: "workspace",
        key: "agent_backend.capture_enabled",
        enabled: false,
      },
    });
  });

  it("forwards memory config update requests", async () => {
    const invoke = vi.fn(async () => ({
      version: 2,
      memory: { enabled: true },
      agent_backend: {
        enabled: true,
        capture_enabled: false,
        recall_injection_enabled: true,
        distill_enabled: true,
        auto_accept: false,
        context_byte_budget: 4096,
      },
      projection: { enabled: true },
      agents: {
        codex: { enabled: false, paused: false },
        claude: { enabled: false, paused: false },
        cursor: { enabled: false, paused: false },
      },
      storage: {
        backend: "postgresql",
        sqlite_path: null,
        postgres_url_ref: "postgresql://localhost/mdx",
      },
      provider: {
        mode: "provider",
        provider: "openai",
        model: null,
      },
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await updateMemoryConfig("/tmp/ws", {
      scope: "workspace",
      provider: { mode: "provider", provider: "openai" },
      storage: {
        backend: "postgresql",
        postgres_url_ref: "postgresql://localhost/mdx",
      },
    });

    expect(invoke).toHaveBeenCalledWith("memory_config_update", {
      rootPath: "/tmp/ws",
      request: {
        scope: "workspace",
        provider: { mode: "provider", provider: "openai" },
        storage: {
          backend: "postgresql",
          postgres_url_ref: "postgresql://localhost/mdx",
        },
      },
    });
  });

  it("forwards memory storage migration dry-run requests", async () => {
    const invoke = vi.fn(async () => ({
      migration_id: "migration:1:postgresql",
      from: "sqlite",
      to: "postgresql",
      dry_run: true,
      records_seen: { memories: 2, threads: 1 },
      records_copied: {},
      records_skipped: {},
      validation_errors: [],
      backup_path: null,
      config_switched: false,
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await dryRunMemoryStorageMigration("/tmp/ws", {
      from: "sqlite",
      to: "postgresql",
      target: "postgresql://localhost/mdx",
      dry_run: true,
      resume: false,
    });

    expect(invoke).toHaveBeenCalledWith("memory_storage_migrate_dry_run", {
      rootPath: "/tmp/ws",
      request: {
        from: "sqlite",
        to: "postgresql",
        target: "postgresql://localhost/mdx",
        dry_run: true,
        resume: false,
      },
    });
  });

  it("forwards memory storage migration apply requests", async () => {
    const invoke = vi.fn(async () => ({
      migration_id: "migration:1:postgresql",
      from: "sqlite",
      to: "postgresql",
      dry_run: false,
      records_seen: { memories: 2, threads: 1 },
      records_copied: { memories: 2, threads: 1 },
      records_skipped: {},
      validation_errors: [],
      backup_path: null,
      config_switched: true,
    }));
    vi.mocked(tauriCore).mockResolvedValue({
      invoke,
    } as unknown as Awaited<ReturnType<typeof tauriCore>>);

    await runMemoryStorageMigration("/tmp/ws", {
      from: "sqlite",
      to: "postgresql",
      target: "postgresql://localhost/mdx",
      dry_run: false,
      resume: false,
    });

    expect(invoke).toHaveBeenCalledWith("memory_storage_migrate", {
      rootPath: "/tmp/ws",
      request: {
        from: "sqlite",
        to: "postgresql",
        target: "postgresql://localhost/mdx",
        dry_run: false,
        resume: false,
      },
    });
  });
});
