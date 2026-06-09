import { describe, expect, it } from "vitest";
import {
    createDraftPrompt,
    createExternalConflictPrompt,
    createDeletedFilePrompt,
} from "./recovery-state";
import type { DraftRecord } from "./types";

const draft: DraftRecord = {
    draftId: "draft-1",
    realPath: "/tmp/ws/note.md",
    displayPath: "note.md",
    mode: "workspace",
    baseFingerprint: "base",
    updatedAt: "2026-06-09T00:00:00Z",
    markdown: "# Draft\n",
};

describe("recovery-state", () => {
    it("creates a draft prompt without deleting the draft", () => {
        expect(createDraftPrompt(draft, true)).toEqual({
            kind: "draft",
            draft,
            fileExists: true,
            priority: "normal",
        });
    });

    it("raises priority for orphan drafts", () => {
        expect(createDraftPrompt(draft, false).priority).toBe("high");
    });

    it("creates dirty external conflict prompts", () => {
        expect(
            createExternalConflictPrompt({
                path: "/tmp/ws/note.md",
                currentMarkdown: "# Mine\n",
                diskMarkdown: "# Disk\n",
            }),
        ).toMatchObject({
            kind: "externalConflict",
            path: "/tmp/ws/note.md",
            priority: "high",
        });
    });

    it("keeps dirty deleted files as high priority prompts", () => {
        expect(createDeletedFilePrompt("/tmp/ws/note.md", true).priority).toBe("high");
        expect(createDeletedFilePrompt("/tmp/ws/note.md", false).priority).toBe("normal");
    });
});
