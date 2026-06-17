import { describe, expect, it } from "vitest";
import { selectionSnapshotFromMarkdownOffsets } from "./selection";

describe("selectionSnapshotFromMarkdownOffsets", () => {
    it("returns selected text and surrounding context", () => {
        const snapshot = selectionSnapshotFromMarkdownOffsets(
            "hello brave world",
            6,
            11,
            5,
        );

        expect(snapshot).toEqual({
            has_selection: true,
            selected_text: "brave",
            before: "ello ",
            after: " worl",
            before_truncated: true,
            after_truncated: true,
        });
    });

    it("returns cursor context when selection is collapsed", () => {
        const snapshot = selectionSnapshotFromMarkdownOffsets("abc", 1, 1, 5);

        expect(snapshot.has_selection).toBe(false);
        expect(snapshot.selected_text).toBe("");
        expect(snapshot.before).toBe("a");
        expect(snapshot.after).toBe("bc");
    });
});
