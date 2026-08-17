// @vitest-environment jsdom

import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorSurface } from "./markdown-editor-surface";
import {
    createEditorSessionBinding,
    type EditorChangeVerdict,
    type EditorSessionBinding,
} from "../lib/editor-session-binding";
import type {
    EditorAdapterDiagnostic,
    EditorReplaceReason,
} from "../../../packages/mdx-editor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(async () => {
    while (mounted.length > 0) {
        const entry = mounted.pop();
        if (!entry) continue;
        await act(async () => {
            entry.root.unmount();
        });
        entry.container.remove();
    }
});

/**
 * The smallest thing that behaves like a file session: it owns canonical
 * Markdown per document, applies only the changes the binding accepted, and
 * declares its own replaces. It performs no file IO and holds no dirty state,
 * which is exactly the boundary this component has to respect.
 */
interface SessionControls {
    show(documentId: string): void;
    /** Session-authored content that declares itself a replace. */
    replace(
        documentId: string,
        markdown: string,
        reason: EditorReplaceReason,
    ): void;
    /** Session-authored content with no declaration at all. */
    setUndeclared(documentId: string, markdown: string): void;
    markdownOf(documentId: string): string | undefined;
}

interface Harness {
    container: HTMLElement;
    binding: EditorSessionBinding;
    controls: SessionControls;
    accepted: Array<{ documentId: string; markdown: string }>;
    rejected: Array<Extract<EditorChangeVerdict, { kind: "reject" }>>;
    diagnostics: EditorAdapterDiagnostic[];
    surface(): HTMLElement;
}

function SessionHost({
    binding,
    initialDocumentId,
    initialDocuments,
    controlsRef,
    accepted,
    rejected,
    diagnostics,
}: {
    binding: EditorSessionBinding;
    initialDocumentId: string;
    initialDocuments: Record<string, string>;
    controlsRef: { current: SessionControls | null };
    accepted: Array<{ documentId: string; markdown: string }>;
    rejected: Array<Extract<EditorChangeVerdict, { kind: "reject" }>>;
    diagnostics: EditorAdapterDiagnostic[];
}) {
    const [documents, setDocuments] =
        useState<Record<string, string>>(initialDocuments);
    const [documentId, setDocumentId] = useState(initialDocumentId);
    const documentsRef = useRef(documents);

    useEffect(() => {
        documentsRef.current = documents;
        controlsRef.current = {
            show: setDocumentId,
            replace(targetId, markdown, reason) {
                binding.declareReplace({ documentId: targetId, markdown, reason });
                setDocuments((current) => ({ ...current, [targetId]: markdown }));
            },
            setUndeclared(targetId, markdown) {
                setDocuments((current) => ({ ...current, [targetId]: markdown }));
            },
            markdownOf: (targetId) => documentsRef.current[targetId],
        };
    }, [binding, controlsRef, documents]);

    return (
        <MarkdownEditorSurface
            session={binding}
            documentId={documentId}
            markdown={documents[documentId] ?? ""}
            onMarkdownChange={(changedDocumentId, markdown) => {
                accepted.push({ documentId: changedDocumentId, markdown });
                setDocuments((current) => ({
                    ...current,
                    [changedDocumentId]: markdown,
                }));
            }}
            onRejectedChange={(verdict) => rejected.push(verdict)}
            onDiagnostic={(diagnostic) => diagnostics.push(diagnostic)}
        />
    );
}

async function mountSession(
    initialDocuments: Record<string, string>,
    initialDocumentId: string,
): Promise<Harness> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    const binding = createEditorSessionBinding();
    const controlsRef: { current: SessionControls | null } = { current: null };
    const accepted: Array<{ documentId: string; markdown: string }> = [];
    const rejected: Array<Extract<EditorChangeVerdict, { kind: "reject" }>> = [];
    const diagnostics: EditorAdapterDiagnostic[] = [];

    await act(async () => {
        root.render(
            <SessionHost
                binding={binding}
                initialDocumentId={initialDocumentId}
                initialDocuments={initialDocuments}
                controlsRef={controlsRef}
                accepted={accepted}
                rejected={rejected}
                diagnostics={diagnostics}
            />,
        );
    });

    return {
        container,
        binding,
        get controls() {
            const controls = controlsRef.current;
            if (!controls) throw new Error("session host did not mount");
            return controls;
        },
        accepted,
        rejected,
        diagnostics,
        surface() {
            const surface = container.querySelector<HTMLElement>(".ProseMirror");
            if (!surface) throw new Error("editing surface did not mount");
            return surface;
        },
    };
}

