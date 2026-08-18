// @vitest-environment jsdom

import { act } from "react";
import type { RefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceState, workspaceReducer } from "../lib/workspace-reducer";
import type {
    AppPreferences,
    MarkdownOutlineHeading,
    WorkspaceAction,
} from "../lib/types";
import type { MarkdownEditorSurfaceHandle } from "@/features/editor/components/markdown-editor-surface";
import { WorkspaceShell } from "./workspace-shell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const stageMock = vi.hoisted(() => ({
    reveal: vi.fn(async () => ({ ok: true as const })),
    setMode: vi.fn(async () => undefined),
}));

vi.mock("@/common/lib/tauri", () => ({
    tauriCore: async () => ({ invoke: vi.fn(async () => undefined) }),
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
    draftDelete: vi.fn(),
    draftGet: vi.fn(async () => ({ draft: null, fileExists: false })),
    draftListForWorkspace: vi.fn(async () => ({ drafts: [] })),
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
    syncCliFrontendHeartbeat: vi.fn(async () => {}),
}));

vi.mock("./app-dialogs", () => ({
    useAppDialogs: () => ({
        alert: vi.fn(),
        choice: vi.fn(),
        confirm: vi.fn(),
        prompt: vi.fn(),
    }),
}));

/**
 * Stands in for the editor stage and publishes a surface handle through the
 * ref the shell hands it, exactly as the real adapter surface does.
 */
vi.mock("./editor-stage", () => ({
    EditorStage: ({
        editorSurfaceRef,
    }: {
        editorSurfaceRef?: RefObject<MarkdownEditorSurfaceHandle | null>;
    }) => {
        if (editorSurfaceRef) {
            editorSurfaceRef.current = {
                reveal: stageMock.reveal,
                setMode: stageMock.setMode,
            };
        }
        return <div data-testid="editor" />;
    },
}));

vi.mock("./file-tree-panel", () => ({
    FileTreePanel: () => <div data-testid="tree" />,
}));

vi.mock("./outline-panel", () => ({
    OutlinePanel: ({
        headings = [],
        onHeadingClick,
    }: {
        headings?: MarkdownOutlineHeading[];
        onHeadingClick?: (
            heading: MarkdownOutlineHeading,
            index: number,
        ) => void;
    }) => (
        <div data-testid="outline">
            {headings.map((heading, index) => (
                <button
                    key={heading.id}
                    type="button"
                    data-testid={`outline-${heading.id}`}
                    onClick={() => onHeadingClick?.(heading, index)}
                >
                    {heading.text}
                </button>
            ))}
        </div>
    ),
}));

vi.mock("./settings-button", () => ({
    SettingsButton: () => null,
}));

vi.mock("./tab-strip", () => ({
    TabStrip: () => <div data-mdx-workspace-main-tabs="" />,
}));

const MARKDOWN = "# Alpha\n\nbody text\n\n## Beta heading\n\ntail\n";

const preferences: AppPreferences = {
    fileTreeExcludeDirs: [],
    fileWatchEnabled: true,
    searchMaxFileBytes: 1048576,
    searchMaxResults: 100,
    searchMaxMatchesPerFile: 20,
};

describe("workspace outline navigation", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        vi.clearAllMocks();
        stageMock.reveal.mockResolvedValue({ ok: true });
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

    async function mount() {
        let workspace = workspaceReducer(createWorkspaceState("/tmp/ws"), {
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
            await Promise.resolve();
        });
    }

    /**
     * The outline shares the navigator's column with the note list, so it has
     * to be the one showing before a heading can be clicked.
     */
    function openOutlineTab() {
        const tab = Array.from(
            host.querySelectorAll<HTMLButtonElement>("button"),
        ).find((candidate) => candidate.textContent === "大纲");
        if (!tab) throw new Error("no outline tab in the navigator");
        act(() => {
            tab.click();
        });
    }

    function clickHeading(id: string) {
        const button = host.querySelector<HTMLButtonElement>(
            `[data-testid='outline-${id}']`,
        );
        if (!button) throw new Error(`no outline entry for ${id}`);
        act(() => {
            button.click();
        });
    }

    it("reveals the heading's Markdown source range through the editor surface", async () => {
        await mount();
        openOutlineTab();

        clickHeading("beta-heading");

        const anchor = MARKDOWN.indexOf("Beta heading");
        expect(stageMock.reveal).toHaveBeenCalledTimes(1);
        expect(stageMock.reveal).toHaveBeenCalledWith({
            anchor,
            head: anchor + "Beta heading".length,
        });
    });
});
