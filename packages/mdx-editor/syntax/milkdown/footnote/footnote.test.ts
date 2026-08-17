// @vitest-environment jsdom
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { afterEach, describe, expect, it } from "vitest";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { footnoteFixtures } from "../../../test/syntax-fixtures";
import {
    FOOTNOTE_LABEL_DOM_ATTRIBUTE,
    FOOTNOTE_REFERENCE_DOM_MARKER,
    findFootnoteReferences,
    footnoteActivateCtx,
    footnotePlugins,
    formatFootnoteReference,
    isRoundTrippableFootnoteLabel,
    type FootnoteActivation,
} from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

/** The definition element the GFM preset renders, addressed by label. */
const DEFINITION_SELECTOR = 'dl[data-type="footnote_definition"]';

interface Mounted {
    host: MilkdownEditorHost;
    root: HTMLElement;
    activations: FootnoteActivation[];
}

/**
 * Every test mounts through here so removing `footnotePlugins()` from this one
 * list is the whole vacuity check.
 */
function pluginsFor(install: MilkdownPlugin): MilkdownPlugin[] {
    return [...createBaseMilkdownPlugins(), ...footnotePlugins(), install];
}

async function mount(markdown: string): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);

    const activations: FootnoteActivation[] = [];
    const install: MilkdownPlugin = (ctx) => () => {
        ctx.set(footnoteActivateCtx.key, (activation) => {
            activations.push(activation);
        });
    };

    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: pluginsFor(install),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    return { host, root, activations };
}

/**
 * The host only reserializes once the document changes, so fidelity is measured
 * by editing an anchor paragraph that sits outside the fixture and reading the
 * whole document back.
 */
const ANCHOR = "Anchor.\n\n";

async function roundTrip(fixture: string): Promise<string> {
    const { host } = await mount(`${ANCHOR}${fixture}`);
    expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
    host.flush();
    return host.getMarkdown();
}

async function expectRoundTrip(fixture: string): Promise<void> {
    expect(await roundTrip(fixture)).toBe(`X${ANCHOR}${fixture}`);
}

function requireElement<T extends Element>(
    root: ParentNode,
    selector: string,
): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`missing element: ${selector}`);
    return found;
}

function references(root: ParentNode): HTMLElement[] {
    return [
        ...root.querySelectorAll<HTMLElement>(
            `[${FOOTNOTE_REFERENCE_DOM_MARKER}]`,
        ),
    ];
}

function click(element: Element): void {
    element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
    );
}

describe("footnote label syntax", () => {
    it("finds calls and reports their labels and spans", () => {
        expect(findFootnoteReferences("a[^one] b[^two] c")).toEqual([
            { label: "one", start: 1, end: 7 },
            { label: "two", start: 9, end: 15 },
        ]);
    });

    it("rejects shapes GFM would not tokenize as a call", () => {
        for (const value of [
            "[^]",
            "[^ ]",
            "[^a b]",
            "[^a\nb]",
            "[^a[b]",
            "[^a\\]b]",
            "[a]",
            "[^abc",
        ]) {
            expect(findFootnoteReferences(value), value).toEqual([]);
        }
    });

    it("accepts labels with unicode, dots and dashes", () => {
        for (const label of ["注-释.1", "n1", "a.b-c_d", "1", "Ω"]) {
            expect(isRoundTrippableFootnoteLabel(label), label).toBe(true);
            expect(formatFootnoteReference(label)).toBe(`[^${label}]`);
        }
    });

    it("rejects labels that would not come back as themselves", () => {
        for (const label of ["", "a b", "a]b", "a[b", "a\\b"]) {
            expect(isRoundTrippableFootnoteLabel(label), label).toBe(false);
        }
    });
});

describe("footnote fidelity", () => {
    for (const fixture of footnoteFixtures) {
        it(`round-trips ${fixture.name} byte for byte`, async () => {
            await expectRoundTrip(fixture.markdown);
        });
    }

    it("round-trips a reference that nothing defines", async () => {
        await expectRoundTrip("Dangling[^missing] here.\n");
    });

    it("round-trips several undefined references in one paragraph", async () => {
        await expectRoundTrip("One[^a], two[^b], three[^c].\n");
    });

    it("keeps a definition that nothing references", async () => {
        await expectRoundTrip("Body.\n\n[^unused]: Never referenced.\n");
    });

    it("keeps labels with unicode, dots and dashes", async () => {
        await expectRoundTrip("CJK[^注-释.1] here.\n\n[^注-释.1]: Body.\n");
        await expectRoundTrip("Dot[^a.b-c] only.\n");
    });

    it("keeps two references to one definition", async () => {
        await expectRoundTrip("A[^a] and B[^a].\n\n[^a]: Body.\n");
    });

    it("keeps a definition holding several blocks", async () => {
        await expectRoundTrip("R[^m].\n\n[^m]: Para one.\n\n    Para two.\n");
    });

    it("leaves a call inside inline code literal", async () => {
        const result = await roundTrip("Literal `[^n]` stays code.\n");
        expect(result).toBe(`X${ANCHOR}Literal \`[^n]\` stays code.\n`);
    });

    it("leaves a call inside a fenced code block literal", async () => {
        await expectRoundTrip("```js\nconst a = x[^n];\n```\n");
    });

    it("leaves an escaped call escaped", async () => {
        await expectRoundTrip("Dangling\\[^missing] here.\n");
    });
});

