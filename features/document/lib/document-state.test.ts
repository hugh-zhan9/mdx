import { describe, expect, it } from "vitest";
import {
  applyExternalDocumentReload,
  applyRecoveredDraft,
  canCloseDocumentWithoutPrompt,
  createDocumentExternalConflict,
  createLoadedDocumentState,
  documentWindowTitle,
  markDocumentDeleted,
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
    expect(documentWindowTitle(state)).toBe("note.md - Loam");
  });

  it("marks dirty markdown and prefixes the window title", () => {
    const state = updateDocumentMarkdown(
      createLoadedDocumentState(loadedFile),
      "# Changed\n",
    );

    expect(state.markdown).toBe("# Changed\n");
    expect(state.savedMarkdown).toBe("# Note\n");
    expect(state.dirty).toBe(true);
    expect(documentWindowTitle(state)).toBe("● note.md - Loam");
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
    expect(documentWindowTitle(saved)).toBe("note.md - Loam");
  });

  it("keeps newer edits dirty when an older save completes", () => {
    const dirty = updateDocumentMarkdown(
      createLoadedDocumentState(loadedFile),
      "# Saved\n",
    );
    const editedAgain = updateDocumentMarkdown(dirty, "# Newer\n");
    const saved = markDocumentSaved(editedAgain, "fingerprint-b", "# Saved\n");

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

  it("applies recovered draft content and keeps the document dirty", () => {
    const clean = createLoadedDocumentState(loadedFile);
    const recovered = applyRecoveredDraft(clean, "# Recovered\n");

    expect(recovered.markdown).toBe("# Recovered\n");
    expect(recovered.savedMarkdown).toBe("# Note\n");
    expect(recovered.dirty).toBe(true);
    expect(recovered.deletedOnDisk).toBe(false);
  });

  it("marks a document as deleted without clearing dirty markdown", () => {
    const dirty = updateDocumentMarkdown(
      createLoadedDocumentState(loadedFile),
      "# Mine\n",
    );
    const deleted = markDocumentDeleted(dirty);

    expect(deleted.markdown).toBe("# Mine\n");
    expect(deleted.deletedOnDisk).toBe(true);
    expect(deleted.dirty).toBe(true);
  });

  it("auto reloads clean document content from disk", () => {
    const state = createLoadedDocumentState(loadedFile);
    const reloaded = applyExternalDocumentReload(state, {
      content: "# Disk Changed\n",
      fingerprint: "fingerprint-b",
    });

    expect(reloaded.markdown).toBe("# Disk Changed\n");
    expect(reloaded.savedMarkdown).toBe("# Disk Changed\n");
    expect(reloaded.fingerprint).toBe("fingerprint-b");
    expect(reloaded.dirty).toBe(false);
  });

  it("creates external conflict from dirty document state", () => {
    const dirty = updateDocumentMarkdown(
      createLoadedDocumentState(loadedFile),
      "# Mine\n",
    );

    expect(
      createDocumentExternalConflict(dirty, {
        content: "# Disk\n",
        fingerprint: "fingerprint-b",
      }),
    ).toEqual({
      path: "/tmp/note.md",
      currentMarkdown: "# Mine\n",
      diskMarkdown: "# Disk\n",
      diskFingerprint: "fingerprint-b",
    });
  });
});
