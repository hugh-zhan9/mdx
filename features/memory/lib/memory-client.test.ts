import { describe, expect, it, vi } from "vitest";
import { tauriCore } from "@/common/lib/tauri";
import * as client from "./memory-client";

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: vi.fn(),
}));

function mockInvoke(result: unknown = {}) {
  const invoke = vi.fn(async () => result);
  vi.mocked(tauriCore).mockResolvedValue({
    invoke,
  } as unknown as Awaited<ReturnType<typeof tauriCore>>);
  return invoke;
}

describe("memory-client", () => {
  it("asks for status by workspace", async () => {
    const invoke = mockInvoke({ enabled: false });

    await client.getMemoryStatus("/tmp/ws");

    expect(invoke).toHaveBeenCalledWith("memory_status", {
      rootPath: "/tmp/ws",
    });
  });

  it("nests request payloads the way the commands expect", async () => {
    const invoke = mockInvoke([]);

    await client.searchMemory("font subset", 5);

    expect(invoke).toHaveBeenCalledWith("memory_search", {
      request: { query: "font subset", topK: 5 },
    });
  });

  it("sends a conclusion with the material it rests on", async () => {
    const invoke = mockInvoke({ drawerId: "kn_1", created: true });

    await client.distillConclusion("/tmp/ws", {
      statement: "exports embed a subset",
      body: "measured on the rendered page",
      supportingRefs: ["ev_1", "ev_2"],
    });

    expect(invoke).toHaveBeenCalledWith("memory_distill", {
      rootPath: "/tmp/ws",
      request: {
        statement: "exports embed a subset",
        body: "measured on the rendered page",
        supportingRefs: ["ev_1", "ev_2"],
      },
    });
  });

  it("adopts by id and lets the caller add a note", async () => {
    const invoke = mockInvoke({
      drawerId: "kn_1",
      status: "promoted",
      confirmationDrawerId: "ev_review",
    });

    await client.adoptConclusion("/tmp/ws", "kn_1", "checked it myself");

    expect(invoke).toHaveBeenCalledWith("memory_adopt", {
      rootPath: "/tmp/ws",
      request: { drawerId: "kn_1", note: "checked it myself" },
    });
  });

  it("names no command belonging to the abandoned model", () => {
    const source = Object.keys(client);

    for (const gone of [
      "getWorkingMemory",
      "setWorkingMemory",
      "appendWorkingMemory",
      "listMemoryInbox",
      "acceptMemoryInbox",
      "rejectMemoryInbox",
      "listMemoryThreads",
      "rebuildMemoryIndex",
      "dryRunMemoryStorageMigration",
      "runMemoryStorageMigration",
    ]) {
      expect(source).not.toContain(gone);
    }
  });
});
