// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorStage } from "./editor-stage";
import type { WorkspaceTab } from "../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();
const imageStorageMocks = vi.hoisted(() => ({
  storeImageForWorkspace: vi.fn(),
}));
const editorPaneMock = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
}));

vi.mock("@/common/lib/image-storage", () => ({
  storeImageForWorkspace: imageStorageMocks.storeImageForWorkspace,
}));

vi.mock("./html-preview", () => ({
  HtmlPreview: ({ path }: { path: string }) => (
    <div data-testid="html-preview">{path}</div>
  ),
}));

vi.mock("@/features/editor/components/editor-pane", () => ({
  EditorPane: (props: Record<string, unknown>) => {
    editorPaneMock.props.push(props);
    return <div data-testid="markdown-editor" />;
  },
}));

describe("EditorStage preview routing", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    invoke.mockResolvedValue("plain text");
    imageStorageMocks.storeImageForWorkspace.mockResolvedValue({
      altText: "clip.png",
      storedPath: "/tmp/ws/.assets/clip.png",
      url: ".assets/clip.png",
      usedFallback: false,
    });
    editorPaneMock.props = [];
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

  it("enables workspace image paste storage for markdown tabs", async () => {
    await renderStage({
      tabId: "tab-3",
      path: "/tmp/ws/Purpose.md",
      title: "Purpose.md",
      dirty: false,
      needsRenameOnFirstSave: false,
      markdown: "",
    });

    const props = editorPaneMock.props.at(-1);
    const storeImage = props?.storeImage as
      | ((file: File) => Promise<unknown>)
      | undefined;
    const file = new File(["image"], "clip.png", { type: "image/png" });

    expect(storeImage).toBeTypeOf("function");
    await storeImage?.(file);

    expect(imageStorageMocks.storeImageForWorkspace).toHaveBeenCalledWith(
      file,
      {
        currentFilePath: "/tmp/ws/Purpose.md",
        rootPath: "/tmp/ws",
      },
    );
  });

  it("routes markdown tabs to the hybrid editor host", async () => {
    await renderStage({
      tabId: "tab-4",
      path: "/tmp/ws/note.md",
      title: "note.md",
      dirty: false,
      needsRenameOnFirstSave: false,
      markdown: "# Note",
    });

    expect(host.querySelector("[data-testid='markdown-editor']")).not.toBeNull();
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
