// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    fromLineFeeds,
    fromNormalizedOffset,
    readLineEndingStyle,
    toLineFeeds,
    toNormalizedOffset,
} from "../adapter/line-endings";
import type { EditorAdapterDiagnostic } from "../adapter/types";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import {
    createSourceEditorHost,
    type SourceEditorHost,
} from "../source/source-host";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";

/**
 * Line endings, on both surfaces.
 *
 * A document written with CRLF keeps it. The translation happens once, where a
 * surface hands Markdown back, and never inside the document: an earlier
 * attempt let carriage returns into the document itself and then rewrote line
 * endings on the way out, so `` ```\r\na\r\n```\r\n `` became
 * `` ```\r\nxa\r\r\n```\r\n `` and grew another `\r` on every keystroke. The
 * fenced-code cases below are the ones that catch that; the whole-document
 * cases would pass either way.
 */

const visual: MilkdownEditorHost[] = [];
const source: SourceEditorHost[] = [];

afterEach(async () => {
    while (visual.length > 0) await visual.pop()?.destroy();
    while (source.length > 0) source.pop()?.destroy();
    document.body.innerHTML = "";
});

interface Surface {
    getMarkdown(): string;
    replaceSourceRange(
        range: { anchor: number; head: number },
        text: string,
    ): boolean;
    setSelection(range: { anchor: number; head: number }): boolean;
    getSelection(): { anchor: number; head: number } | null;
    replaceMarkdown(markdown: string): boolean;
    flush(): void;
}

interface Mounted {
    surface: Surface;
    diagnostics: EditorAdapterDiagnostic[];
}

async function mountVisual(markdown: string): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);
    const diagnostics: EditorAdapterDiagnostic[] = [];
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: createMdxMilkdownPlugins(),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    visual.push(host);
    return { surface: host, diagnostics };
}

