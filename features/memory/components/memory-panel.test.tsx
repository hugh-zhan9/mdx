// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "./memory-panel";
import type { GateReport, MemoryStatus, StoredItem } from "../lib/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const memoryClient = vi.hoisted(() => ({
  getMemoryStatus: vi.fn(),
  setMemoryEnabled: vi.fn(),
  listProjects: vi.fn(),
  listStored: vi.fn(),
  checkGate: vi.fn(),
  adoptConclusion: vi.fn(),
  addMaterial: vi.fn(),
  deleteStored: vi.fn(),
  distillConclusion: vi.fn(),
  searchMemory: vi.fn(),
  recall: vi.fn(),
  retireConclusion: vi.fn(),
  addCounterexample: vi.fn(),
  downloadModel: vi.fn(),
  rebuildIndex: vi.fn(),
  getDiagnostics: vi.fn(),
  purgeDeleted: vi.fn(),
  exportBundle: vi.fn(),
  legacyImport: vi.fn(),
  getMemoryIntegrationStatus: vi.fn(),
  repairMemoryIntegration: vi.fn(),
  setupMemoryAgents: vi.fn(),
}));

vi.mock("../lib/memory-client", () => memoryClient);

function status(overrides: Partial<MemoryStatus> = {}): MemoryStatus {
  return {
    enabled: true,
    wing: "notes-9f3c1a",
    library: {
      path: "/home/u/.mdx/memory/palace.db",
      exists: true,
      schemaVersion: 9,
      supportedSchemaVersion: 9,
      writable: true,
      drawerCount: 2,
      embeddingDim: 256,
      error: null,
    },
    modelReady: true,
    model: "minishlab/potion-multilingual-128M",
    ...overrides,
  };
}

function conclusion(overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    drawerId: "kn_1",
    kind: "conclusion",
    room: "review",
    sourceFile: "knowledge://shu/general",
    addedAt: "1786968549",
    importance: 2,
    statement: "PDF export embeds a font subset",
    status: "candidate",
    excerpt: "Exports carry a subset of a system CJK face.",
    ...overrides,
  };
}

function gate(overrides: Partial<GateReport> = {}): GateReport {
  return {
    drawerId: "kn_1",
    tier: "qi",
    status: "candidate",
    targetStatus: "promoted",
    allowed: false,
    reasons: [],
    requirements: {
      minSupportingRefs: 1,
      minVerificationRefs: 1,
      minTeachingRefs: 0,
      reviewerRequired: false,
      counterexamplesBlock: true,
    },
    evidenceCounts: {
      supporting: 1,
      counterexample: 0,
      teaching: 0,
      verification: 0,
    },
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountPanel() {
  await act(async () => {
    root.render(<MemoryPanel rootPath="/tmp/ws" />);
  });
  await flush();
}

function getButton(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) {
    throw new Error(`no button labelled ${label}`);
  }
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  memoryClient.getMemoryStatus.mockResolvedValue(status());
  memoryClient.listProjects.mockResolvedValue([]);
  memoryClient.listStored.mockResolvedValue([]);
  memoryClient.checkGate.mockResolvedValue(gate());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MemoryPanel", () => {
  it("offers the six tabs of the two-layer model", async () => {
    await mountPanel();

    const tabs = Array.from(host.querySelectorAll("[role='tab']")).map(
      (tab) => tab.textContent,
    );

    expect(tabs).toEqual([
      "概览",
      "素材",
      "结论",
      "本次上下文",
      "Agent 集成",
      "诊断",
    ]);
  });

  it("says the model is missing before anything can be written", async () => {
    memoryClient.getMemoryStatus.mockResolvedValue(
      status({ modelReady: false }),
    );

    await mountPanel();

    expect(host.textContent).toContain("还缺一个嵌入模型");
    expect(host.textContent).toContain("直接拒绝写入");
  });

  it("shows the gate's own reasons when adoption is refused", async () => {
    memoryClient.listStored.mockImplementation(async (_root, filter) =>
      filter.kind === "conclusion" ? [conclusion()] : [],
    );
    memoryClient.adoptConclusion.mockRejectedValue({
      error_code: "gate_failed",
      message: "promotion gate failed",
    });
    memoryClient.checkGate.mockResolvedValue(
      gate({
        reasons: ["verification_refs 0 < 1", "counterexample refs block promotion"],
      }),
    );

    await mountPanel();
    await act(async () => {
      getButton("结论").click();
    });
    await flush();
    await act(async () => {
      getButton("采纳").click();
    });
    await flush();

    // The backend's wording reaches the screen unchanged; a summary would leave
    // the user unable to tell what to attach.
    expect(host.textContent).toContain("verification_refs 0 < 1");
    expect(host.textContent).toContain("counterexample refs block promotion");
  });

  it("leaves a refused conclusion exactly where it was", async () => {
    memoryClient.listStored.mockImplementation(async (_root, filter) =>
      filter.kind === "conclusion" ? [conclusion()] : [],
    );
    memoryClient.adoptConclusion.mockRejectedValue({
      error_code: "gate_failed",
      message: "promotion gate failed",
    });

    await mountPanel();
    await act(async () => {
      getButton("结论").click();
    });
    await flush();
    const before = memoryClient.listStored.mock.calls.length;
    await act(async () => {
      getButton("采纳").click();
    });
    await flush();

    // No optimistic move to "adopted": the row still offers adoption.
    expect(host.textContent).toContain("候选");
    expect(getButton("采纳")).toBeDefined();
    expect(memoryClient.listStored.mock.calls.length).toBe(before);
  });

  it("reports where an adoption was recorded when it succeeds", async () => {
    memoryClient.listStored.mockImplementation(async (_root, filter) =>
      filter.kind === "conclusion" ? [conclusion()] : [],
    );
    memoryClient.adoptConclusion.mockResolvedValue({
      drawerId: "kn_1",
      status: "promoted",
      confirmationDrawerId: "ev_review_1",
    });

    await mountPanel();
    await act(async () => {
      getButton("结论").click();
    });
    await flush();
    await act(async () => {
      getButton("采纳").click();
    });
    await flush();

    expect(host.textContent).toContain("ev_review_1");
  });

  it("keeps the storage vocabulary out of the panel", async () => {
    memoryClient.listStored.mockImplementation(async (_root, filter) =>
      filter.kind === "conclusion" ? [conclusion()] : [],
    );

    await mountPanel();

    const text = host.textContent ?? "";
    for (const upstreamWord of ["wing", "drawer", "dao_tian", "dao_ren", "qi", "shu"]) {
      expect(text.toLowerCase()).not.toContain(upstreamWord);
    }
  });
});
