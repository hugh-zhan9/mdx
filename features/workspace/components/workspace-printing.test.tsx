// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import type { AppPreferences } from "../lib/types";
import { WorkspaceShell } from "./workspace-shell";

/**
 * Turning a Workspace tab into a PDF, which this app does by printing it.
 *
 * There is no second renderer to stub: the page that prints is the page on
 * screen, so what these tests pin is the toolbar asking for it — and asking for
 * the visual surface first, since a PDF of Markdown source is a picture of the
 * markup rather than the document.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, save } = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
}));
const alertDialog = vi.fn(async () => {});
const stageMock = vi.hoisted(() => ({
  setMode: vi.fn(async () => undefined),
  announceMode: null as ((mode: "wysiwyg" | "source") => void) | null,
}));

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
  EditorStage: ({
    activeTab,
    editorSurfaceRef,
    onModeChange,
  }: {
    activeTab: { markdown?: string } | null;
    editorSurfaceRef?: { current: unknown };
    onModeChange?: (mode: "wysiwyg" | "source") => void;
  }) => {
    if (editorSurfaceRef) {
      editorSurfaceRef.current = {
        reveal: vi.fn(),
        setMode: stageMock.setMode,
      };
    }
    stageMock.announceMode = onModeChange ?? null;
    return <div data-testid="editor">{activeTab?.markdown ?? ""}</div>;
  },
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

const MARKDOWN = "# Workspace note\n\nA paragraph the exporter must lay out.\n";

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

describe("printing a workspace tab", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let print: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue(undefined);
    print = vi.fn();
    Object.defineProperty(window, "print", {
      configurable: true,
      value: print,
    });
    // The command waits a frame so a freshly built surface is in the document.
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
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

  async function mountWorkspace(workspace = workspaceWithMarkdownTab()) {
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

  it("prints the document the window is showing", async () => {
    await mountWorkspace();

    await act(async () => {
      getButton("打印 / 存为 PDF").click();
      await flushPromises();
    });

    expect(print).toHaveBeenCalledTimes(1);
    // Already the visual surface, so nothing had to change first.
    expect(stageMock.setMode).not.toHaveBeenCalled();
  });

  it("asks for the visual surface before printing Markdown source", async () => {
    await mountWorkspace();

    await act(async () => {
      stageMock.announceMode?.("source");
      await flushPromises();
    });

    await act(async () => {
      getButton("打印 / 存为 PDF").click();
      await flushPromises();
    });

    expect(stageMock.setMode).toHaveBeenCalledWith("wysiwyg");
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("has nothing to print when the tab is not loaded Markdown", async () => {
    await mountWorkspace(
      workspaceReducer(createWorkspaceState("/tmp/ws"), {
        type: "tab/opened",
        tab: {
          tabId: "tab-1",
          path: "/tmp/ws/diagram.png",
          title: "diagram.png",
          dirty: false,
          needsRenameOnFirstSave: false,
        },
      }),
    );

    expect(getButton("打印 / 存为 PDF").disabled).toBe(true);
  });

  function getButton(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) =>
        (candidate.getAttribute("aria-label") ??
          candidate.textContent?.trim()) === label,
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
