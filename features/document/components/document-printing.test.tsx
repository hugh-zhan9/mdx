// @vitest-environment jsdom

import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentShell } from "./document-shell";

/**
 * Turning a Document window into a PDF, which this app does by printing it.
 *
 * There is no renderer to stub: the page that prints is the page on screen, so
 * what these pin is the toolbar asking for it — and asking for the visual surface
 * first, because a PDF of Markdown source is a picture of the markup rather than
 * of the document.
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
const surfaceMock = vi.hoisted(() => ({
  setMode: vi.fn(async () => undefined),
}));

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
  // Ref-aware, because switching the surface's mode is half of what printing
  // asks for and the handle is where that lives.
  MarkdownEditorSurface: forwardRef<
    { setMode: (mode: string) => Promise<void> },
    { markdown: string }
  >(function Surface({ markdown }, ref) {
    useImperativeHandle(ref, () => ({ setMode: surfaceMock.setMode }));

    return <div data-testid="editor">{markdown}</div>;
  }),
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


const MARKDOWN = "# Document title\n\nA paragraph the print stylesheet lays out.\n";

describe("printing a document window's revision", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const print = vi.fn();

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

      return undefined;
    });
    (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ = {};
    vi.stubGlobal("print", print);
    // Run on request, so the frame the print waits for does not need a timer.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);

      return 0;
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
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

  it("prints the document the window is showing", async () => {
    await mountDocument();

    await act(async () => {
      getButton("打印 / 存为 PDF").click();
      await flushPromises();
    });

    expect(print).toHaveBeenCalledTimes(1);
  });

  it("asks for the visual surface before printing", async () => {
    // The window has no mode control of its own, but the surface answers ⌘⇧M, so
    // it can be showing Markdown source when the button is pressed.
    await mountDocument();

    await act(async () => {
      getButton("打印 / 存为 PDF").click();
      await flushPromises();
    });

    expect(surfaceMock.setMode).toHaveBeenCalledWith("wysiwyg");
  });

  it("has no exporter of its own to fail", async () => {
    // The old path wrote the PDF itself, through a Tauri command. Printing hands
    // the document to the system instead, so nothing is asked of Rust at all.
    await mountDocument();

    await act(async () => {
      getButton("打印 / 存为 PDF").click();
      await flushPromises();
    });

    expect(
      invoke.mock.calls.filter(([command]) => command !== "load_app_state"),
    ).toEqual([]);
    expect(alertDialog).not.toHaveBeenCalled();
  });

  function getButton(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => (candidate.textContent ?? "").includes(label),
    );

    if (!button) {
      throw new Error(`no button says ${label}`);
    }

    return button as HTMLButtonElement;
  }
});

async function flushPromises() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
