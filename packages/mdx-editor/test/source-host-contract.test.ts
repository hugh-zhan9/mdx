// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createSourceEditorHost,
    type SourceEditorHost,
} from "../source/source-host";

const mounted: SourceEditorHost[] = [];

afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.destroy();
    document.body.innerHTML = "";
});

function mount(markdown: string): SourceEditorHost {
    const root = document.createElement("div");
    document.body.append(root);
    const host = createSourceEditorHost({
        root,
        markdown,
        editable: true,
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    return host;
}

/**
 * CodeMirror stores every line break as one character, so a document that
 * arrived with CRLF is shorter in the editor than in the Markdown the session
 * holds. Offsets have to account for that skew exactly. Checking only whether
 * an offset ran past the end catches the last few and lets every earlier one
 * through mis-resolved, which edits the wrong text and reports success.
 */
describe("source host — offsets on a CRLF document resolve to the right text", () => {
    const crlf = "alpha\r\nbravo\r\ncharlie\r\n";

    it("edits the text the offsets name, not text one line-break away", () => {
        const host = mount(crlf);
        expect(crlf.slice(14, 18)).toBe("char");

        expect(host.replaceSourceRange({ anchor: 14, head: 18 }, "XXX")).toBe(
            true,
        );
        host.flush();

        expect(host.getMarkdown()).toContain("XXXlie");
        expect(host.getMarkdown()).not.toContain("charlie");
        expect(host.getMarkdown()).not.toContain("arli");
    });

    it("edits the first line, where the skew is still zero", () => {
        const host = mount(crlf);
        expect(host.replaceSourceRange({ anchor: 0, head: 5 }, "AAAAA")).toBe(
            true,
        );
        host.flush();
        expect(host.getMarkdown()).toContain("AAAAA");
        expect(host.getMarkdown()).not.toContain("alpha");
    });

    it("reports a selection back in the session's coordinate space", () => {
        const host = mount(crlf);
        expect(host.setSelection({ anchor: 14, head: 18 })).toBe(true);
        expect(host.getSelection()).toEqual({ anchor: 14, head: 18 });
    });

    it("refuses an offset that names no position, between a CR and its LF", () => {
        const host = mount(crlf);
        // Offset 6 sits between the `\r` at 5 and the `\n` at 6.
        expect(host.replaceSourceRange({ anchor: 6, head: 6 }, "!")).toBe(false);
        expect(host.setSelection({ anchor: 6, head: 6 })).toBe(false);
    });
});

describe("source host — an edit never splits a surrogate pair", () => {
    // The alignment used to be computed against the session's Markdown and then
    // applied to the CodeMirror document, i.e. in the wrong coordinate space,
    // so on a CRLF document it could produce a split rather than prevent one.
    const withEmoji = "a\r\n\u{1F600}b\n";

    it("keeps the pair whole when inserting at its start", () => {
        const host = mount(withEmoji);
        expect(withEmoji.codePointAt(3)).toBe(0x1f600);

        host.replaceSourceRange({ anchor: 3, head: 3 }, "X");
        host.flush();

        const result = host.getMarkdown();
        expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        expect(result).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
        expect(result).toContain("\u{1F600}");
    });

    it("deletes the emoji when given exactly its range", () => {
        const host = mount(withEmoji);
        host.replaceSourceRange({ anchor: 3, head: 5 }, "");
        host.flush();

        const result = host.getMarkdown();
        expect(result).not.toContain("\u{1F600}");
        expect(result).toContain("b");
    });
});

describe("source host — pins across local edits", () => {
    const base = "Hello world.\n";

    it("carries a pin across an edit that only moved it", () => {
        const host = mount(base);
        host.replaceSourceRange({ anchor: 0, head: 0 }, "Well, ");
        host.flush();
        expect(host.getMarkdown()).toBe("Well, Hello world.\n");

        expect(host.mapPinnedRange(base, { anchor: 6, head: 11 })).toEqual({
            anchor: 12,
            head: 17,
        });
    });

    it("refuses a pin whose text the edit replaced", () => {
        const host = mount(base);
        host.replaceSourceRange({ anchor: 6, head: 11 }, "EVERYONE");
        host.flush();
        expect(host.getMarkdown()).toBe("Hello EVERYONE.\n");

        expect(host.mapPinnedRange(base, { anchor: 6, head: 11 })).toBeNull();
    });

    // A clean reload, a restore and a conflict resolution all arrive here as
    // `replaceMarkdown`. None of them is an edit anything can be mapped across:
    // the text a pin named is simply gone, and the transactions that would have
    // carried it never existed.
    it("forgets every pin an external replace discarded the text of", () => {
        const host = mount(base);
        // Mappable before the replace, so the refusal afterwards is the
        // replace's doing and not a pin that never worked.
        expect(host.mapPinnedRange(base, { anchor: 6, head: 11 })).toEqual({
            anchor: 6,
            head: 11,
        });

        expect(host.replaceMarkdown("Something else entirely.\n")).toBe(true);

        expect(host.mapPinnedRange(base, { anchor: 6, head: 11 })).toBeNull();
    });

    it("refuses a pin whose base state this surface never held", () => {
        const host = mount(base);
        expect(
            host.mapPinnedRange("Never seen.\n", { anchor: 0, head: 0 }),
        ).toBeNull();
    });
});

describe("source host — ordinary LF documents are unaffected", () => {
    it("applies an edit", () => {
        const host = mount("hello\n");
        expect(host.replaceSourceRange({ anchor: 5, head: 5 }, " world")).toBe(
            true,
        );
        host.flush();
        expect(host.getMarkdown()).toBe("hello world\n");
    });

    it("applies a selection", () => {
        const host = mount("hello\n");
        expect(host.setSelection({ anchor: 1, head: 4 })).toBe(true);
        expect(host.getSelection()).toEqual({ anchor: 1, head: 4 });
    });

    it("refuses an offset past the end", () => {
        const host = mount("hello\n");
        expect(host.setSelection({ anchor: 99, head: 99 })).toBe(false);
    });
});
