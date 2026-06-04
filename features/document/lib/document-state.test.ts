import { describe, expect, it } from "vitest";
import {
    canCloseDocumentWithoutPrompt,
    createLoadedDocumentState,
    documentWindowTitle,
    markDocumentSaved,
    updateDocumentMarkdown,
} from "./document-state";
import type { DocumentFileResult } from "./types";

const loadedFile: DocumentFileResult = {
    content: "# Note\n",
    fileName: "note.md",
    displayPath: "/tmp/note.md",
    realPath: "/tmp/note.md",
    fingerprint: "fingerprint-a",
};

describe("document state", () => {
    it("creates a clean loaded document state with outline visible", () => {
        const state = createLoadedDocumentState(loadedFile);

        expect(state.markdown).toBe("# Note\n");
        expect(state.savedMarkdown).toBe("# Note\n");
        expect(state.dirty).toBe(false);
        expect(state.outlineCollapsed).toBe(false);
        expect(documentWindowTitle(state)).toBe("note.md - MDX");
    });

    it("marks dirty markdown and prefixes the window title", () => {
        const state = updateDocumentMarkdown(
            createLoadedDocumentState(loadedFile),
            "# Changed\n",
        );

        expect(state.markdown).toBe("# Changed\n");
        expect(state.savedMarkdown).toBe("# Note\n");
        expect(state.dirty).toBe(true);
        expect(documentWindowTitle(state)).toBe("● note.md - MDX");
    });

    it("marks the current markdown as saved with the new fingerprint", () => {
        const dirty = updateDocumentMarkdown(
            createLoadedDocumentState(loadedFile),
            "# Changed\n",
        );
        const saved = markDocumentSaved(dirty, "fingerprint-b");

        expect(saved.markdown).toBe("# Changed\n");
        expect(saved.savedMarkdown).toBe("# Changed\n");
        expect(saved.fingerprint).toBe("fingerprint-b");
        expect(saved.dirty).toBe(false);
        expect(documentWindowTitle(saved)).toBe("note.md - MDX");
    });

    it("keeps newer edits dirty when an older save completes", () => {
        const dirty = updateDocumentMarkdown(
            createLoadedDocumentState(loadedFile),
            "# Saved\n",
        );
        const editedAgain = updateDocumentMarkdown(dirty, "# Newer\n");
        const saved = markDocumentSaved(
            editedAgain,
            "fingerprint-b",
            "# Saved\n",
        );

        expect(saved.markdown).toBe("# Newer\n");
        expect(saved.savedMarkdown).toBe("# Saved\n");
        expect(saved.fingerprint).toBe("fingerprint-b");
        expect(saved.dirty).toBe(true);
    });

    it("allows clean documents to close without a prompt", () => {
        const state = createLoadedDocumentState(loadedFile);

        expect(canCloseDocumentWithoutPrompt(state)).toBe(true);
    });

    it("requires a prompt before closing dirty documents", () => {
        const state = updateDocumentMarkdown(
            createLoadedDocumentState(loadedFile),
            "# Changed\n",
        );

        expect(canCloseDocumentWithoutPrompt(state)).toBe(false);
    });
});
