import { describe, expect, it } from "vitest";

import { createEditorSessionBinding } from "./editor-session-binding";
import { exportPublishingPdf } from "../../../packages/mdx-editor/publishing";
import type {
    PublishingErrorCode,
    PublishingLayoutPort,
    PublishingLayoutSnapshot,
    PublishingPageSetup,
    PublishingPdfPayload,
    PublishingPdfTransport,
} from "../../../packages/mdx-editor/publishing";

/**
 * Publishing failures against a live editing session.
 *
 * Each case injects one real failure, proves the failure surfaced, and only
 * then compares the session. The session is a working one: the same test edits
 * it and watches its Markdown, dirty, selection, draft and conflict change, so
 * "unchanged after a publishing failure" is a statement about publishing and
 * not about a session that could not change anyway.
 *
 * The object the export is handed is the session's own state object, wrapped in
 * a proxy that records every write. Publishing therefore has the session in its
 * hands during the whole call, and any write it performs is caught.
 */

const PAGE: PublishingPageSetup = {
    widthPt: 595,
    heightPt: 842,
    marginTopPt: 72,
    marginRightPt: 72,
    marginBottomPt: 72,
    marginLeftPt: 72,
    fontEmbedMode: "subset",
};

interface SessionState {
    documentId: string;
    revision: number;
    markdown: string;
    dirty: boolean;
    selection: { anchor: number; head: number } | null;
    drafts: Record<string, string>;
    conflict: string | null;
    [key: string]: unknown;
}

interface Session {
    /** The state object, wrapped so every write to it is recorded. */
    state: SessionState;
    /** Property writes publishing performed on the state object. */
    writes: string[];
    /** A copy of the state, for comparing before and after. */
    read(): SessionState;
    /** An edit the user made in the editor. */
    type(text: string): void;
    /** An external change that arrived while the user had unsaved edits. */
    conflictWith(markdown: string): void;
}

function openSession(markdown: string): Session {
    const binding = createEditorSessionBinding();
    const writes: string[] = [];
    const opened = binding.snapshotFor({ documentId: "note.md", markdown });
    const raw: SessionState = {
        documentId: opened.documentId,
        revision: opened.revision,
        markdown: opened.markdown,
        dirty: false,
        selection: { anchor: 2, head: 7 },
        drafts: { "note.md": "recovered draft body" },
        conflict: null,
    };
    const state = new Proxy(raw, {
        set(target, key, value, receiver) {
            writes.push(String(key));
            return Reflect.set(target, key, value, receiver);
        },
        deleteProperty(target, key) {
            writes.push(`delete ${String(key)}`);
            return Reflect.deleteProperty(target, key);
        },
    });

    return {
        state,
        writes,
        read() {
            return JSON.parse(JSON.stringify(raw)) as SessionState;
        },
        type(text) {
            const nextMarkdown = raw.markdown + text;
            const verdict = binding.acceptChange({
                documentId: raw.documentId,
                baseRevision: raw.revision,
                markdown: nextMarkdown,
                selection: { anchor: 0, head: 0 },
                origin: "user",
            });

            if (verdict.kind !== "accept") {
                throw new Error(`session refused a user edit: ${verdict.code}`);
            }

            const next = binding.snapshotFor({
                documentId: raw.documentId,
                markdown: verdict.markdown,
            });
            raw.markdown = next.markdown;
            raw.revision = next.revision;
            raw.dirty = true;
            raw.selection = { anchor: nextMarkdown.length, head: nextMarkdown.length };
        },
        conflictWith(externalMarkdown) {
            raw.conflict = externalMarkdown;
        },
    };
}

function layoutPort(
    layout: () => Promise<PublishingLayoutSnapshot>,
): PublishingLayoutPort {
    return { layout };
}

function transportThat(
    answer: PublishingPdfTransport["export"],
): PublishingPdfTransport {
    return { export: answer };
}

function workingLayout(revision: number): PublishingLayoutPort {
    return layoutPort(async () => ({ revision, lines: [], canvasDrawOps: [] }));
}

function exportWith(
    session: Session,
    parts: {
        layout: PublishingLayoutPort;
        transport: PublishingPdfTransport;
        outputPath?: string;
        layoutTimeoutMs?: number;
    },
) {
    return exportPublishingPdf({
        snapshot: session.state,
        rootPath: "/workspace",
        outputPath: parts.outputPath ?? "/workspace/note.pdf",
        viewport: { width: 800, height: 600 },
        page: PAGE,
        layout: parts.layout,
        transport: parts.transport,
        layoutTimeoutMs: parts.layoutTimeoutMs ?? 1000,
    });
}

const NEVER_EXPORTS = transportThat(async () => {
    throw new Error("the transport must not be reached");
});

