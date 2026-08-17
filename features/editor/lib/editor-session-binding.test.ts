import { describe, expect, it } from "vitest";

import {
    createEditorSessionBinding,
    type EditorSessionBinding,
} from "./editor-session-binding";
import type { EditorChangeEvent } from "../../../packages/mdx-editor";

function changeOf(
    overrides: Partial<EditorChangeEvent> = {},
): EditorChangeEvent {
    return {
        documentId: "tab-a",
        baseRevision: 1,
        markdown: "edited\n",
        selection: null,
        origin: "user",
        ...overrides,
    };
}

function open(
    binding: EditorSessionBinding,
    documentId: string,
    markdown: string,
) {
    return binding.snapshotFor({ documentId, markdown });
}

describe("editor session binding — snapshots", () => {
    it("opens a document at revision 1 and declares it an open", () => {
        const binding = createEditorSessionBinding();

        expect(open(binding, "tab-a", "# Disk\n")).toEqual({
            documentId: "tab-a",
            revision: 1,
            markdown: "# Disk\n",
            replaceReason: "open",
        });
    });

    it("returns the same snapshot for unchanged content", () => {
        const binding = createEditorSessionBinding();
        const first = open(binding, "tab-a", "# Disk\n");

        expect(open(binding, "tab-a", "# Disk\n")).toBe(first);
    });

    it("advances the revision once per distinct content", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "one\n");

        expect(open(binding, "tab-a", "two\n").revision).toBe(2);
        expect(open(binding, "tab-a", "three\n").revision).toBe(3);
    });

    it("keeps each document's revisions independent", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "a1\n");
        open(binding, "tab-a", "a2\n");

        expect(open(binding, "tab-b", "b1\n").revision).toBe(1);
        expect(open(binding, "tab-a", "a3\n").revision).toBe(3);
    });

    it("carries no replace reason for content the session did not declare", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "# Disk\n");

        expect(open(binding, "tab-a", "typed\n").replaceReason).toBeUndefined();
    });

    it("carries the declared reason on the content it was declared for", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "# Disk\n");
        binding.declareReplace({
            documentId: "tab-a",
            markdown: "# External\n",
            reason: "clean-reload",
        });

        expect(open(binding, "tab-a", "# External\n").replaceReason).toBe(
            "clean-reload",
        );
    });

    it("does not reuse a declaration for a second content change", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "# Disk\n");
        binding.declareReplace({
            documentId: "tab-a",
            markdown: "# External\n",
            reason: "clean-reload",
        });
        open(binding, "tab-a", "# External\n");

        expect(open(binding, "tab-a", "typed\n").replaceReason).toBeUndefined();
    });

    it("expires a declaration whose content never arrived", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "# Disk\n");
        // A reload that failed after the declaration was made.
        binding.declareReplace({
            documentId: "tab-a",
            markdown: "# External\n",
            reason: "clean-reload",
        });

        expect(open(binding, "tab-a", "typed\n").replaceReason).toBeUndefined();
    });

    it("does not apply one document's declaration to another", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "a\n");
        open(binding, "tab-b", "b\n");
        binding.declareReplace({
            documentId: "tab-a",
            markdown: "shared\n",
            reason: "clean-reload",
        });

        expect(open(binding, "tab-b", "shared\n").replaceReason).toBeUndefined();
    });
});

describe("editor session binding — change verdicts", () => {
    it("accepts a change against the document's current revision", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "# Disk\n");

        expect(binding.acceptChange(changeOf())).toEqual({
            kind: "accept",
            documentId: "tab-a",
            markdown: "edited\n",
        });
    });

    it("routes a change to the document it names, not the newest one", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "a\n");
        open(binding, "tab-b", "b\n");

        expect(
            binding.acceptChange(changeOf({ documentId: "tab-a", markdown: "late\n" })),
        ).toEqual({ kind: "accept", documentId: "tab-a", markdown: "late\n" });
    });

    it("rejects a change for a document it is not tracking", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "a\n");

        expect(binding.acceptChange(changeOf({ documentId: "tab-z" }))).toEqual({
            kind: "reject",
            code: "unknown_document",
            documentId: "tab-z",
        });
    });

    it("rejects a change for a document that was dropped", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "a\n");
        open(binding, "tab-b", "b\n");
        binding.retain(["tab-b"]);

        expect(binding.acceptChange(changeOf({ documentId: "tab-a" })).kind).toBe(
            "reject",
        );
        expect(
            binding.acceptChange(changeOf({ documentId: "tab-b" })).kind,
        ).toBe("accept");
    });

    it("accepts several changes emitted against the same revision", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "a\n");
        // Typing emits faster than the session confirms, so consecutive
        // keystrokes legitimately share a base revision.
        binding.acceptChange(changeOf({ markdown: "ab\n" }));
        open(binding, "tab-a", "ab\n");

        expect(
            binding.acceptChange(changeOf({ baseRevision: 1, markdown: "abc\n" })),
        ).toEqual({ kind: "accept", documentId: "tab-a", markdown: "abc\n" });
    });

    it("rejects a change based on content an external replace superseded", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "# Disk\n");
        binding.declareReplace({
            documentId: "tab-a",
            markdown: "# External\n",
            reason: "clean-reload",
        });
        open(binding, "tab-a", "# External\n");

        expect(
            binding.acceptChange(changeOf({ baseRevision: 1, markdown: "pre-reload\n" })),
        ).toEqual({
            kind: "reject",
            code: "stale_revision",
            documentId: "tab-a",
        });
    });

    it("accepts a change based on the replaced content itself", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "# Disk\n");
        binding.declareReplace({
            documentId: "tab-a",
            markdown: "# External\n",
            reason: "clean-reload",
        });
        open(binding, "tab-a", "# External\n");

        expect(
            binding.acceptChange(changeOf({ baseRevision: 2, markdown: "# External edited\n" }))
                .kind,
        ).toBe("accept");
    });

    it("rejects a change claiming a revision the session never issued", () => {
        const binding = createEditorSessionBinding();
        open(binding, "tab-a", "a\n");

        expect(binding.acceptChange(changeOf({ baseRevision: 9 }))).toEqual({
            kind: "reject",
            code: "future_revision",
            documentId: "tab-a",
        });
    });
});