/**
 * jsdom ships no clipboard, so a paste is delivered the way the browser
 * delivers it: a `paste` event carrying a DataTransfer that ProseMirror reads.
 * This is a genuine user-originated edit through the real editor, not a
 * simulated call into the change callback.
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

describe("markdown editor surface — session ownership", () => {
    it("shows the session's canonical Markdown", async () => {
        const harness = await mountSession({ "tab-a": "# Disk\n" }, "tab-a");

        expect(harness.container.textContent).toContain("Disk");
    });

    it("reports a user edit against the document it belongs to", async () => {
        const harness = await mountSession({ "tab-a": "start\n" }, "tab-a");

        await act(async () => {
            paste(harness.surface(), "TYPED");
        });

        expect(harness.accepted.length).toBeGreaterThan(0);
        expect(harness.accepted.at(-1)?.documentId).toBe("tab-a");
        expect(harness.accepted.at(-1)?.markdown).toContain("TYPED");
        expect(harness.controls.markdownOf("tab-a")).toContain("TYPED");
    });

    it("applies a declared replace to the surface", async () => {
        const harness = await mountSession({ "tab-a": "# Disk\n" }, "tab-a");

        await act(async () => {
            harness.controls.replace("tab-a", "# External\n", "clean-reload");
        });

        expect(harness.container.textContent).toContain("External");
        expect(harness.container.textContent).not.toContain("Disk");
    });

    it("refuses undeclared session content instead of overwriting the surface", async () => {
        const harness = await mountSession({ "tab-a": "# Disk\n" }, "tab-a");

        await act(async () => {
            harness.controls.setUndeclared("tab-a", "# Sneaked in\n");
        });

        expect(harness.container.textContent).toContain("Disk");
        expect(harness.container.textContent).not.toContain("Sneaked in");
        expect(harness.diagnostics.map((entry) => entry.code)).toContain(
            "stale_editor_change",
        );
    });
});

describe("markdown editor surface — stale editor callbacks", () => {
    it("lands a change flushed during a document switch on the document that produced it", async () => {
        const harness = await mountSession(
            { "tab-a": "alpha\n", "tab-b": "beta\n" },
            "tab-a",
        );
        const surface = harness.surface();

        // Two synchronous acts with nothing awaited between them: the edit is
        // still queued inside the editor when the surface is torn down, so the
        // change is flushed while the session already shows the other document.
        act(() => {
            paste(surface, "LATE-A");
        });
        act(() => {
            harness.controls.show("tab-b");
        });
        await act(async () => {});

        expect(harness.accepted.at(-1)?.documentId).toBe("tab-a");
        expect(harness.controls.markdownOf("tab-a")).toContain("LATE-A");
        expect(harness.controls.markdownOf("tab-b")).toBe("beta\n");
        expect(harness.container.textContent).toContain("beta");
        expect(harness.container.textContent).not.toContain("LATE-A");
    });

    it("drops a change for a document the session stopped tracking", async () => {
        const harness = await mountSession(
            { "tab-a": "alpha\n", "tab-b": "beta\n" },
            "tab-a",
        );
        const surface = harness.surface();

        act(() => {
            paste(surface, "CLOSED-A");
        });
        act(() => {
            harness.binding.retain(["tab-b"]);
            harness.controls.show("tab-b");
        });
        await act(async () => {});

        expect(harness.rejected.at(-1)).toEqual({
            kind: "reject",
            code: "unknown_document",
            documentId: "tab-a",
        });
        expect(harness.controls.markdownOf("tab-a")).toBe("alpha\n");
        expect(harness.controls.markdownOf("tab-b")).toBe("beta\n");
    });
});

