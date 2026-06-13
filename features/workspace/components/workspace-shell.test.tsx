// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import type { AppPreferences, WorkspaceAction } from "../lib/types";
import { WorkspaceShell } from "./workspace-shell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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

describe("WorkspaceShell draft recovery", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  function getButton(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
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
