// @vitest-environment jsdom

import { act, useEffect, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import { documentFingerprint } from "@/features/file-watch/lib/external-change";
import type { FrontendFileWatchEvent } from "@/features/file-watch/lib/types";
import type {
  AppPreferences,
  WorkspaceAction,
  WorkspaceMenuActions,
  WorkspaceState,
} from "../lib/types";
import { WorkspaceShell } from "./workspace-shell";

/**
 * File-safety scenarios for the Milkdown adapter surface driven against a real
 * Workspace session.
 *
 * `EditorStage` is deliberately not mocked: the editor these tests drive is the
 * real adapter, mounted through the real stage, and the session it reports to
 * is the real workspace reducer. Every external change arrives through the real
 * watcher decision path, and every save goes through the real save queue.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();
const draftGet = vi.fn();
const draftDelete = vi.fn();
const draftSave = vi.fn();
const draftListForWorkspace = vi.fn();
const draftCleanupExpired = vi.fn();
const alertDialog = vi.fn(async () => {});
const fileWatch: {
  current: { onEvent: (event: FrontendFileWatchEvent) => void } | null;
} = { current: null };

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
  tauriDialog: async () => ({}),
  tauriWindow: async () => ({
    getCurrentWindow: () => ({
      close: vi.fn(),
      destroy: vi.fn(),
      listen: vi.fn(async () => () => {}),
      onCloseRequested: vi.fn(async () => () => {}),
    }),
  }),
}));

vi.mock("@/common/lib/image-storage", () => ({
  storeImageForWorkspace: vi.fn(async () => ({ url: "", altText: "" })),
  loadImage: vi.fn(async () => ""),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/features/file-watch/hooks/use-file-watch", () => ({
  useFileWatch: (options: {
    onEvent: (event: FrontendFileWatchEvent) => void;
  }) => {
    fileWatch.current = options;
  },
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
  draftDelete: (input: unknown) => draftDelete(input),
  draftGet: (realPath: string) => draftGet(realPath),
  draftListForWorkspace: (rootPath: string) => draftListForWorkspace(rootPath),
  draftSave: (input: unknown) => draftSave(input),
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

vi.mock("./file-tree-panel", () => ({
  // The tree's own menu actions, which the shell folds in beside its own.
  FileTreePanel: ({
    onActionsChange,
  }: {
    onActionsChange: (actions: Record<string, () => Promise<void>>) => void;
  }) => {
    useEffect(() => {
      onActionsChange({
        createFolder: async () => {},
        createMarkdownFile: async () => {},
        renameSelection: async () => {},
        deleteSelection: async () => {},
        refreshTree: async () => {},
      });
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
  TabStrip: () => <div data-mdx-workspace-main-tabs="" data-testid="tabs" />,
}));

const preferences: AppPreferences = {
  fileTreeExcludeDirs: [],
  fileWatchEnabled: true,
  searchMaxFileBytes: 1048576,
  searchMaxResults: 100,
  searchMaxMatchesPerFile: 20,
};

const DISK_MARKDOWN = "# Disk\n";
const EXTERNAL_MARKDOWN = "# External\n";

interface Harness {
  host: HTMLDivElement;
  workspace(): WorkspaceState;
  dispatch(action: WorkspaceAction): void;
  actions(): WorkspaceMenuActions;
  editorText(): string;
  surface(): HTMLElement;
}

function WorkspaceHost({
  initialWorkspace,
  stateRef,
  dispatchRef,
  actionsRef,
}: {
  initialWorkspace: WorkspaceState;
  stateRef: { current: WorkspaceState | null };
  dispatchRef: { current: ((action: WorkspaceAction) => void) | null };
  actionsRef: { current: WorkspaceMenuActions | null };
}) {
  const [workspace, dispatch] = useReducer(workspaceReducer, initialWorkspace);

  useEffect(() => {
    stateRef.current = workspace;
    dispatchRef.current = dispatch;
  });

  return (
    <WorkspaceShell
      workspace={workspace}
      dispatch={dispatch}
      onChooseWorkspace={vi.fn()}
      canChooseWorkspace={true}
      preferences={preferences}
      onPreferencesChange={vi.fn()}
      onActionsChange={(next) => {
        actionsRef.current = next;
      }}
    />
  );
}

function tabsWorkspace(
  tabs: Array<{ tabId: string; path: string; markdown: string }>,
): WorkspaceState {
  return tabs.reduce(
    (state, tab) =>
      workspaceReducer(state, {
        type: "tab/opened",
        tab: {
          tabId: tab.tabId,
          path: tab.path,
          title: tab.path.split("/").at(-1) ?? tab.path,
          dirty: false,
          needsRenameOnFirstSave: false,
          markdown: tab.markdown,
          baseFingerprint: documentFingerprint(tab.markdown),
        },
      }),
    createWorkspaceState("/tmp/ws"),
  );
}

/**
 * jsdom ships no clipboard, so a paste is delivered the way the browser
 * delivers it. This is a genuine user edit made inside the real editor, which
 * is what makes the tab dirty in these scenarios.
 */
function paste(surface: HTMLElement, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: ["text/plain"],
      files: [],
      items: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
      setData: () => {},
    },
  });
  surface.dispatchEvent(event);
}

