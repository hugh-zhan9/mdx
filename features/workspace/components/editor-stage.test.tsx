// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorStage } from "./editor-stage";
import type { WorkspaceTab } from "../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
}));

vi.mock("./html-preview", () => ({
  HtmlPreview: ({ path }: { path: string }) => (
    <div data-testid="html-preview">{path}</div>
  ),
}));

vi.mock("@/features/editor/components/editor-pane", () => ({
  EditorPane: () => <div data-testid="markdown-editor" />,
}));

describe("EditorStage preview routing", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    invoke.mockResolvedValue("plain text");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("routes mhtml files to HtmlPreview instead of TextPreview", async () => {
    await renderStage({
      tabId: "tab-1",
      path: "/tmp/ws/archive.mhtml",
      title: "archive.mhtml",
      dirty: false,
      needsRenameOnFirstSave: false,
    });

    expect(host.querySelector("[data-testid='html-preview']")).not.toBeNull();
    expect(host.querySelector("pre")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith(
      "read_preview_text_file",
      expect.anything(),
    );
  });

  it("keeps txt files on TextPreview", async () => {
    await renderStage({
      tabId: "tab-2",
      path: "/tmp/ws/notes.txt",
      title: "notes.txt",
      dirty: false,
      needsRenameOnFirstSave: false,
    });

    expect(host.querySelector("[data-testid='html-preview']")).toBeNull();
    expect(host.querySelector("pre")?.textContent).toBe("plain text");
  });

  async function renderStage(activeTab: WorkspaceTab) {
    await act(async () => {
      root.render(
        <EditorStage
          rootPath="/tmp/ws"
          activeTab={activeTab}
          dispatch={vi.fn()}
          pendingCliCommand={null}
          onPendingCliCommandHandled={vi.fn()}
          onSelectionChange={vi.fn()}
        />,
      );
      await flushPromises();
    });
  }
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
