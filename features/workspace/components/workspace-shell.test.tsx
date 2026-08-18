// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import type { AppPreferences, WorkspaceAction } from "../lib/types";
import { WorkspaceShell } from "./workspace-shell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The editor surface as the shell reaches it: a handle it can ask for a mode,
 * and a callback the surface announces the mode it reached through.
 */
const stageMock = vi.hoisted(() => ({
  setMode: vi.fn(async () => undefined),
  announceMode: null as ((mode: "wysiwyg" | "source") => void) | null,
}));

const draftGet = vi.fn();
const draftListForWorkspace = vi.fn();
const draftCleanupExpired = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({
    invoke: vi.fn(async () => undefined),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/features/file-watch/hooks/use-file-watch", () => ({
  useFileWatch: () => undefined,
}));

vi.mock("@/features/llm-wiki", () => ({
  LlmWikiPanel: () => <div data-testid="llm-wiki-page">LLM Wiki 页面</div>,
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
  MemoryPanel: () => <div data-testid="memory-page">记忆页面</div>,
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
  draftCleanupExpired: (retentionDays: number) =>
    draftCleanupExpired(retentionDays),
  draftDelete: vi.fn(),
  draftGet: (realPath: string) => draftGet(realPath),
  draftListForWorkspace: (rootPath: string) => draftListForWorkspace(rootPath),
  draftSave: vi.fn(),
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
    alert: vi.fn(),
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
  TabStrip: () => <div data-mdx-workspace-main-tabs="" data-testid="tabs" />,
}));