describe("workspace file safety with the adapter surface", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    fileWatch.current = null;
    invoke.mockImplementation(async (command: string) => {
      if (command === "read_markdown_file") return EXTERNAL_MARKDOWN;
      return undefined;
    });
    draftGet.mockResolvedValue({ draft: null, fileExists: true });
    draftListForWorkspace.mockResolvedValue({ drafts: [] });
    draftCleanupExpired.mockResolvedValue({ deleted: 0 });
    draftDelete.mockResolvedValue(undefined);
    draftSave.mockResolvedValue(undefined);
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
    vi.unstubAllEnvs();
  });

  async function mountWorkspace(
    tabs: Array<{ tabId: string; path: string; markdown: string }> = [
      { tabId: "tab-1", path: "/tmp/ws/note.md", markdown: DISK_MARKDOWN },
    ],
  ): Promise<Harness> {
    const stateRef: { current: WorkspaceState | null } = { current: null };
    const dispatchRef: { current: ((action: WorkspaceAction) => void) | null } =
      { current: null };
    const actionsRef: { current: WorkspaceMenuActions | null } = {
      current: null,
    };

    await act(async () => {
      root.render(
        <WorkspaceHost
          initialWorkspace={tabsWorkspace(tabs)}
          stateRef={stateRef}
          dispatchRef={dispatchRef}
          actionsRef={actionsRef}
        />,
      );
      await flushPromises();
    });

    return {
      host,
      workspace() {
        const workspace = stateRef.current;
        if (!workspace) throw new Error("workspace host did not mount");
        return workspace;
      },
      dispatch(action) {
        dispatchRef.current?.(action);
      },
      actions() {
        const actions = actionsRef.current;
        if (!actions) throw new Error("workspace actions were never published");
        return actions;
      },
      editorText() {
        return (
          host.querySelector("[data-mdx-markdown-editor]")?.textContent ?? ""
        );
      },
      surface() {
        const surface = host.querySelector<HTMLElement>(".ProseMirror");
        if (!surface) throw new Error("editing surface did not mount");
        return surface;
      },
    };
  }

  it("mounts the adapter surface for a markdown tab", async () => {
    const harness = await mountWorkspace();

    expect(harness.editorText()).toContain("Disk");
  });

  it("accepts an external change on a clean tab and moves the clean baseline", async () => {
    const harness = await mountWorkspace();

    await act(async () => {
      fileWatch.current?.onEvent({
        kind: "changed",
        watchId: "watch-1",
        path: "/tmp/ws/note.md",
        eventTime: "2026-08-13T00:00:00Z",
        fingerprint: documentFingerprint(EXTERNAL_MARKDOWN),
      });
      await flushPromises();
    });

    const tab = harness.workspace().tabs["tab-1"];
    expect(tab.markdown).toBe(EXTERNAL_MARKDOWN);
    expect(tab.dirty).toBe(false);
    expect(tab.baseFingerprint).toBe(documentFingerprint(EXTERNAL_MARKDOWN));
    expect(harness.editorText()).toContain("External");
    expect(harness.editorText()).not.toContain("Disk");
  });

  it("keeps the user's edits when an external change arrives on a dirty tab", async () => {
    const harness = await mountWorkspace();

    await act(async () => {
      paste(harness.surface(), "USER-EDIT");
      await flushPromises();
    });
    expect(harness.workspace().tabs["tab-1"].dirty).toBe(true);

    await act(async () => {
      fileWatch.current?.onEvent({
        kind: "changed",
        watchId: "watch-1",
        path: "/tmp/ws/note.md",
        eventTime: "2026-08-13T00:00:00Z",
        fingerprint: documentFingerprint(EXTERNAL_MARKDOWN),
      });
      await flushPromises();
    });

    const tab = harness.workspace().tabs["tab-1"];
    expect(tab.dirty).toBe(true);
    expect(tab.markdown).toContain("USER-EDIT");
    expect(tab.markdown).not.toContain("External");
    // The conflict is reported, and the disk version only reaches the diff.
    expect(host.textContent).toContain("文件已被外部修改");
    // Scoped to the editor: the diff viewer legitimately shows disk content.
    expect(harness.editorText()).toContain("USER-EDIT");
    expect(harness.editorText()).not.toContain("External");
  });

  it("keeps a recovery draft across a clean reload", async () => {
    draftGet.mockResolvedValue({
      draft: {
        draftId: "draft-1",
        realPath: "/tmp/ws/note.md",
        displayPath: "/tmp/ws/note.md",
        markdown: "# Crash draft",
        baseFingerprint: documentFingerprint(DISK_MARKDOWN),
        mode: "workspace",
        updatedAt: "2026-08-13T00:00:00Z",
      },
      fileExists: true,
    });
    const harness = await mountWorkspace();
    expect(host.textContent).toContain("发现未保存草稿");

    await act(async () => {
      fileWatch.current?.onEvent({
        kind: "changed",
        watchId: "watch-1",
        path: "/tmp/ws/note.md",
        eventTime: "2026-08-13T00:00:00Z",
        fingerprint: documentFingerprint(EXTERNAL_MARKDOWN),
      });
      await flushPromises();
    });

    expect(harness.editorText()).toContain("External");
    expect(draftDelete).not.toHaveBeenCalled();
    expect(host.textContent).toContain("发现未保存草稿");
  });

  it("saves with the last clean fingerprint and preserves everything when the backend rejects", async () => {
    const harness = await mountWorkspace();

    await act(async () => {
      paste(harness.surface(), "USER-EDIT");
      await flushPromises();
    });
    const dirtyMarkdown = harness.workspace().tabs["tab-1"].markdown;

    invoke.mockImplementation(async (command: string) => {
      if (command === "read_markdown_file") return EXTERNAL_MARKDOWN;
      if (command === "write_markdown_file") {
        throw new Error("external_modified");
      }
      return undefined;
    });

    await act(async () => {
      await harness.actions().saveActiveTab();
      await flushPromises();
    });

    const writeCall = invoke.mock.calls.find(
      (call) => call[0] === "write_markdown_file",
    );
    expect(writeCall).toBeDefined();
    expect(writeCall?.[1]).toMatchObject({
      path: "/tmp/ws/note.md",
      content: dirtyMarkdown,
      expectedFingerprint: documentFingerprint(DISK_MARKDOWN),
    });

    const tab = harness.workspace().tabs["tab-1"];
    expect(tab.dirty).toBe(true);
    expect(tab.markdown).toBe(dirtyMarkdown);
    expect(tab.baseFingerprint).toBe(documentFingerprint(DISK_MARKDOWN));
    expect(harness.editorText()).toContain("USER-EDIT");
    expect(draftDelete).not.toHaveBeenCalled();
    expect(alertDialog).toHaveBeenCalled();
  });

  it("keeps a late editor change on the tab that produced it after a fast tab switch", async () => {
    const harness = await mountWorkspace([
      { tabId: "tab-1", path: "/tmp/ws/note.md", markdown: "alpha\n" },
      { tabId: "tab-2", path: "/tmp/ws/other.md", markdown: "beta\n" },
    ]);

    await act(async () => {
      harness.dispatch({ type: "tab/activated", tabId: "tab-1" });
      await flushPromises();
    });
    expect(harness.editorText()).toContain("alpha");

    const surface = harness.surface();
    // Nothing is awaited between the edit and the switch, so the change is
    // still inside the editor when the previous surface is torn down.
    act(() => {
      paste(surface, "LATE-EDIT");
    });
    act(() => {
      harness.dispatch({ type: "tab/activated", tabId: "tab-2" });
    });
    await act(async () => {
      await flushPromises();
    });

    const workspace = harness.workspace();
    expect(workspace.activeTabId).toBe("tab-2");
    expect(workspace.tabs["tab-1"].markdown).toContain("LATE-EDIT");
    expect(workspace.tabs["tab-1"].dirty).toBe(true);
    expect(workspace.tabs["tab-2"].markdown).toBe("beta\n");
    expect(workspace.tabs["tab-2"].dirty).toBe(false);
    expect(harness.editorText()).toContain("beta");
    expect(harness.editorText()).not.toContain("LATE-EDIT");
  });
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
