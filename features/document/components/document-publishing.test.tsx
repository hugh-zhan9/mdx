// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentShell } from "./document-shell";

/**
 * Read-only publishing, as a Document window reaches it.
 *
 * Nothing on the publishing path is stubbed: the button, the session binding,
 * the publishing entry, the read-only layout port and the real WASM layout
 * engine all run, and the only replacement is the Tauri command channel at the
 * far end. So this is evidence that the chain the migration kept is reachable
 * and works, not that a fake one is.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, save } = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
}));
const readDocumentFile = vi.fn();
const saveDocumentFile = vi.fn();
const alertDialog = vi.fn(async () => {});
const listen = vi.fn(async () => () => {});
const onCloseRequested = vi.fn(async () => () => {});

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
  tauriDialog: async () => ({ save }),
  tauriWindow: async () => ({
    getCurrentWindow: () => ({
      close: vi.fn(async () => {}),
      destroy: vi.fn(async () => {}),
      listen,
      onCloseRequested,
    }),
  }),
}));

vi.mock("@/common/lib/image-storage", () => ({
  loadImage: vi.fn(async () => ""),
  storeImageForDocument: vi.fn(async () => ({
    url: "",
    altText: "",
    storedPath: "",
    usedFallback: false,
  })),
}));

vi.mock("@/features/editor/components/markdown-editor-surface", () => ({
  MarkdownEditorSurface: ({ markdown }: { markdown: string }) => (
    <div data-testid="editor">{markdown}</div>
  ),
}));

vi.mock("@/features/file-watch/hooks/use-file-watch", () => ({
  useFileWatch: () => undefined,
}));

vi.mock("@/features/recovery/hooks/use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    flush: async () => {},
    cancel: () => {},
    createFlushTask: () => async () => {},
  }),
}));

vi.mock("@/features/recovery/lib/draft-client", () => ({
  draftDelete: vi.fn(async () => {}),
  draftGet: vi.fn(async () => ({ draft: null, fileExists: true })),
}));

vi.mock("@/features/workspace/components/app-dialogs", () => ({
  useAppDialogs: () => ({ alert: alertDialog, choice: vi.fn() }),
}));

vi.mock("@/features/workspace/components/outline-panel", () => ({
  OutlinePanel: () => <div data-testid="outline" />,
}));

vi.mock("../lib/document-client", () => ({
  isWorkspacePathDirty: vi.fn(async () => false),
  overwriteDocumentFile: vi.fn(),
  readDocumentFile: (realPath: string) => readDocumentFile(realPath),
  saveDocumentFile: (
    realPath: string,
    content: string,
    expectedFingerprint: string,
  ) => saveDocumentFile(realPath, content, expectedFingerprint),
}));

import { initializeLayoutWasmForTests } from "../../../packages/mdx-editor/test/layout-wasm-init";

const MARKDOWN = "# Document title\n\nA paragraph the exporter must lay out.\n";

function exportCall() {
  return invoke.mock.calls.find(([command]) => command === "layout_export_pdf");
}

describe("publishing a document window's revision", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeAll(() => {
    initializeLayoutWasmForTests();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listen.mockResolvedValue(() => {});
    onCloseRequested.mockResolvedValue(() => {});
    readDocumentFile.mockResolvedValue({
      content: MARKDOWN,
      displayPath: "/tmp/notes/note.md",
      fileName: "note.md",
      fingerprint: "fingerprint-disk",
      realPath: "/tmp/notes/note.md",
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === "load_app_state") {
        return {
          preferences: {
            fileTreeExcludeDirs: [],
            fileWatchEnabled: true,
            searchMaxFileBytes: 1048576,
            searchMaxResults: 100,
            searchMaxMatchesPerFile: 20,
          },
        };
      }

      if (command === "layout_export_pdf") {
        return { pageCount: 1, warnings: [], exportMs: 7 };
      }

      return undefined;
    });
    save.mockResolvedValue("/tmp/notes/note.pdf");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  async function mountDocument() {
    await act(async () => {
      root.render(
        <DocumentShell
          session={{
            kind: "document",
            fileName: "note.md",
            displayPath: "/tmp/notes/note.md",
            realPath: "/tmp/notes/note.md",
            workspaceDirty: false,
          }}
        />,
      );
      await flushPromises();
    });
  }

  async function clickExport() {
    await act(async () => {
      getButton("导出 PDF").click();
      await flushPromises();
    });
  }

  it("lays the document out and exports it to the chosen path", async () => {
    await mountDocument();
    await clickExport();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "/tmp/notes/note.pdf" }),
    );

    const call = exportCall();
    expect(call).toBeDefined();

    const { rootPath, request } = call?.[1] as {
      rootPath: string;
      request: Record<string, unknown>;
    };

    // A document window has no workspace root, so relative assets resolve
    // against the file's own folder.
    expect(rootPath).toBe("/tmp/notes");
    expect(request.document_id).toBe("/tmp/notes/note.md");
    expect(request.revision).toBe(1);
    expect(request.output_path).toBe("/tmp/notes/note.pdf");
    expect(String(request.layout_document_json)).toContain("Document title");

    const snapshot = JSON.parse(String(request.layout_snapshot_json)) as {
      revision: number;
      lines: Array<{ textRuns: Array<{ text: string; width: number }> }>;
    };
    expect(snapshot.revision).toBe(1);
    expect(
      snapshot.lines
        .flatMap((line) => line.textRuns)
        .some((run) => run.text.includes("Document title") && run.width > 0),
    ).toBe(true);

    expect(alertDialog).not.toHaveBeenCalled();
  });

  it("exports nothing when the path dialog is cancelled", async () => {
    save.mockResolvedValue(null);
    await mountDocument();
    await clickExport();

    expect(exportCall()).toBeUndefined();
    expect(alertDialog).not.toHaveBeenCalled();
  });

  it("tells the reader when the written file is not what the document says", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "load_app_state") {
        return { preferences: {} };
      }

      if (command === "layout_export_pdf") {
        return {
          pageCount: 1,
          warnings: ["1 characters have no glyph in PingFangSC-Regular and were left blank: ✓"],
          exportMs: 7,
        };
      }

      return undefined;
    });
    await mountDocument();
    await clickExport();

    expect(alertDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "导出 PDF",
        message: expect.stringContaining("no glyph"),
      }),
    );
  });

  it("reports a refused export and leaves the document alone", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "load_app_state") {
        return { preferences: {} };
      }

      if (command === "layout_export_pdf") {
        throw { error_code: "output_path_denied", message: "permission denied" };
      }

      return undefined;
    });
    await mountDocument();
    await clickExport();

    expect(alertDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "导出 PDF",
        message: expect.stringContaining("output_path_denied"),
      }),
    );
    expect(saveDocumentFile).not.toHaveBeenCalled();
    expect(editorText()).toContain("Document title");
    expect(host.textContent).not.toContain("● note.md");
  });

  function editorText() {
    return host.querySelector("[data-testid='editor']")?.textContent ?? "";
  }

  function getButton(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    if (!button) {
      throw new Error(`Expected button "${label}"`);
    }

    return button;
  }
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
