// @vitest-environment jsdom

import { act, useEffect } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import { WorkspaceApp } from "./workspace-app";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const onCloseRequested = vi.fn();
const unlisten = vi.fn();
// Typed like the real `listen` so a test can read back the handler a
// subscription registered.
const listen = vi.fn<
    (event: string, handler: () => void) => Promise<() => void>
>(async () => unlisten);
const close = vi.fn(async () => {});
const confirm = vi.fn(async () => true);
const alertDialog = vi.fn(async () => {});
const destroy = vi.fn(async () => {});
const draftDelete = vi.fn(async () => {});
const invoke = vi.fn(async () => {});
const persistCurrentWindowSize = vi.fn(async () => {});
const useWorkspaceBootstrap = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({
    invoke,
  }),
  tauriWindow: async () => ({
    getCurrentWindow: () => ({
      close,
      destroy,
      listen,
      onCloseRequested,
    }),
  }),
}));

vi.mock("../hooks/use-workspace-bootstrap", () => ({
  useWorkspaceBootstrap: () => useWorkspaceBootstrap(),
}));

vi.mock("../lib/cli-sync", () => ({
  syncCliFrontendHeartbeat: vi.fn(async () => {}),
  syncCliWorkspaceSnapshot: vi.fn(async () => {}),
}));

vi.mock("@/features/recovery/lib/draft-client", () => ({
  draftDelete: (...args: unknown[]) => draftDelete(...args),
}));

vi.mock("./app-dialogs", () => ({
  AppDialogProvider: ({ children }: { children: ReactNode }) => children,
  useAppDialogs: () => ({
    alert: alertDialog,
    choice: vi.fn(),
    confirm,
    prompt: vi.fn(),
  }),
}));

vi.mock("./settings-button", () => ({
  SettingsButton: () => null,
}));

vi.mock("./workspace-shell", () => ({
  // The real shell publishes the window's menu actions while it is mounted,
  // which is how the File menu reaches the active tab at all.
  WorkspaceShell: ({
    onActionsChange,
  }: {
    onActionsChange: (actions: typeof menuActions | null) => void;
  }) => {
    useEffect(() => {
      onActionsChange(menuActions);

      return () => onActionsChange(null);
    }, [onActionsChange]);
    return <div data-testid="workspace-shell" />;
  },
}));

const menuActions = {
  saveActiveTab: vi.fn(async () => {}),
  closeActiveTab: vi.fn(async () => {}),
};