describe("WorkspaceShell", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    draftGet.mockResolvedValue({ draft: null, fileExists: false });
    draftListForWorkspace.mockResolvedValue({ drafts: [] });
    draftCleanupExpired.mockResolvedValue({ deleted: 0 });
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

  it("opens a readonly diff for an active recovered draft", async () => {
    draftGet.mockResolvedValueOnce({
      draft: {
        draftId: "draft-1",
        realPath: "/tmp/ws/note.md",
        displayPath: "/tmp/ws/note.md",
        markdown: "# Crash draft",
        baseFingerprint: "fingerprint-disk",
        mode: "workspace",
        updatedAt: "2026-06-11T00:00:00Z",
      },
      fileExists: true,
    });
    let workspace = workspaceReducer(createWorkspaceState("/tmp/ws"), {
      type: "tab/opened",
      tab: {
        tabId: "tab-1",
        path: "/tmp/ws/note.md",
        title: "note.md",
        dirty: false,
        needsRenameOnFirstSave: false,
        markdown: "# Disk",
      },
    });
    const dispatch = (action: WorkspaceAction) => {
      workspace = workspaceReducer(workspace, action);
    };

    await act(async () => {
      root.render(
        <WorkspaceShell
          workspace={workspace}
          dispatch={dispatch}
          onChooseWorkspace={vi.fn()}
          canChooseWorkspace={true}
          preferences={preferences}
          onPreferencesChange={vi.fn()}
          onActionsChange={vi.fn()}
        />,
      );
      await flushPromises();
    });

    expect(host.textContent).toContain("发现未保存草稿");
    expect(host.textContent).toContain("查看差异");

    await act(async () => {
      getButton("查看差异").click();
      await flushPromises();
    });

    expect(host.textContent).toContain("草稿差异");
    expect(host.textContent).toContain("磁盘版本");
    expect(host.textContent).toContain("草稿");
    expect(host.textContent).toContain("# Crash draft");
  });

  it("opens memory as a standalone workspace view", async () => {
    let workspace = workspaceReducer(createWorkspaceState("/tmp/ws"), {
      type: "tab/opened",
      tab: {
        tabId: "tab-1",
        path: "/tmp/ws/note.md",
        title: "note.md",
        dirty: false,
        needsRenameOnFirstSave: false,
        markdown: "# Note",
      },
    });
    const dispatch = (action: WorkspaceAction) => {
      workspace = workspaceReducer(workspace, action);
    };

    await act(async () => {
      root.render(
        <WorkspaceShell
          workspace={workspace}
          dispatch={dispatch}
          onChooseWorkspace={vi.fn()}
          canChooseWorkspace={true}
          preferences={preferences}
          onPreferencesChange={vi.fn()}
          onActionsChange={vi.fn()}
        />,
      );
      await flushPromises();
    });

    expect(host.querySelector("[data-testid='editor']")).not.toBeNull();
    expect(host.querySelector("[data-testid='memory-page']")).toBeNull();
    expect(
      host.querySelector("[data-mdx-workspace-navigator]"),
    ).not.toBeNull();

    await act(async () => {
      getButton("记忆").click();
      await flushPromises();
    });

    // A full-window view: the editor and both side panels give way to it.
    expect(host.querySelector("[data-testid='editor']")).toBeNull();
    expect(host.querySelector("[data-testid='memory-page']")).not.toBeNull();
    expect(host.querySelector("[data-mdx-workspace-navigator]")).toBeNull();
    // The window says which view it is showing, and the view's own button
    // becomes the way to close it.
    expect(host.textContent).toContain("记忆");
    expect(getButton("返回编辑器")).toBeTruthy();

    await act(async () => {
      getButton("返回编辑器").click();
      await flushPromises();
    });

    expect(host.querySelector("[data-testid='memory-page']")).toBeNull();
    expect(host.querySelector("[data-testid='editor']")).not.toBeNull();
    // Everything the view had replaced comes back with it.
    expect(
      host.querySelector("[data-mdx-workspace-navigator]"),
    ).not.toBeNull();
  });

  it("opens LLM Wiki as a standalone workspace view", async () => {
    // It used to be a tab inside the right panel, sharing about seven hundred
    // pixels with the outline. It is a workspace-level tool, so it now takes the
    // window the way memory does.
    let workspace = workspaceReducer(createWorkspaceState("/tmp/ws"), {
      type: "tab/opened",
      tab: {
        tabId: "tab-1",
        path: "/tmp/ws/note.md",
        title: "note.md",
        dirty: false,
        needsRenameOnFirstSave: false,
        markdown: "# Note",
      },
    });
    const dispatch = (action: WorkspaceAction) => {
      workspace = workspaceReducer(workspace, action);
    };

    await act(async () => {
      root.render(
        <WorkspaceShell
          workspace={workspace}
          dispatch={dispatch}
          onChooseWorkspace={vi.fn()}
          canChooseWorkspace={true}
          preferences={preferences}
          onPreferencesChange={vi.fn()}
          onActionsChange={vi.fn()}
        />,
      );
      await flushPromises();
    });

    expect(host.querySelector("[data-testid='llm-wiki-page']")).toBeNull();

    await act(async () => {
      getButton("LLM Wiki").click();
      await flushPromises();
    });

    expect(host.querySelector("[data-testid='llm-wiki-page']")).not.toBeNull();
    expect(host.querySelector("[data-testid='editor']")).toBeNull();
    expect(host.textContent).toContain("LLM Wiki");
    expect(getButton("返回编辑器")).toBeTruthy();

    await act(async () => {
      getButton("返回编辑器").click();
      await flushPromises();
    });

    expect(host.querySelector("[data-testid='llm-wiki-page']")).toBeNull();
    expect(host.querySelector("[data-testid='editor']")).not.toBeNull();
  });

  it("renders macos workspace chrome regions", async () => {
    const workspace = workspaceReducer(createWorkspaceState("/tmp/ws"), {
      type: "tab/opened",
      tab: {
        tabId: "tab-1",
        path: "/tmp/ws/note.md",
        title: "note.md",
        dirty: false,
        needsRenameOnFirstSave: false,
        markdown: "# Note",
      },
    });

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

    expect(host.querySelector("[data-mdx-workspace-toolbar]")).not.toBeNull();
    expect(host.querySelector("[data-mdx-workspace-main-tabs]")).not.toBeNull();
    // Two columns: the navigator, which holds the groups, the folders and the
    // note list, and the editor. The outline lives inside the navigator now, so
    // there is no third column and no tab bar in one.
    expect(host.querySelector("[data-mdx-right-panel-tabs]")).toBeNull();
    expect(
      host.querySelector("[data-mdx-workspace-navigator]"),
    ).not.toBeNull();
  });

  it("lets the window be dragged by its toolbar", async () => {
    // The title bar is an overlay with no native bar behind it, so the window
    // can only be moved by an element carrying this attribute. Without it the
    // application cannot be moved at all — a whole-window failure that no other
    // assertion here would notice, since everything still renders and works.
    await act(async () => {
      root.render(
        <WorkspaceShell
          workspace={createWorkspaceState("/tmp/ws")}
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

    const toolbar = host.querySelector("[data-mdx-workspace-toolbar]");
    expect(toolbar?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("asks the editor for the other surface rather than switching by itself", async () => {
    await renderWithLoadedTab();

    expect(getButton("可视模式").getAttribute("aria-pressed")).toBe("true");
    expect(getButton("源码模式").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      getButton("源码模式").click();
      await flushPromises();
    });

    expect(stageMock.setMode).toHaveBeenCalledTimes(1);
    expect(stageMock.setMode).toHaveBeenCalledWith("source");
  });

  it("shows the mode the editor reached, not the one that was asked for", async () => {
    await renderWithLoadedTab();

    // The adapter is allowed to refuse a switch. Until it announces a mode,
    // the control must keep showing the surface the document is actually on,
    // or the toolbar is describing an editor that does not exist.
    await act(async () => {
      getButton("源码模式").click();
      await flushPromises();
    });

    expect(getButton("可视模式").getAttribute("aria-pressed")).toBe("true");
    expect(getButton("源码模式").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      stageMock.announceMode?.("source");
      await flushPromises();
    });

    expect(getButton("源码模式").getAttribute("aria-pressed")).toBe("true");
    expect(getButton("可视模式").getAttribute("aria-pressed")).toBe("false");
  });

  async function renderWithLoadedTab() {
    let workspace = workspaceReducer(createWorkspaceState("/tmp/ws"), {
      type: "tab/opened",
      tab: {
        tabId: "tab-1",
        path: "/tmp/ws/note.md",
        title: "note.md",
        dirty: false,
        needsRenameOnFirstSave: false,
        markdown: "# Note",
      },
    });
    const dispatch = (action: WorkspaceAction) => {
      workspace = workspaceReducer(workspace, action);
    };

    await act(async () => {
      root.render(
        <WorkspaceShell
          workspace={workspace}
          dispatch={dispatch}
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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const preferences: AppPreferences = {
  fileTreeExcludeDirs: [],
  fileWatchEnabled: true,
  searchMaxFileBytes: 1048576,
  searchMaxResults: 100,
  searchMaxMatchesPerFile: 20,
};