async function mountSource(markdown: string): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);
    const diagnostics: EditorAdapterDiagnostic[] = [];
    const host = createSourceEditorHost({
        root,
        markdown,
        editable: true,
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    source.push(host);
    return { surface: host, diagnostics };
}

const surfaces = [
    { name: "wysiwyg", mount: mountVisual },
    { name: "source", mount: mountSource },
] as const;

/** Types `text` one character at a time at `at`, as a user would. */
function typeAt(surface: Surface, at: number, text: string): void {
    for (let index = 0; index < text.length; index += 1) {
        expect(
            surface.replaceSourceRange(
                { anchor: at + index, head: at + index },
                text[index],
            ),
            `keystroke ${index} was refused`,
        ).toBe(true);
        surface.flush();
    }
}

describe("line endings — reading a document's style", () => {
    it("calls a document with no carriage return LF", () => {
        expect(readLineEndingStyle("a\nb\n")).toEqual({
            style: "lf",
            mixed: false,
        });
        expect(readLineEndingStyle("")).toEqual({ style: "lf", mixed: false });
    });

    it("calls a uniformly paired document CRLF", () => {
        expect(readLineEndingStyle("a\r\nb\r\n")).toEqual({
            style: "crlf",
            mixed: false,
        });
    });

    it("calls a document with one bare LF mixed", () => {
        expect(readLineEndingStyle("a\r\nb\nc\r\n")).toEqual({
            style: "lf",
            mixed: true,
        });
    });

    it("calls a document with a bare CR mixed, not CRLF", () => {
        expect(readLineEndingStyle("a\rb\r\n")).toEqual({
            style: "lf",
            mixed: true,
        });
        expect(readLineEndingStyle("a\rb\rc")).toEqual({
            style: "lf",
            mixed: true,
        });
    });

    it("round-trips a CRLF document through normalization", () => {
        const crlf = "```\r\na\r\n```\r\n";
        expect(toLineFeeds(crlf)).toBe("```\na\n```\n");
        expect(fromLineFeeds(toLineFeeds(crlf), "crlf")).toBe(crlf);
        expect(fromLineFeeds(toLineFeeds(crlf), "lf")).toBe("```\na\n```\n");
    });
});

describe("line endings — the offset skew", () => {
    const crlf = "alpha\r\nbravo\r\n";

    it("maps every offset that names a position, in both directions", () => {
        const normalized = toLineFeeds(crlf);
        for (let offset = 0; offset <= crlf.length; offset += 1) {
            const mapped = toNormalizedOffset(crlf, offset);
            if (mapped === null) continue;
            expect(crlf.slice(0, offset)).toBe(
                fromLineFeeds(normalized.slice(0, mapped), "crlf"),
            );
            expect(fromNormalizedOffset(crlf, mapped)).toBe(offset);
        }
    });

    it("refuses an offset between a CR and its LF", () => {
        // Offset 6 sits between the `\r` at 5 and the `\n` at 6.
        expect(toNormalizedOffset(crlf, 6)).toBeNull();
        expect(toNormalizedOffset(crlf, 5)).toBe(5);
        expect(toNormalizedOffset(crlf, 7)).toBe(6);
    });

    it("is the identity on a document with no carriage return", () => {
        const lf = "alpha\nbravo\n";
        for (let offset = 0; offset <= lf.length; offset += 1) {
            expect(toNormalizedOffset(lf, offset)).toBe(offset);
            expect(fromNormalizedOffset(lf, offset)).toBe(offset);
        }
    });
});

for (const { name, mount } of surfaces) {
    describe(`line endings — ${name} surface`, () => {
        it("keeps CRLF through an edit", async () => {
            const { surface } = await mount("alpha\r\nbravo\r\n");
            typeAt(surface, 0, "X");
            expect(surface.getMarkdown()).toBe("Xalpha\r\nbravo\r\n");
        });

        it("leaves an LF document alone", async () => {
            const { surface } = await mount("alpha\nbravo\n");
            typeAt(surface, 0, "X");
            expect(surface.getMarkdown()).toBe("Xalpha\nbravo\n");
            expect(surface.getMarkdown()).not.toContain("\r");
        });

        it("does not accumulate carriage returns inside a fenced block", async () => {
            // The exact shape of the earlier defect. One keystroke turned
            // "```\r\na\r\n```\r\n" into "```\r\nxa\r\r\n```\r\n", and each
            // further keystroke added another `\r`, so typing is what makes it
            // visible — a single edit understates it.
            const document_ = "```js\r\nconst a = 1;\r\nconst b = 2;\r\n```\r\n";
            const opened = "```js\r\n";
            const { surface } = await mount(document_);

            // Every keystroke, not only the last: the defect compounded, so a
            // check that only looks at the end would report one stray `\r`
            // where there were three.
            const breaks = document_.split("\r\n").length - 1;
            for (let index = 0; index < 3; index += 1) {
                typeAt(surface, opened.length + index, "x");
                const written = surface.getMarkdown();
                expect(written, `after keystroke ${index}`).not.toContain(
                    "\r\r",
                );
                expect(
                    (written.match(/\r/g) ?? []).length,
                    `after keystroke ${index}`,
                ).toBe(breaks);
            }

            expect(surface.getMarkdown()).toBe(
                "```js\r\nxxxconst a = 1;\r\nconst b = 2;\r\n```\r\n",
            );
        });

        it("edits the text a CRLF offset names, not text a line break away", async () => {
            const markdown = "alpha\r\nbravo\r\ncharlie\r\n";
            expect(markdown.slice(14, 18)).toBe("char");
            const { surface } = await mount(markdown);

            expect(
                surface.replaceSourceRange({ anchor: 14, head: 18 }, "XXX"),
            ).toBe(true);
            surface.flush();

            expect(surface.getMarkdown()).toBe(
                "alpha\r\nbravo\r\nXXXlie\r\n",
            );
        });

        it("reports a selection in the session's own coordinate space", async () => {
            const { surface } = await mount("alpha\r\nbravo\r\ncharlie\r\n");
            expect(surface.setSelection({ anchor: 14, head: 18 })).toBe(true);
            expect(surface.getSelection()).toEqual({ anchor: 14, head: 18 });
        });

        it("refuses an offset that names no position, between a CR and its LF", async () => {
            const { surface } = await mount("alpha\r\nbravo\r\n");
            expect(surface.setSelection({ anchor: 6, head: 6 })).toBe(false);
            expect(
                surface.replaceSourceRange({ anchor: 6, head: 6 }, "!"),
            ).toBe(false);
        });

        it("normalizes a mixed-ending document to LF and says so once", async () => {
            const { surface, diagnostics } = await mount(
                "alpha\r\nbravo\ncharlie\r\n",
            );
            expect(
                diagnostics.map((diagnostic) => diagnostic.code),
            ).toEqual(["editor_line_endings_normalized"]);

            typeAt(surface, 0, "XY");

            expect(surface.getMarkdown()).toBe("XYalpha\nbravo\ncharlie\n");
            // Still one report after two more transactions: the reading happens
            // where a document arrives, not where one is serialized.
            expect(diagnostics).toHaveLength(1);
        });

        it("keeps inserted text out of the document's line-ending business", async () => {
            const { surface } = await mount("alpha\r\n");
            expect(
                surface.replaceSourceRange({ anchor: 5, head: 5 }, " one\r\ntwo"),
            ).toBe(true);
            surface.flush();
            expect(surface.getMarkdown()).not.toContain("\r\r");
            expect(surface.getMarkdown().split("\r\n").length - 1).toBe(
                (surface.getMarkdown().match(/\r/g) ?? []).length,
            );
        });

        it("adopts the line ending of a document handed to it later", async () => {
            const { surface } = await mount("alpha\n");
            expect(surface.replaceMarkdown("gamma\r\ndelta\r\n")).toBe(true);
            typeAt(surface, 0, "X");
            expect(surface.getMarkdown()).toBe("Xgamma\r\ndelta\r\n");
        });
    });
}

describe("line endings — a document the visual surface refuses", () => {
    /**
     * Deep blockquote nesting exhausts the parser's stack, so `replaceMarkdown`
     * refuses it and the surface keeps what it had. Written with CRLF, so a
     * surface that adopted the refused document's ending would rewrite every
     * line of the LF content it kept.
     */
    const UNBUILDABLE_CRLF = `${"> ".repeat(3000)}deep\r\n`;

    it("keeps the line ending of the content it kept", async () => {
        const { surface, diagnostics } = await mountVisual("alpha\nbravo\n");

        expect(surface.replaceMarkdown(UNBUILDABLE_CRLF)).toBe(false);
        expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "unsafe_visual_parse",
        ]);
        // The refusal really did leave the old content in place, so the
        // assertion below is about the content this surface is still showing.
        expect(surface.getMarkdown()).toBe("alpha\nbravo\n");

        typeAt(surface, 0, "X");

        expect(surface.getMarkdown()).toBe("Xalpha\nbravo\n");
        expect(surface.getMarkdown()).not.toContain("\r");
    }, 30000);
});

describe("line endings — the two surfaces agree", () => {
    it("hands the same bytes back for the same CRLF document and edit", async () => {
        const markdown = "# Title\r\n\r\n```js\r\nconst a = 1;\r\n```\r\n";
        const wysiwyg = await mountVisual(markdown);
        const cm = await mountSource(markdown);

        typeAt(wysiwyg.surface, 2, "A");
        typeAt(cm.surface, 2, "A");

        expect(wysiwyg.surface.getMarkdown()).toBe("# ATitle\r\n\r\n```js\r\nconst a = 1;\r\n```\r\n");
        expect(cm.surface.getMarkdown()).toBe(wysiwyg.surface.getMarkdown());
    });
});
