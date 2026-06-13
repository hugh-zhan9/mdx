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
      { id: "recall", label: "Recall", disabled: false },
      { id: "working", label: "Working", disabled: false },
      { id: "memories", label: "Memories", disabled: false },
      { id: "inbox", label: "Inbox", disabled: false },
      { id: "threads", label: "Threads", disabled: false },
      { id: "settings", label: "Settings", disabled: false },
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

  it("renders the memory panel tabs", () => {
    act(() => {
      root.render(<MemoryPanel rootPath="/tmp/ws" />);
    });

    const buttons = Array.from(host.querySelectorAll("button")).map((button) =>
      button.textContent?.trim(),
    );

    expect(buttons).toEqual(
      expect.arrayContaining([
        "Recall",
        "Working",
        "Memories",
        "Inbox",
        "Threads",
        "Settings",
      ]),
    );
  });
});