describe("WorkspaceApp window close", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    useWorkspaceBootstrap.mockReturnValue({
      status: "ready",
      workspace: createWorkspaceState("/tmp/ws"),
      dispatch: vi.fn(),
      chooseWorkspace: vi.fn(async () => {}),
      canChooseWorkspace: true,
      message: null,
      preferences: {
        fileTreeExcludeDirs: [],
        fileWatchEnabled: true,
        searchMaxFileBytes: 1048576,
        searchMaxResults: 100,
        searchMaxMatchesPerFile: 20,
      },
      updatePreferences: vi.fn(),
      persistCurrentWindowSize,
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

  it("destroys clean workspace windows explicitly", async () => {
    await act(async () => {
      root.render(<WorkspaceApp />);
      await flushPromises();
    });
    const closeHandler = onCloseRequested.mock.calls[0]?.[0];
    const preventDefault = vi.fn();

    await act(async () => {
      closeHandler?.({ preventDefault });
      await flushPromises();
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(persistCurrentWindowSize).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("workspace_close_diagnostic", {
      stage: "close-destroy-clean",
      details: {
        hasWorkspace: true,
      },
    });
  });

  it("destroys dirty workspace windows after the user confirms closing", async () => {
    let workspace = createWorkspaceState("/tmp/ws");
    workspace = workspaceReducer(workspace, {
      type: "tab/opened",
      tab: {
        tabId: "tab-1",
        path: "/tmp/ws/note.md",
        title: "note.md",
        dirty: true,
        needsRenameOnFirstSave: false,
        markdown: "# Draft",
        baseFingerprint: "disk",
      },
    });
    useWorkspaceBootstrap.mockReturnValue({
      status: "ready",
      workspace,
      dispatch: vi.fn(),
      chooseWorkspace: vi.fn(async () => {}),
      canChooseWorkspace: true,
      message: null,
      preferences: {
        fileTreeExcludeDirs: [],
        fileWatchEnabled: true,
        searchMaxFileBytes: 1048576,
        searchMaxResults: 100,
        searchMaxMatchesPerFile: 20,
      },
      updatePreferences: vi.fn(),
      persistCurrentWindowSize,
    });
    await act(async () => {
      root.render(<WorkspaceApp />);
      await flushPromises();
    });
    const closeHandler = onCloseRequested.mock.calls[0]?.[0];
    const preventDefault = vi.fn();

    await act(async () => {
      closeHandler?.({ preventDefault });
      await flushPromises();
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(draftDelete).toHaveBeenCalledWith({ realPath: "/tmp/ws/note.md" });
    expect(persistCurrentWindowSize).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("workspace_close_diagnostic", {
      stage: "close-prevented-dirty",
      details: {
        dirtyTabCount: 1,
      },
    });
    expect(invoke).toHaveBeenCalledWith("workspace_close_diagnostic", {
      stage: "close-destroy-start",
      details: {
        dirtyTabCount: 1,
      },
    });
  });

  it("stops closing and reports when discarding drafts fails", async () => {
    let workspace = createWorkspaceState("/tmp/ws");
    workspace = workspaceReducer(workspace, {
      type: "tab/opened",
      tab: {
        tabId: "tab-1",
        path: "/tmp/ws/note.md",
        title: "note.md",
        dirty: true,
        needsRenameOnFirstSave: false,
        markdown: "# Draft",
        baseFingerprint: "disk",
      },
    });
    useWorkspaceBootstrap.mockReturnValue({
      status: "ready",
      workspace,
      dispatch: vi.fn(),
      chooseWorkspace: vi.fn(async () => {}),
      canChooseWorkspace: true,
      message: null,
      preferences: {
        fileTreeExcludeDirs: [],
        fileWatchEnabled: true,
        searchMaxFileBytes: 1048576,
        searchMaxResults: 100,
        searchMaxMatchesPerFile: 20,
      },
      updatePreferences: vi.fn(),
      persistCurrentWindowSize,
    });
    draftDelete.mockRejectedValueOnce(new Error("draft store is locked"));
    await act(async () => {
      root.render(<WorkspaceApp />);
      await flushPromises();
    });
    const closeHandler = onCloseRequested.mock.calls[0]?.[0];

    await act(async () => {
      closeHandler?.({ preventDefault: vi.fn() });
      await flushPromises();
    });

    expect(draftDelete).toHaveBeenCalledWith({ realPath: "/tmp/ws/note.md" });
    expect(destroy).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(persistCurrentWindowSize).not.toHaveBeenCalled();
    expect(alertDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "关闭窗口" }),
    );
  });
});

describe("WorkspaceApp native menu events", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  /*
   * The real bootstrap hook rebuilds its choose-workspace handler whenever the
   * workspace state changes, so an edit hands the component both a new state and
   * a new handler identity. That is what this returns.
   */
  function bootstrapValue(markdown: string) {
    return {
      status: "ready",
      workspace: workspaceReducer(createWorkspaceState("/tmp/ws"), {
        type: "tab/opened",
        tab: {
          tabId: "tab-1",
          path: "/tmp/ws/note.md",
          title: "note.md",
          dirty: true,
          needsRenameOnFirstSave: false,
          markdown,
          baseFingerprint: "disk",
        },
      }),
      dispatch: vi.fn(),
      chooseWorkspace: vi.fn(async () => {}),
      canChooseWorkspace: true,
      message: null,
      preferences: {
        fileTreeExcludeDirs: [],
        fileWatchEnabled: true,
        searchMaxFileBytes: 1048576,
        searchMaxResults: 100,
        searchMaxMatchesPerFile: 20,
      },
      updatePreferences: vi.fn(),
      persistCurrentWindowSize,
    };
  }

  function saveSubscriptions() {
    return listen.mock.calls.filter(([event]) => event === "mdx-menu-save");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    useWorkspaceBootstrap.mockReturnValue(bootstrapValue("# Draft"));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("keeps its one File menu subscription across an edit", async () => {
    await act(async () => {
      root.render(<WorkspaceApp />);
      await flushPromises();
    });

    expect(saveSubscriptions()).toHaveLength(1);

    // The edit. `listen` is an IPC round trip, so a window that re-subscribes
    // here has no menu listeners at all until it returns — and ⌘S pressed in
    // that gap does nothing, silently.
    useWorkspaceBootstrap.mockReturnValue(bootstrapValue("# Draft edited"));
    await act(async () => {
      root.render(<WorkspaceApp />);
      await flushPromises();
    });

    expect(saveSubscriptions()).toHaveLength(1);
    expect(unlisten).not.toHaveBeenCalled();

    const handler = saveSubscriptions()[0]?.[1];
    await act(async () => {
      handler?.();
      await flushPromises();
    });

    expect(menuActions.saveActiveTab).toHaveBeenCalledOnce();
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
