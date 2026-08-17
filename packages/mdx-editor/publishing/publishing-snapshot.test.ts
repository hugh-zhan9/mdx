import { describe, expect, it } from "vitest";

import {
    capturePublishingSnapshot,
    PublishingSnapshotError,
    publishingRequestKey,
} from "./publishing-snapshot";

describe("capturing what publishing works on", () => {
    it("copies the source rather than holding it", () => {
        const session = { documentId: "note.md", revision: 4, markdown: "# One" };

        const captured = capturePublishingSnapshot(session);
        session.markdown = "# Two";
        session.revision = 5;

        expect(captured).not.toBe(session);
        expect(captured.markdown).toBe("# One");
        expect(captured.revision).toBe(4);
    });

    it("hands back content nothing downstream can rewrite", () => {
        const captured = capturePublishingSnapshot({
            documentId: "note.md",
            revision: 1,
            markdown: "body\r\n",
        });

        expect(Object.isFrozen(captured)).toBe(true);
        expect(() => {
            (captured as { markdown: string }).markdown = "normalized\n";
        }).toThrow(TypeError);
        expect(captured.markdown).toBe("body\r\n");
    });

    it("refuses a source that does not identify a document revision", () => {
        expect(() =>
            capturePublishingSnapshot({
                documentId: "",
                revision: 1,
                markdown: "",
            }),
        ).toThrow(PublishingSnapshotError);
        expect(() =>
            capturePublishingSnapshot({
                documentId: "note.md",
                revision: 1.5,
                markdown: "",
            }),
        ).toThrow(PublishingSnapshotError);
        expect(() =>
            capturePublishingSnapshot({
                documentId: "note.md",
                revision: -1,
                markdown: "",
            }),
        ).toThrow(PublishingSnapshotError);
    });

    it("accepts an empty document", () => {
        const captured = capturePublishingSnapshot({
            documentId: "empty.md",
            revision: 0,
            markdown: "",
        });

        expect(captured).toEqual({
            documentId: "empty.md",
            revision: 0,
            markdown: "",
        });
    });
});

describe("publishing request identity", () => {
    it("separates two revisions of the same document", () => {
        const first = publishingRequestKey({
            documentId: "note.md",
            revision: 4,
            markdown: "a",
        });
        const second = publishingRequestKey({
            documentId: "note.md",
            revision: 5,
            markdown: "a",
        });

        expect(first).not.toBe(second);
        expect(first).toContain("4");
        expect(second).toContain("5");
    });

    it("separates two documents at the same revision", () => {
        const first = publishingRequestKey({
            documentId: "one.md",
            revision: 4,
            markdown: "a",
        });
        const second = publishingRequestKey({
            documentId: "two.md",
            revision: 4,
            markdown: "a",
        });

        expect(first).not.toBe(second);
        expect(first).toContain("one.md");
        expect(second).toContain("two.md");
    });

    it("does not let one document's name spill into another's key", () => {
        const ambiguous = publishingRequestKey({
            documentId: "note.md@9",
            revision: 4,
            markdown: "a",
        });
        const other = publishingRequestKey({
            documentId: "note.md",
            revision: 4,
            markdown: "a",
        });

        expect(ambiguous).not.toBe(other);
        expect(ambiguous).not.toBe(
            publishingRequestKey({
                documentId: "note.md",
                revision: 9,
                markdown: "a",
            }),
        );
    });
});