describe("footnote fidelity away from the first line", () => {
    // The commonmark preset splits soft line breaks into `break` nodes, and the
    // text fragments it leaves behind carry no source position. Registering the
    // footnote transformer after that splitter left every call below line one as
    // text, which the writer then escaped to `\[^a]`.
    it("keeps a call on a paragraph's second line", async () => {
        await expectRoundTrip("first line\ncall[^a]\n");
    });

    it("keeps a call on a blockquote's second line", async () => {
        await expectRoundTrip("> first line\n> call[^a]\n");
    });

    it("keeps a call on a list item's second line", async () => {
        await expectRoundTrip("- first line\n  call[^a]\n");
    });

    it("keeps a call on the third line of a blockquote", async () => {
        await expectRoundTrip("> one\n> two\n> call[^a]\n");
    });

    it("makes a second-line call a reference, not text", async () => {
        const { root } = await mount(`${ANCHOR}> first line\n> call[^a]\n`);
        const found = references(root);
        expect(found).toHaveLength(1);
        expect(found[0].getAttribute(FOOTNOTE_LABEL_DOM_ATTRIBUTE)).toBe("a");
    });

    // The other half of the same guard: the decoration a container puts in front
    // of a continuation line may be discounted, but a backslash never may.
    it("leaves an escaped call on a second line escaped", async () => {
        await expectRoundTrip("first line\ncall\\[^a]\n");
    });

    it("leaves an escaped call on a blockquote's second line escaped", async () => {
        await expectRoundTrip("> first line\n> call\\[^a]\n");
    });

    it("leaves an escaped call on a list item's second line escaped", async () => {
        await expectRoundTrip("- first line\n  call\\[^a]\n");
    });

    // The escape is the last thing the container prefix hides: the value line is
    // `[^a]` and the source line is `> \[^a]`, so the suffixes agree and only
    // what was dropped tells the two apart.
    it("leaves a wholly escaped continuation line escaped", async () => {
        await expectRoundTrip("> first line\n> \\[^a]\n");
        await expectRoundTrip("- first line\n  \\[^a]\n");
    });

    it("does not make an escaped second-line call a reference", async () => {
        const { root } = await mount(`${ANCHOR}> first line\n> call\\[^a]\n`);
        expect(references(root)).toHaveLength(0);
    });
});

describe("footnote structure", () => {
    it("makes a reference with no definition a reference all the same", async () => {
        const { root } = await mount(`${ANCHOR}Dangling[^missing] here.\n`);
        const found = references(root);
        expect(found).toHaveLength(1);
        expect(found[0].getAttribute(FOOTNOTE_LABEL_DOM_ATTRIBUTE)).toBe(
            "missing",
        );
        expect(root.querySelector(DEFINITION_SELECTOR)).toBeNull();
    });

    it("does not turn an escaped call into a reference", async () => {
        const { root } = await mount(`${ANCHOR}Dangling\\[^missing] here.\n`);
        expect(references(root)).toHaveLength(0);
    });

    it("does not turn a call inside inline code into a reference", async () => {
        const { root } = await mount(`${ANCHOR}Literal \`[^n]\` stays.\n`);
        expect(references(root)).toHaveLength(0);
    });

    it("exposes the label on both the reference and the definition", async () => {
        const { root } = await mount(
            `${ANCHOR}Text with a note[^n1].\n\n[^n1]: The note body.\n`,
        );
        const reference = requireElement<HTMLElement>(
            root,
            `[${FOOTNOTE_REFERENCE_DOM_MARKER}]`,
        );
        expect(reference.getAttribute(FOOTNOTE_LABEL_DOM_ATTRIBUTE)).toBe("n1");

        const definition = requireElement<HTMLElement>(
            root,
            DEFINITION_SELECTOR,
        );
        expect(definition.getAttribute("data-label")).toBe("n1");
        expect(definition.textContent).toContain("The note body.");
    });
});

describe("footnote navigation", () => {
    it("reports the label as a plain string when a reference is activated", async () => {
        const { root, activations } = await mount(
            `${ANCHOR}Text with a note[^n1].\n\n[^n1]: The note body.\n`,
        );
        click(requireElement(root, `[${FOOTNOTE_REFERENCE_DOM_MARKER}]`));

        expect(activations).toEqual([{ label: "n1" }]);
        expect(typeof activations[0].label).toBe("string");
    });

    it("hands back a label that addresses the definition", async () => {
        const { root, activations } = await mount(
            `${ANCHOR}CJK[^注-释.1] here.\n\n[^注-释.1]: Body.\n`,
        );
        click(requireElement(root, `[${FOOTNOTE_REFERENCE_DOM_MARKER}]`));

        expect(activations).toHaveLength(1);
        const definition = requireElement<HTMLElement>(
            root,
            `${DEFINITION_SELECTOR}[data-label="${activations[0].label}"]`,
        );
        expect(definition.textContent).toContain("Body.");
    });

    it("reports a reference whose definition does not exist yet", async () => {
        const { root, activations } = await mount(
            `${ANCHOR}Dangling[^missing] here.\n`,
        );
        click(requireElement(root, `[${FOOTNOTE_REFERENCE_DOM_MARKER}]`));

        expect(activations).toEqual([{ label: "missing" }]);
        expect(
            root.querySelector(
                `${DEFINITION_SELECTOR}[data-label="missing"]`,
            ),
        ).toBeNull();
    });

    it("distinguishes two references in the same paragraph", async () => {
        const { root, activations } = await mount(
            `${ANCHOR}A[^a] and B[^b].\n\n[^a]: One.\n\n[^b]: Two.\n`,
        );
        const found = references(root);
        expect(found).toHaveLength(2);
        click(found[1]);
        click(found[0]);
        expect(activations).toEqual([{ label: "b" }, { label: "a" }]);
    });
});
