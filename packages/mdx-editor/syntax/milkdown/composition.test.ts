// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../milkdown/editor-host";
import { createBaseMilkdownPlugins } from "../../milkdown/base-plugins";
import {
    calloutFixtures,
    footnoteFixtures,
    frontmatterFixtures,
    mermaidFixtures,
    mixedSyntaxFixtures,
    wikilinkFixtures,
    type SyntaxFixture,
} from "../../test/syntax-fixtures";
import { createMdxMilkdownPlugins } from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

async function mount(markdown: string): Promise<MilkdownEditorHost> {
    const root = document.createElement("div");
    document.body.append(root);
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: createMdxMilkdownPlugins(),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    return host;
}

/**
 * Serialization only runs once a transaction dirties the document, so every
 * fidelity assertion has to make an edit first. The edit is appended as a whole
 * new trailing paragraph so it never lands inside the slice under test.
 */
async function roundTripAfterEdit(markdown: string): Promise<string> {
    const host = await mount(markdown);
    const end = host.getMarkdown().length;
    host.replaceSourceRange({ anchor: end, head: end }, "edited");
    host.flush();
    return host.getMarkdown();
}

function expectSlicesPreserved(result: string, fixture: SyntaxFixture): void {
    for (const slice of fixture.preservedSlices) {
        expect(
            result.includes(slice),
            `expected ${fixture.name} to preserve ${JSON.stringify(slice)} but got ${JSON.stringify(result)}`,
        ).toBe(true);
    }
}

describe("composed syntax layer — each family still works alongside the others", () => {
    const families: Array<[string, SyntaxFixture[]]> = [
        ["frontmatter", frontmatterFixtures],
        ["wikilink", wikilinkFixtures],
        ["callout", calloutFixtures],
        ["mermaid", mermaidFixtures],
        ["footnote", footnoteFixtures],
    ];

    for (const [family, fixtures] of families) {
        for (const fixture of fixtures) {
            it(`${family}: ${fixture.name}`, async () => {
                const result = await roundTripAfterEdit(fixture.markdown);
                expectSlicesPreserved(result, fixture);
            });
        }
    }
});

describe("composed syntax layer — plugin boundaries", () => {
    it("keeps leading frontmatter and a later callout apart", async () => {
        const markdown = "---\na: 1\n---\n\n> [!NOTE]\n> body\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("---\na: 1\n---");
        expect(result).toContain("[!NOTE]");
    });

    it("keeps a wikilink inside a callout body", async () => {
        const markdown = "> [!TIP]\n> see [[Target Page|alias]] here\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("[!TIP]");
        expect(result).toContain("[[Target Page|alias]]");
    });

    it("does not read a wikilink inside frontmatter as a link", async () => {
        const markdown = "---\nrelated: [[Not A Link]]\n---\n\nbody\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("related: [[Not A Link]]");
    });

    it("does not read a callout marker inside a fenced code block", async () => {
        const markdown = "```md\n> [!WARNING]\n[[Not A Link]]\n```\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("> [!WARNING]\n[[Not A Link]]");
    });

    it("keeps a footnote reference recognised when wikilink also splits text", async () => {
        // Both plugins split inline text nodes, and a fragment produced by one
        // carries no source position. Registering footnote after wikilink would
        // silently stop it recognising references in the same paragraph.
        const markdown = "See [[Target]] and a note[^n1] together.\n\n[^n1]: body\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("[[Target]]");
        expect(result).toContain("[^n1]");
        expect(result).not.toContain("\\[^n1]");
    });

    it("keeps a dangling footnote reference unescaped alongside a wikilink", async () => {
        const markdown = "See [[Target]] and [^missing] here.\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("[[Target]]");
        expect(result).not.toContain("\\[^missing]");
    });

    it("keeps a dangling footnote reference on a callout's body line", async () => {
        // A callout body is a blockquote continuation line, so the call sits on
        // neither the paragraph's first line nor at a position remark reports
        // verbatim: the source slice still carries the `> ` the container owns.
        const result = await roundTripAfterEdit("> [!NOTE]\n> call[^a]\n");
        expect(result).toContain("[!NOTE]");
        expect(result).toContain("> call[^a]");
        expect(result).not.toContain("\\[^a]");
    });

    it("keeps a mermaid fence out of the callout and wikilink paths", async () => {
        const markdown =
            "> [!NOTE]\n> see [[Target]]\n\n```mermaid\ngraph TD\n  A[[X]] --> B\n```\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("[!NOTE]");
        expect(result).toContain("[[Target]]");
        expect(result).toContain("graph TD\n  A[[X]] --> B");
    });

    it("keeps adjacent callouts separate", async () => {
        const markdown = "> [!NOTE]\n> first\n\n> [!WARNING]\n> second\n";
        const result = await roundTripAfterEdit(markdown);
        expect(result).toContain("[!NOTE]");
        expect(result).toContain("[!WARNING]");
        expect(result).toContain("first");
        expect(result).toContain("second");
    });
});

describe("composed syntax layer — the composition is what fixes the corruption", () => {
    // These are the exact corruptions the base commonmark + GFM preset produces.
    // Running the same input through both plugin sets proves the syntax layer is
    // load-bearing rather than incidental.
    async function roundTripWithBaseOnly(markdown: string): Promise<string> {
        const root = document.createElement("div");
        document.body.append(root);
        const host = await createMilkdownEditorHost({
            root,
            markdown,
            editable: true,
            plugins: createBaseMilkdownPlugins(),
            onMarkdownChange: () => {},
            onSelectionChange: () => {},
        });
        mounted.push(host);
        const end = host.getMarkdown().length;
        host.replaceSourceRange({ anchor: end, head: end }, "edited");
        host.flush();
        return host.getMarkdown();
    }

    it("frontmatter survives only with the syntax layer", async () => {
        const markdown = "---\ntitle: x\n---\n\nbody\n";
        expect(await roundTripWithBaseOnly(markdown)).not.toContain(
            "---\ntitle: x\n---",
        );
        expect(await roundTripAfterEdit(markdown)).toContain("---\ntitle: x\n---");
    });

    it("wikilinks survive only with the syntax layer", async () => {
        const markdown = "see [[Target]] here\n";
        expect(await roundTripWithBaseOnly(markdown)).toContain("\\[\\[Target]]");
        expect(await roundTripAfterEdit(markdown)).toContain("[[Target]]");
    });

    it("callouts survive only with the syntax layer", async () => {
        const markdown = "> [!WARNING]\n> careful\n";
        expect(await roundTripWithBaseOnly(markdown)).toContain("\\[!WARNING]");
        expect(await roundTripAfterEdit(markdown)).toContain("[!WARNING]");
    });
});

describe("composed syntax layer — mixed documents", () => {
    for (const fixture of mixedSyntaxFixtures) {
        it(fixture.name, async () => {
            const result = await roundTripAfterEdit(fixture.markdown);
            expectSlicesPreserved(result, fixture);
        });
    }
});
