// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import type { AppPreferences, WorkspaceMenuActions } from "../lib/types";
import { WorkspaceShell } from "./workspace-shell";

/**
 * The actions the native File menu reaches, and when the window publishes them.
 *
 * ⌘S has no in-page binding: the keystroke is the menu item's, so the window
 * only saves if the action behind that item is published. It used to be
 * published with the folder tree's own actions, which meant collapsing the
 * sidebar — one click — silently unbound ⌘S. These tests pin that the save and
 * close actions are the window's, not the tree's.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, panel } = vi.hoisted(() => ({
  invoke: vi.fn(),
  panel: { navigatorCollapsed: false },
}));
const treeMounts = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
  tauriDialog: async () => ({ save: vi.fn() }),
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
  draftGet: vi.fn(async () => ({ draft: null, fileExists: true })),
  draftListForWorkspace: vi.fn(async () => ({ drafts: [] })),
  draftSave: vi.fn(async () => {}),
}));

// The real hook reads the collapsed flag out of the workspace panel state, which
// is persisted; this stub is the same flag, so a test can start collapsed the
// way a returning user does.
vi.mock("../hooks/use-panel-resize", () => ({
  usePanelResize: () => ({
    width: 300,
    isCollapsed: panel.navigatorCollapsed,
    setCollapsed: vi.fn(),
    toggleCollapsed: vi.fn(),
    resizeHandleProps: {},
  }),
}));

vi.mock("../lib/cli-sync", () => ({
  syncCliWorkspaceSnapshot: vi.fn(async () => {}),
}));

vi.mock("./app-dialogs", () => ({
  useAppDialogs: () => ({
    alert: vi.fn(async () => {}),
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
  // Publishing on mount and withdrawing on unmount is what the real panel does,
  // and withdrawing is the half that used to take ⌘S with it.
  FileTreePanel: ({
    onActionsChange,
  }: {
    onActionsChange: (
      actions: Record<string, () => Promise<void>> | null,
    ) => void;
  }) => {
    useEffect(() => {
      treeMounts();
      onActionsChange({
        createFolder: async () => {},
        createMarkdownFile: async () => {},
        renameSelection: async () => {},
        deleteSelection: async () => {},
        refreshTree: async () => {},
      });

      return () => onActionsChange(null);
    }, [onActionsChange]);
    return <div data-testid="tree" />;
  },
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

const MARKDOWN = "# Note\n\nEdited in the window.\n";

function workspaceWithMarkdownTab() {
  return workspaceReducer(createWorkspaceState("/tmp/ws"), {
    type: "tab/opened",
    tab: {
      tabId: "tab-1",
      path: "/tmp/ws/note.md",
      title: "note.md",
      dirty: true,
      needsRenameOnFirstSave: false,
      markdown: MARKDOWN,
    },
  });
}

describe("the window's File menu actions", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    panel.navigatorCollapsed = false;
    invoke.mockResolvedValue(undefined);
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

  async function mountWorkspace(): Promise<WorkspaceMenuActions> {
    const actionsRef: { current: WorkspaceMenuActions | null } = {
      current: null,
    };

    await act(async () => {
      root.render(
        <WorkspaceShell
          workspace={workspaceWithMarkdownTab()}
          dispatch={vi.fn()}
          onChooseWorkspace={vi.fn()}
          canChooseWorkspace={true}
          preferences={preferences}
          onPreferencesChange={vi.fn()}
          onActionsChange={(next) => {
            actionsRef.current = next;
          }}
        />,
      );
      await flushPromises();
    });

    const actions = actionsRef.current;

    if (!actions) {
      throw new Error("the window published no menu actions");
    }

    return actions;
  }

  it("saves the active tab", async () => {
    const actions = await mountWorkspace();

    await act(async () => {
      await actions.saveActiveTab();
      await flushPromises();
    });

    expect(invoke).toHaveBeenCalledWith(
      "write_markdown_file",
      expect.objectContaining({
        rootPath: "/tmp/ws",
        path: "/tmp/ws/note.md",
        content: MARKDOWN,
      }),
    );
  });

  it("still saves the active tab with the sidebar collapsed", async () => {
    panel.navigatorCollapsed = true;

    const actions = await mountWorkspace();

    // The premise of the regression: with the sidebar collapsed there is no
    // folder tree to publish anything.
    expect(treeMounts).not.toHaveBeenCalled();

    await act(async () => {
      await actions.saveActiveTab();
      await flushPromises();
    });

    expect(invoke).toHaveBeenCalledWith(
      "write_markdown_file",
      expect.objectContaining({
        rootPath: "/tmp/ws",
        path: "/tmp/ws/note.md",
        content: MARKDOWN,
      }),
    );
  });
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
