// @vitest-environment jsdom

import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarkdownOutlineHeading } from "@/features/workspace/lib/types";
import { DocumentShell } from "./document-shell";

/**
 * Outline navigation for the Document window.
 *
 * The editor surface is navigated by the heading's own Markdown source range,
 * which the window can only ask for through the handle the surface publishes —
 * a window that mounts the surface without a ref would silently navigate
 * nowhere, so the mount and the request are asserted together.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const surfaceMock = vi.hoisted(() => ({
    reveal: vi.fn(async () => ({ ok: true as const })),
}));

const readDocumentFile = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
    tauriCore: async () => ({ invoke: async () => undefined }),
    tauriDialog: async () => ({}),
    tauriWindow: async () => ({
        getCurrentWindow: () => ({
            close: vi.fn(async () => {}),
            destroy: vi.fn(async () => {}),
            listen: vi.fn(async () => () => {}),
            onCloseRequested: vi.fn(async () => () => {}),
        }),
    }),
}));

vi.mock("@/common/lib/image-storage", () => ({
    storeImageForDocument: vi.fn(async () => ""),
    loadImage: vi.fn(async () => ""),
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
    draftDelete: vi.fn(async () => undefined),
    draftGet: vi.fn(async () => ({ draft: null, fileExists: true })),
}));

vi.mock("@/features/workspace/components/app-dialogs", () => ({
    useAppDialogs: () => ({
        alert: vi.fn(async () => {}),
        choice: vi.fn(async () => "discard"),
    }),
}));

/**
 * Stands in for the adapter surface and publishes its handle through the ref
 * the window hands it, exactly as the real surface does. A window that mounts
 * the surface without a ref leaves this handle unreachable.
 */
vi.mock("@/features/editor/components/markdown-editor-surface", () => ({
    MarkdownEditorSurface: forwardRef<{ reveal: typeof surfaceMock.reveal }>(
        function MarkdownEditorSurfaceStub(_props, ref) {
            useImperativeHandle(ref, () => ({ reveal: surfaceMock.reveal }), []);
            return <div data-testid="adapter-surface" />;
        },
    ),
}));

vi.mock("@/features/workspace/components/outline-panel", () => ({
    OutlinePanel: ({
        headings = [],
        onHeadingClick,
    }: {
        headings?: MarkdownOutlineHeading[];
        onHeadingClick?: (heading: MarkdownOutlineHeading) => void;
    }) => (
        <div data-testid="outline">
            {headings.map((heading) => (
                <button
                    key={heading.id}
                    type="button"
                    data-testid={`outline-${heading.id}`}
                    onClick={() => onHeadingClick?.(heading)}
                >
                    {heading.text}
                </button>
            ))}
        </div>
    ),
}));

vi.mock("../lib/document-client", () => ({
    isWorkspacePathDirty: vi.fn(async () => false),
    overwriteDocumentFile: vi.fn(async () => undefined),
    readDocumentFile: (realPath: string) => readDocumentFile(realPath),
    saveDocumentFile: vi.fn(async () => undefined),
}));

const MARKDOWN = "# Alpha\n\nbody text\n\n## Beta heading\n\ntail\n";

describe("document outline navigation", () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        vi.clearAllMocks();
        surfaceMock.reveal.mockResolvedValue({ ok: true });
        readDocumentFile.mockResolvedValue({
            content: MARKDOWN,
            displayPath: "/tmp/note.md",
            fileName: "note.md",
            fingerprint: "fingerprint-disk",
            realPath: "/tmp/note.md",
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

    async function mount() {
        await act(async () => {
            root.render(
                <DocumentShell
                    session={{
                        kind: "document",
                        fileName: "note.md",
                        displayPath: "/tmp/note.md",
                        realPath: "/tmp/note.md",
                        workspaceDirty: false,
                    }}
                />,
            );
            await flushPromises();
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
        expect(host.querySelector("[data-testid='adapter-surface']")).not.toBeNull();

        clickHeading("beta-heading");

        const anchor = MARKDOWN.indexOf("Beta heading");
        expect(surfaceMock.reveal).toHaveBeenCalledTimes(1);
        expect(surfaceMock.reveal).toHaveBeenCalledWith({
            anchor,
            head: anchor + "Beta heading".length,
        });
    });
});

async function flushPromises() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}