const FAULTS: Array<{
    name: string;
    code: PublishingErrorCode;
    parts: (session: Session) => {
        layout: PublishingLayoutPort;
        transport: PublishingPdfTransport;
        outputPath?: string;
        layoutTimeoutMs?: number;
    };
}> = [
    {
        name: "a layout that never finishes",
        code: "layout_timeout",
        parts: () => ({
            layout: layoutPort(() => new Promise<PublishingLayoutSnapshot>(() => {})),
            transport: NEVER_EXPORTS,
            layoutTimeoutMs: 10,
        }),
    },
    {
        name: "a layout that crashed",
        code: "layout_failed",
        parts: () => ({
            layout: layoutPort(async () => {
                throw new Error("layout worker died");
            }),
            transport: NEVER_EXPORTS,
        }),
    },
    {
        name: "an image the exporter could not read",
        code: "image_read_failed",
        parts: (session) => ({
            layout: workingLayout(session.state.revision),
            transport: transportThat(async () => ({
                ok: false,
                error: {
                    code: "image_read_failed",
                    message: "image_read_failed: failed to read image asset",
                },
            })),
        }),
    },
    {
        name: "a font the exporter could not use",
        code: "font_failed",
        parts: (session) => ({
            layout: workingLayout(session.state.revision),
            transport: transportThat(async () => ({
                ok: false,
                error: {
                    code: "font_failed",
                    message: "font_data_unavailable: no font data",
                },
            })),
        }),
    },
    {
        name: "an output path the process may not write",
        code: "output_path_denied",
        parts: (session) => ({
            layout: workingLayout(session.state.revision),
            transport: transportThat(async () => ({
                ok: false,
                error: {
                    code: "output_path_denied",
                    message: "output_path_denied: permission denied",
                },
            })),
        }),
    },
    {
        name: "a command channel that threw",
        code: "export_failed",
        parts: (session) => ({
            layout: workingLayout(session.state.revision),
            transport: transportThat(async () => {
                throw new Error("ipc closed");
            }),
        }),
    },
];

describe("the session a publishing failure happened in", () => {
    it("changes when the session itself is used", () => {
        const session = openSession("# Note\n");
        const before = session.read();

        session.type("edited");
        session.conflictWith("# Note from disk\n");

        const after = session.read();
        expect(after).not.toEqual(before);
        expect(after.dirty).toBe(true);
        expect(after.revision).toBe(before.revision + 1);
        expect(after.conflict).toBe("# Note from disk\n");
        expect(after.selection).not.toEqual(before.selection);
    });

    it.each(FAULTS)("survives $name", async ({ code, parts }) => {
        const session = openSession("# Note\n\nBody with ![img](./missing.png).\n");
        session.type(" and unsaved words");
        session.conflictWith("# Note as it is on disk\n");
        const before = session.read();

        const outcome = await exportWith(session, parts(session));

        // Prove the fault fired before claiming anything was preserved.
        expect(outcome.ok).toBe(false);
        if (outcome.ok) {
            throw new Error(`expected ${code} to surface`);
        }
        expect(outcome.error.code).toBe(code);
        expect(outcome.documentId).toBe("note.md");
        expect(outcome.revision).toBe(before.revision);

        expect(session.writes).toEqual([]);
        expect(session.read()).toEqual(before);
    });

    it.each(FAULTS)("can still be edited after $name", async ({ parts }) => {
        const session = openSession("# Note\n");
        const before = session.read();

        const outcome = await exportWith(session, parts(session));
        expect(outcome.ok).toBe(false);

        session.type(" more");

        const after = session.read();
        expect(after.markdown).toBe("# Note\n more");
        expect(after.revision).toBe(before.revision + 1);
        expect(after.dirty).toBe(true);
        expect(session.writes).toEqual([]);
    });

    it("keeps the draft and the conflict a failed export never owned", async () => {
        const session = openSession("# Note\n");
        session.conflictWith("# Note as it is on disk\n");
        const before = session.read();

        const outcome = await exportWith(session, {
            layout: layoutPort(async () => {
                throw new Error("layout worker died");
            }),
            transport: NEVER_EXPORTS,
        });

        expect(outcome.ok).toBe(false);
        expect(session.read().drafts).toEqual(before.drafts);
        expect(session.read().conflict).toBe("# Note as it is on disk\n");
    });
});

describe("editing while an export is in flight", () => {
    it("keeps the output on the captured revision and moves the session on", async () => {
        const session = openSession("# Captured\n");
        const capturedRevision = session.state.revision;
        let enteredLayout: () => void = () => {};
        const entered = new Promise<void>((resolve) => {
            enteredLayout = resolve;
        });
        let releaseLayout: (snapshot: PublishingLayoutSnapshot) => void = () => {};
        const held = new Promise<PublishingLayoutSnapshot>((resolve) => {
            releaseLayout = resolve;
        });
        const payloads: PublishingPdfPayload[] = [];

        const inFlight = exportWith(session, {
            layout: layoutPort(() => {
                enteredLayout();
                return held;
            }),
            transport: transportThat(async (payload) => {
                payloads.push(payload);
                return { ok: true, pageCount: 1, warnings: [] };
            }),
        });

        // The edit provably happens while the export sits inside the layout
        // stage: the layout resolves only after the edit has landed.
        await entered;
        session.type(" edited during the export");
        releaseLayout({
            revision: capturedRevision,
            lines: [],
            canvasDrawOps: [],
        });

        const outcome = await inFlight;

        expect(outcome.ok).toBe(true);
        expect(outcome.revision).toBe(capturedRevision);
        expect(payloads).toHaveLength(1);
        expect(payloads[0].revision).toBe(capturedRevision);
        expect(payloads[0].layoutDocumentJson).toContain("Captured");
        expect(payloads[0].layoutDocumentJson).not.toContain(
            "edited during the export",
        );

        expect(session.state.revision).toBe(capturedRevision + 1);
        expect(session.state.markdown).toContain("edited during the export");
        expect(session.state.dirty).toBe(true);
        expect(session.writes).toEqual([]);
    });
});
