// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import type { AppPreferences } from "../lib/types";
import { WorkspaceShell } from "./workspace-shell";

/**
 * Read-only publishing, as a Workspace tab reaches it.
 *
 * As in the Document window's case, nothing on the publishing path is stubbed:
 * the real session binding hands a captured revision to the real publishing
 * entry, which lays it out with the real WASM engine. Only the Tauri command
 * channel at the far end is replaced.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, save } = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
}));
const alertDialog = vi.fn(async () => {});

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
  tauriDialog: async () => ({ save }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/features/file-watch/hooks/use-file-watch", () => ({
  useFileWatch: () => undefined,
}));

vi.mock("@/features/llm-wiki", () => ({
  LlmWikiPanel: () => null,
  useLlmWikiWorkspace: () => ({
    status: "idle",
    operations: [],
    operationSummaries: [],
    selectedRawPath: null,
    setSelectedRawPath: vi.fn(),
    startIngest: vi.fn(),
    startQuery: vi.fn(),
    startContextBuild: vi.fn(),
    cancelOperation: vi.fn(),
    retryOperation: vi.fn(),
    refreshStatus: vi.fn(),
    handleRawFileSaved: vi.fn(),
  }),
}));

vi.mock("@/features/memory", () => ({
  MemoryPanel: () => null,
  useMemoryWorkspace: () => ({
    status: null,
    viewState: null,
    hasMemory: false,
    tabs: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    initialize: vi.fn(async () => {}),
  }),
}));

vi.mock("@/features/recovery/hooks/use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    flush: async () => {},
    cancel: () => {},
    createFlushTask: () => async () => {},
  }),
}));

vi.mock("@/features/recovery/lib/draft-client", () => ({
  draftCleanupExpired: vi.fn(async () => ({ deleted: 0 })),
  draftDelete: vi.fn(async () => {}),
  draftGet: vi.fn(async () => ({ draft: null, fileExists: false })),
  draftListForWorkspace: vi.fn(async () => ({ drafts: [] })),
  draftSave: vi.fn(async () => {}),
}));

vi.mock("../hooks/use-panel-resize", () => ({
  usePanelResize: () => ({
    collapsed: false,
    width: 300,
    resizeHandleProps: {},
  }),
}));

vi.mock("../lib/cli-sync", () => ({
  syncCliWorkspaceSnapshot: vi.fn(async () => {}),
}));

vi.mock("./app-dialogs", () => ({
  useAppDialogs: () => ({
    alert: alertDialog,
    choice: vi.fn(),
    confirm: vi.fn(),
    prompt: vi.fn(),
  }),
}));

vi.mock("./editor-stage", () => ({
  EditorStage: ({ activeTab }: { activeTab: { markdown?: string } | null }) => (
    <div data-testid="editor">{activeTab?.markdown ?? ""}</div>
  ),
}));

vi.mock("./file-tree-panel", () => ({
  FileTreePanel: () => <div data-testid="tree" />,
}));

vi.mock("./outline-panel", () => ({
  OutlinePanel: () => <div data-testid="outline" />,
}));

vi.mock("./settings-button", () => ({
  SettingsButton: () => null,
}));

vi.mock("./tab-strip", () => ({
  TabStrip: () => <div data-testid="tabs" />,
}));

import { initializeLayoutWasmForTests } from "../../../packages/mdx-editor/test/layout-wasm-init";

const MARKDOWN = "# Workspace note\n\nA paragraph the exporter must lay out.\n";

function exportCall() {
  return invoke.mock.calls.find(([command]) => command === "layout_export_pdf");
}

function workspaceWithMarkdownTab() {
  return workspaceReducer(createWorkspaceState("/tmp/ws"), {
    type: "tab/opened",
    tab: {
      tabId: "tab-1",
      path: "/tmp/ws/note.md",
      title: "note.md",
      dirty: false,
      needsRenameOnFirstSave: false,
      markdown: MARKDOWN,
    },
  });
}

describe("publishing a workspace tab's revision", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeAll(() => {
    initializeLayoutWasmForTests();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockImplementation(async (command: string) => {
      if (command === "layout_export_pdf") {
        return { pageCount: 2, warnings: [], exportMs: 9 };
      }

      return undefined;
    });
    save.mockResolvedValue("/tmp/ws/note.pdf");
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

  async function mountWorkspace(
    workspace = workspaceWithMarkdownTab(),
  ) {
    await act(async () => {
      root.render(
        <WorkspaceShell
          workspace={workspace}
          dispatch={vi.fn()}
          onChooseWorkspace={vi.fn()}
          canChooseWorkspace={true}
          preferences={preferences}
          onPreferencesChange={vi.fn()}
          onActionsChange={vi.fn()}
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

  it("lays the active tab out and exports it under the workspace root", async () => {
    await mountWorkspace();
    await clickExport();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "/tmp/ws/note.pdf" }),
    );

    const call = exportCall();
    expect(call).toBeDefined();

    const { rootPath, request } = call?.[1] as {
      rootPath: string;
      request: Record<string, unknown>;
    };

    expect(rootPath).toBe("/tmp/ws");
    expect(request.document_id).toBe("tab-1");
    expect(request.revision).toBe(1);
    expect(request.output_path).toBe("/tmp/ws/note.pdf");
    expect(String(request.layout_document_json)).toContain("Workspace note");

    const snapshot = JSON.parse(String(request.layout_snapshot_json)) as {
      revision: number;
      lines: Array<{ textRuns: Array<{ text: string; width: number }> }>;
    };
    expect(snapshot.revision).toBe(1);
    expect(
      snapshot.lines
        .flatMap((line) => line.textRuns)
        .some((run) => run.text.includes("Workspace note") && run.width > 0),
    ).toBe(true);

    expect(alertDialog).not.toHaveBeenCalled();
  });

  it("offers nothing to export when the active tab is not loaded Markdown", async () => {
    await mountWorkspace(
      workspaceReducer(createWorkspaceState("/tmp/ws"), {
        type: "tab/opened",
        tab: {
          tabId: "tab-2",
          path: "/tmp/ws/diagram.png",
          title: "diagram.png",
          dirty: false,
          needsRenameOnFirstSave: false,
        },
      }),
    );

    expect(getButton("导出 PDF").disabled).toBe(true);
  });

  it("reports a refused export", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "layout_export_pdf") {
        throw { error_code: "font_data_unavailable", message: "no font data" };
      }

      return undefined;
    });
    await mountWorkspace();
    await clickExport();

    expect(alertDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "导出 PDF",
        message: expect.stringContaining("font_failed"),
      }),
    );
  });

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

const preferences: AppPreferences = {
  fileTreeExcludeDirs: [],
  fileWatchEnabled: true,
  searchMaxFileBytes: 1048576,
  searchMaxResults: 100,
  searchMaxMatchesPerFile: 20,
};
