// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "./memory-panel";
import type { MemoryWorkspaceHook } from "../hooks/use-memory-workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../hooks/use-memory-workspace", () => ({
  useMemoryWorkspace: vi.fn(() => createMemoryWorkspaceHook()),
}));

const memoryClientMocks = vi.hoisted(() => ({
  acceptMemoryInbox: vi.fn(),
  addMemory: vi.fn(),
  appendWorkingMemory: vi.fn(),
  archiveMemory: vi.fn(),
  getMemoryBackendStatus: vi.fn(),
  getMemoryIntegrationStatus: vi.fn(),
  getMemoryThread: vi.fn(),
  getWorkingMemory: vi.fn(),
  listMemories: vi.fn(),
  listMemoryInbox: vi.fn(),
  listMemoryThreads: vi.fn(),
  promoteMemory: vi.fn(),
  rebuildMemoryIndex: vi.fn(),
  rejectMemoryInbox: vi.fn(),
  repairMemoryIntegration: vi.fn(),
  repairMemoryWorkspace: vi.fn(),
  setWorkingMemory: vi.fn(),
  setupMemoryAgents: vi.fn(),
}));

vi.mock("../lib/memory-client", () => memoryClientMocks);

function createMemoryWorkspaceHook(
  overrides: Partial<MemoryWorkspaceHook> = {},
): MemoryWorkspaceHook {
  return {
    status: {
      mode: "memory",
      has_memory: true,
      can_initialize: false,
      missing_paths: [],
    },
    viewState: {
      mode: "memory",
      hasMemory: true,
      canInitialize: false,
      missingPaths: [],
    },
    hasMemory: true,
    tabs: [
      { id: "overview", label: "概览", disabled: false },
      { id: "integrations", label: "Agent 集成", disabled: false },
      { id: "sessions", label: "会话", disabled: false },
      { id: "longTerm", label: "长期记忆", disabled: false },
      { id: "pending", label: "待确认", disabled: false },
      { id: "working", label: "工作上下文", disabled: false },
      { id: "diagnostics", label: "诊断", disabled: false },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
    initialize: vi.fn(),
    ...overrides,
  };
}

describe("MemoryPanel", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    memoryClientMocks.getMemoryBackendStatus.mockResolvedValue({
      ok: true,
      daemon: { status: "running", last_error: null },
      storage: { backend: "sqlite", status: "ready" },
      queue: { depth: 0, oldest_job_age_seconds: null },
      projection: { status: "ready", dirty_count: 0 },
      today: { captured_events: 0, pending_candidates: 0 },
    });
    memoryClientMocks.getMemoryIntegrationStatus.mockResolvedValue([
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
      {
        agent_source: "claude",
        installed: false,
        enabled: false,
        authorized: false,
        hook_version: null,
        last_event_at: null,
        last_error: null,
        doctor_status: "not_installed_or_configured",
      },
      {
        agent_source: "cursor",
        installed: false,
        enabled: false,
        authorized: false,
        hook_version: null,
        last_event_at: null,
        last_error: null,
        doctor_status: "not_installed_or_configured",
      },
    ]);
    memoryClientMocks.listMemoryThreads.mockResolvedValue([]);
    memoryClientMocks.listMemories.mockResolvedValue([]);
    memoryClientMocks.listMemoryInbox.mockResolvedValue([]);
    memoryClientMocks.getWorkingMemory.mockResolvedValue("# Working Memory\n");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders the memory panel tabs", async () => {
    await act(async () => {
      root.render(<MemoryPanel rootPath="/tmp/ws" />);
      await flushPromises();
    });

    const buttons = Array.from(host.querySelectorAll("button")).map((button) =>
      button.textContent?.trim(),
    );

    expect(buttons).toEqual(
      expect.arrayContaining([
        "概览",
        "Agent 集成",
        "会话",
        "长期记忆",
        "待确认",
        "工作上下文",
        "诊断",
      ]),
    );
  });

  it("renders agent integration controls in the integration tab", async () => {
    await act(async () => {
      root.render(<MemoryPanel rootPath="/tmp/ws" />);
      await flushPromises();
    });

    await act(async () => {
      getButton("Agent 集成").click();
      await flushPromises();
    });

    expect(host.textContent).toContain("配置 Agent 集成");
    expect(host.textContent).toContain("Codex");
    expect(host.textContent).toContain("Claude");
    expect(host.textContent).toContain("Cursor");
    expect(host.textContent).toContain("Hook");
    expect(host.textContent).toContain("配置智能体");
  });

  it("does not show zero messages when the thread count is unknown", async () => {
    memoryClientMocks.listMemoryThreads.mockResolvedValueOnce([
      {
        path: "memory/threads/codex/legacy.md",
        thread_id: "codex:legacy",
        source: "codex",
        title: "Legacy thread",
        started_at: null,
        ended_at: null,
        message_count: null,
        archived: false,
      },
    ]);
    memoryClientMocks.getMemoryThread.mockResolvedValueOnce({
      path: "memory/threads/codex/legacy.md",
      frontmatter: {
        schema_version: 1,
        kind: "memory_thread",
        thread_id: "codex:legacy",
        source: "codex",
        title: "Legacy thread",
        content_hash: "hash",
        started_at: null,
        ended_at: null,
        message_count: null,
        model: null,
        workspace_root: null,
        tags: [],
        distilled: false,
        promoted_to_wiki: false,
        archived: false,
      },
      body: "",
    });

    await act(async () => {
      root.render(<MemoryPanel rootPath="/tmp/ws" />);
      await flushPromises();
    });

    await act(async () => {
      getButton("会话").click();
      await flushPromises();
    });

    expect(host.textContent).toContain("codex · 消息数未知");
    expect(host.textContent).not.toContain("codex · 0 条消息");
  });

  it("appends quick working notes into the selected section", async () => {
    memoryClientMocks.getWorkingMemory.mockResolvedValueOnce(
      "# Working Memory\n\n## Updated\n",
    );
    memoryClientMocks.appendWorkingMemory.mockResolvedValueOnce(
      "# Working Memory\n\n## Updated\n- 当前在排查 memory\n",
    );

    await act(async () => {
      root.render(<MemoryPanel rootPath="/tmp/ws" />);
      await flushPromises();
    });

    await act(async () => {
      getButton("工作上下文").click();
      await flushPromises();
    });

    const input = host.querySelector(
      'input[placeholder="记录一句当前上下文"]',
    ) as HTMLInputElement | null;

    if (!input) {
      throw new Error("Expected quick note input");
    }

    await act(async () => {
      setInputValue(input, "当前在排查 memory");
      await flushPromises();
    });

    await act(async () => {
      getButton("记到工作记忆").click();
      await flushPromises();
    });

    expect(memoryClientMocks.appendWorkingMemory).toHaveBeenCalledWith(
      "/tmp/ws",
      "Updated",
      "当前在排查 memory",
    );
    expect(host.textContent).toContain("当前在排查 memory");
  });

  it("promotes a quick note into durable memory", async () => {
    memoryClientMocks.getWorkingMemory.mockResolvedValueOnce(
      "# Working Memory\n\n## Recent Decisions\n",
    );
    memoryClientMocks.addMemory.mockResolvedValueOnce({
      path: "memory/memories/decision.md",
      frontmatter: {
        schema_version: 1,
        kind: "memory",
        memory_id: "mem_decision",
        title: "决定：工作记忆需要快捷沉淀",
        status: "active",
        created_at: "2026-06-14T10:00:00Z",
        source_thread: null,
        source_message_refs: [],
        importance: null,
        confidence: null,
        tags: ["working-memory"],
        evolves_from: null,
      },
      body: "工作记忆需要快捷沉淀。",
    });

    await act(async () => {
      root.render(<MemoryPanel rootPath="/tmp/ws" />);
      await flushPromises();
    });

    await act(async () => {
      getButton("工作上下文").click();
      await flushPromises();
    });

    await act(async () => {
      getButton("最近决定").click();
      await flushPromises();
    });

    const input = host.querySelector(
      'input[placeholder="记录一句当前上下文"]',
    ) as HTMLInputElement | null;

    if (!input) {
      throw new Error("Expected quick note input");
    }

    await act(async () => {
      setInputValue(input, "工作记忆需要快捷沉淀");
      await flushPromises();
    });

    await act(async () => {
      getButton("记到长期记忆").click();
      await flushPromises();
    });

    expect(memoryClientMocks.addMemory).toHaveBeenCalledWith("/tmp/ws", {
      title: "决定：工作记忆需要快捷沉淀",
      body: "工作记忆需要快捷沉淀",
      tags: ["working-memory"],
    });
  });

  function getButton(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );

    if (!button) {
      throw new Error(`Expected button "${label}"`);
    }

    return button;
  }
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );

  if (!descriptor?.set) {
    throw new Error("Expected HTMLInputElement value setter");
  }

  descriptor.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
