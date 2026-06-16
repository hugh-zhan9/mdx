// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import { WorkspaceApp } from "./workspace-app";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const onCloseRequested = vi.fn();
const listen = vi.fn(async () => () => {});
const close = vi.fn(async () => {});
const confirm = vi.fn(async () => true);
const destroy = vi.fn(async () => {});
const draftDelete = vi.fn(async () => {});
const useWorkspaceBootstrap = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
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
  syncCliWorkspaceSnapshot: vi.fn(async () => {}),
}));

vi.mock("@/features/recovery/lib/draft-client", () => ({
  draftDelete: (...args: unknown[]) => draftDelete(...args),
}));

vi.mock("./app-dialogs", () => ({
  AppDialogProvider: ({ children }: { children: ReactNode }) => children,
  useAppDialogs: () => ({
    alert: vi.fn(),
    choice: vi.fn(),
    confirm,
    prompt: vi.fn(),
  }),
}));

vi.mock("./settings-button", () => ({
  SettingsButton: () => null,
}));

vi.mock("./workspace-shell", () => ({
  WorkspaceShell: () => <div data-testid="workspace-shell" />,
}));

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

  it("lets Tauri close clean workspace windows without cancelling the close request", async () => {
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

    expect(preventDefault).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
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
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
