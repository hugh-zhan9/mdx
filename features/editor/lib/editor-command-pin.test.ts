import { describe, expect, it } from "vitest";

import {
    advancePinnedSelection,
    pinnedCommandForCliRequest,
    sourceRangeForMarkdownLine,
} from "./editor-command-pin";

const PIN = {
    documentId: "tab-a",
    baseRevision: 7,
    selection: { anchor: 4, head: 9 },
};

describe("pinnedCommandForCliRequest", () => {
    it("carries the document, revision and selection the request arrived with", () => {
        const command = pinnedCommandForCliRequest(
            { id: "c1", kind: "insert", tabId: "tab-a", text: "hello" },
            PIN,
            "0123456789\n",
        );

        expect(command).toEqual({
            commandId: "c1",
            documentId: "tab-a",
            baseRevision: 7,
            selection: { anchor: 4, head: 9 },
            kind: "replace-selection",
            text: "hello",
        });
    });

    it("refuses a request aimed at a different document", () => {
        const command = pinnedCommandForCliRequest(
            { id: "c1", kind: "insert", tabId: "tab-b", text: "hello" },
            PIN,
            "0123456789\n",
        );

        expect(command).toBeNull();
    });

    it("starts an insert at the document beginning when nothing is selected", () => {
        const command = pinnedCommandForCliRequest(
            { id: "c1", kind: "insert", tabId: "tab-a", text: "hello" },
            { ...PIN, selection: null },
            "0123456789\n",
        );

        expect(command?.selection).toEqual({ anchor: 0, head: 0 });
    });

    it("turns a scroll request into the target line's source range", () => {
        const command = pinnedCommandForCliRequest(
            { id: "c1", kind: "scrollToLine", tabId: "tab-a", lineNumber: 2 },
            PIN,
            "first\nsecond\nthird\n",
        );

        expect(command).toMatchObject({
            kind: "reveal-range",
            range: { anchor: 6, head: 12 },
        });
    });

    it("refuses a scroll request for a line the document does not have", () => {
        expect(
            pinnedCommandForCliRequest(
                { id: "c1", kind: "scrollToLine", tabId: "tab-a", lineNumber: 9 },
                PIN,
                "first\nsecond\n",
            ),
        ).toBeNull();
    });

    it("refuses an insert with no text and a scroll with no line", () => {
        expect(
            pinnedCommandForCliRequest(
                { id: "c1", kind: "insert", tabId: "tab-a" },
                PIN,
                "body\n",
            ),
        ).toBeNull();
        expect(
            pinnedCommandForCliRequest(
                { id: "c2", kind: "scrollToLine", tabId: "tab-a" },
                PIN,
                "body\n",
            ),
        ).toBeNull();
    });

    it("keeps a focus request free of any range", () => {
        const command = pinnedCommandForCliRequest(
            { id: "c1", kind: "focus", tabId: "tab-a" },
            PIN,
            "body\n",
        );

        expect(command).toEqual({
            commandId: "c1",
            documentId: "tab-a",
            baseRevision: 7,
            selection: { anchor: 4, head: 9 },
            kind: "focus",
        });
    });
});

describe("sourceRangeForMarkdownLine", () => {
    it("spans the first line without its terminator", () => {
        expect(sourceRangeForMarkdownLine("first\nsecond\n", 1)).toEqual({
            anchor: 0,
            head: 5,
        });
    });

    it("spans the last line when the document does not end in a newline", () => {
        expect(sourceRangeForMarkdownLine("first\nlast", 2)).toEqual({
            anchor: 6,
            head: 10,
        });
    });

    it("excludes both characters of a CRLF terminator", () => {
        expect(sourceRangeForMarkdownLine("first\r\nsecond\r\n", 2)).toEqual({
            anchor: 7,
            head: 13,
        });
    });

    it("gives an empty range for a blank line", () => {
        expect(sourceRangeForMarkdownLine("first\n\nthird\n", 2)).toEqual({
            anchor: 6,
            head: 6,
        });
    });

    it("refuses a line past the end rather than clamping onto the last one", () => {
        expect(sourceRangeForMarkdownLine("first\nsecond\n", 9)).toBeNull();
    });

    it("refuses a line number that is not a positive integer", () => {
        expect(sourceRangeForMarkdownLine("first\n", 0)).toBeNull();
        expect(sourceRangeForMarkdownLine("first\n", -3)).toBeNull();
        expect(sourceRangeForMarkdownLine("first\n", 1.5)).toBeNull();
    });
});

describe("advancePinnedSelection", () => {
    it("moves a collapsed pin past what was inserted there", () => {
        expect(advancePinnedSelection({ anchor: 10, head: 10 }, 24)).toEqual({
            anchor: 34,
            head: 34,
        });
    });

    it("advances from the start of a range, since that is where text landed", () => {
        expect(advancePinnedSelection({ anchor: 18, head: 10 }, 5)).toEqual({
            anchor: 15,
            head: 15,
        });
    });

    it("never moves backwards when nothing was inserted", () => {
        expect(advancePinnedSelection({ anchor: 10, head: 10 }, -4)).toEqual({
            anchor: 10,
            head: 10,
        });
    });
});
