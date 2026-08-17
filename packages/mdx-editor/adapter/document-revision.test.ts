import { describe, expect, it } from "vitest";

import { createDocumentRevisionGuard } from "./document-revision";
import type { EditorDocumentSnapshot, PinnedEditorCommand } from "./types";

function snapshot(
    overrides: Partial<EditorDocumentSnapshot> = {},
): EditorDocumentSnapshot {
    return {
        documentId: "doc-a",
        revision: 1,
        markdown: "hello\n",
        ...overrides,
    };
}

function command(
    overrides: Partial<PinnedEditorCommand> = {},
): PinnedEditorCommand {
    return {
        commandId: "cmd-1",
        documentId: "doc-a",
        baseRevision: 1,
        selection: { anchor: 0, head: 0 },
        kind: "replace-selection",
        text: "x",
        ...overrides,
    };
}

describe("document revision guard", () => {
    it("initializes on the first snapshot", () => {
        const guard = createDocumentRevisionGuard();
        expect(guard.evaluateSnapshot(snapshot())).toEqual({ kind: "initialize" });
    });

    it("treats a repeated identical snapshot as idempotent", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot());
        expect(guard.evaluateSnapshot(snapshot())).toEqual({ kind: "idempotent" });
    });

    it("rejects a snapshot whose revision moved backwards", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot({ revision: 7 }));
        expect(guard.evaluateSnapshot(snapshot({ revision: 3 }))).toEqual({
            kind: "reject",
            code: "stale_revision",
        });
    });

    it("rejects a same-revision snapshot carrying different markdown", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot());
        expect(
            guard.evaluateSnapshot(snapshot({ markdown: "other\n" })),
        ).toEqual({ kind: "reject", code: "stale_revision" });
    });

    it("confirms the adapter's own change without rebuilding the surface", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot());
        guard.recordLocalMarkdown("hello world\n");
        expect(
            guard.evaluateSnapshot(
                snapshot({ revision: 2, markdown: "hello world\n" }),
            ),
        ).toEqual({ kind: "confirm", revision: 2 });
    });

    it("treats each declared replace reason as an external replace", () => {
        const reasons = [
            "open",
            "clean-reload",
            "restore",
            "conflict-resolution",
        ] as const;
        for (const reason of reasons) {
            const guard = createDocumentRevisionGuard();
            guard.commitSnapshot(snapshot());
            expect(
                guard.evaluateSnapshot(
                    snapshot({ revision: 5, markdown: "d", replaceReason: reason }),
                ),
            ).toEqual({ kind: "replace", reason });
        }
    });

    it("switches documents rather than calling a new document stale", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot({ revision: 9 }));
        expect(
            guard.evaluateSnapshot(
                snapshot({ documentId: "doc-b", revision: 1, markdown: "b\n" }),
            ),
        ).toEqual({ kind: "replace", reason: "open" });
    });
});

describe("pinned command guard", () => {
    it("rejects a command aimed at another document", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot());
        expect(guard.evaluateCommand(command({ documentId: "doc-b" }))).toEqual({
            ok: false,
            code: "stale_document",
        });
    });

    it("rejects a command pinned to a superseded revision", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot({ revision: 4 }));
        expect(guard.evaluateCommand(command({ baseRevision: 3 }))).toEqual({
            ok: false,
            code: "stale_revision",
        });
    });

    it("accepts a command that matches the current document and revision", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot());
        expect(guard.evaluateCommand(command())).toEqual({ ok: true });
    });

    it("applies a commandId at most once", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot());
        expect(guard.consumeCommand("cmd-1")).toBe(true);
        expect(guard.consumeCommand("cmd-1")).toBe(false);
        expect(guard.evaluateCommand(command())).toEqual({
            ok: false,
            code: "stale_revision",
        });
    });

    it("forgets consumed command ids when the document changes", () => {
        const guard = createDocumentRevisionGuard();
        guard.commitSnapshot(snapshot());
        guard.consumeCommand("cmd-1");
        guard.commitSnapshot(snapshot({ documentId: "doc-b", markdown: "b\n" }));
        expect(guard.consumeCommand("cmd-1")).toBe(true);
    });

    it("rejects every command before any snapshot is committed", () => {
        const guard = createDocumentRevisionGuard();
        expect(guard.evaluateCommand(command())).toEqual({
            ok: false,
            code: "stale_document",
        });
    });
});
