// @vitest-environment jsdom
import { $prose } from "@milkdown/kit/utils";
import { afterEach, describe, expect, it } from "vitest";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { mathFixtures } from "../../../test/syntax-fixtures";
import { mathPlugins } from "./index";
import { renderMath } from "./render";
import {
    findInlineMathRuns,
    inlineMathEscapeOffsets,
    isAcceptedInlineMath,
    unescapeMarkdownPunctuation,
} from "./syntax";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

interface Mounted {
    host: MilkdownEditorHost;
    root: HTMLElement;
    view: EditorView;
}

async function mount(markdown: string): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);

    let view: EditorView | null = null;
    const capture = $prose(
        () =>
            new Plugin({
                key: new PluginKey("math-test-capture"),
                view: (editorView) => {
                    view = editorView;
                    return {};
                },
            }),
    );

    const plugins: MilkdownPlugin[] = [
        ...createBaseMilkdownPlugins(),
        ...mathPlugins(),
        capture,
    ];
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins,
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);

    if (!view) throw new Error("editor view was never created");
    return { host, root, view };
}

/**
 * The host only reserializes once a transaction dirties the document, so
 * fidelity is measured by editing an anchor paragraph that sits outside the
 * fixture and reading the whole document back.
 */
const ANCHOR = "Anchor.\n\n";

async function roundTrip(markdown: string): Promise<string> {
    const { host } = await mount(`${ANCHOR}${markdown}`);
    expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
    host.flush();
    const serialized = host.getMarkdown();
    expect(serialized.startsWith(`X${ANCHOR}`)).toBe(true);
    return serialized.slice(`X${ANCHOR}`.length);
}

function mathElements(root: HTMLElement, kind: "inline" | "block") {
    return [
        ...root.querySelectorAll<HTMLElement>(
            `[data-mdx-node-type='math_${kind}']`,
        ),
    ];
}

describe("inline math rules", () => {
    it("accepts a single-dollar span that is not padded", () => {
        expect(isAcceptedInlineMath("$e^{i\\pi} + 1 = 0$", " ")).toBe(true);
        expect(isAcceptedInlineMath("$\\frac{1}{$", " ")).toBe(true);
    });

    it("rejects a span padded with whitespace", () => {
        expect(isAcceptedInlineMath("$ a $", "")).toBe(false);
        expect(isAcceptedInlineMath("$a $", "")).toBe(false);
        expect(isAcceptedInlineMath("$ a$", "")).toBe(false);
    });

    it("rejects a span closed right before a digit", () => {
        expect(isAcceptedInlineMath("$5 and $", "1")).toBe(false);
    });

    it("accepts a span fenced by two dollars whatever surrounds it", () => {
        expect(isAcceptedInlineMath("$$5 and $$", "1")).toBe(true);
    });

    it("finds the runs micromark would tokenize", () => {
        expect(findInlineMathRuns("a $x$ b $y$", "")).toEqual([
            { start: 2, end: 5 },
            { start: 8, end: 11 },
        ]);
        expect(findInlineMathRuns("costs $5 and $10 today", "")).toEqual([]);
        expect(findInlineMathRuns("unterminated $ here", "")).toEqual([]);
    });

    it("escapes both fences of every run it finds", () => {
        expect(inlineMathEscapeOffsets("$a$", "")).toEqual([0, 2]);
        expect(inlineMathEscapeOffsets("$$a$$", "")).toEqual([0, 1, 3, 4]);
        expect(inlineMathEscapeOffsets("costs $5 and $10", "")).toEqual([]);
    });

    it("undoes only character escapes", () => {
        expect(unescapeMarkdownPunctuation("$5 \\[a] and $")).toBe(
            "$5 [a] and $",
        );
        expect(unescapeMarkdownPunctuation("\\\\*")).toBe("\\*");
        expect(unescapeMarkdownPunctuation("\\pi")).toBe("\\pi");
    });
});

/**
 * How many nodes of each kind the source must build. Asserted alongside every
 * byte comparison because prose that is never recognized as math also survives
 * a round trip untouched: bytes alone cannot tell the two apart.
 */
interface MathShape {
    inline?: number;
    block?: number;
}

async function expectShape(
    markdown: string,
    shape: MathShape,
): Promise<void> {
    const { root } = await mount(markdown);
    expect(mathElements(root, "inline")).toHaveLength(shape.inline ?? 0);
    expect(mathElements(root, "block")).toHaveLength(shape.block ?? 0);
}

describe("math round trip", () => {
    const fixtureShapes: Record<string, MathShape> = {
        "inline math": { inline: 1 },
        "display math": { block: 1 },
        "invalid latex keeps its source": { inline: 1 },
    };

    for (const fixture of mathFixtures) {
        it(`preserves ${fixture.name}`, async () => {
            await expectShape(fixture.markdown, fixtureShapes[fixture.name]);
            const serialized = await roundTrip(fixture.markdown);
            for (const slice of fixture.preservedSlices) {
                expect(serialized).toContain(slice);
            }
            expect(serialized).toBe(fixture.markdown);
        });
    }

    const cases: Array<[string, string, MathShape]> = [
        [
            "inline math mid sentence",
            "Euler wrote $e^{i\\pi} + 1 = 0$ here.\n",
            { inline: 1 },
        ],
        ["inline math opening a paragraph", "$a + b$ is the sum.\n", { inline: 1 }],
        ["inline math closing a paragraph", "The sum is $a + b$\n", { inline: 1 }],
        ["two spans in one paragraph", "Both $a$ and $b$ here.\n", { inline: 2 }],
        ["adjacent spans", "Both $a$$b$ here.\n", { inline: 1 }],
        ["inline math in a heading", "# About $a^2$\n", { inline: 1 }],
        ["inline math in a list item", "- See $a^2$\n", { inline: 1 }],
        ["inline math in a blockquote", "> See $a^2$\n", { inline: 1 }],
        ["inline math inside emphasis", "See *$a^2$* now.\n", { inline: 1 }],
        [
            "latex with escaped braces",
            "Set $\\{x \\mid x > 0\\}$ here.\n",
            { inline: 1 },
        ],
        ["latex with a backslash pair", "Row $a \\\\ b$ here.\n", { inline: 1 }],
        [
            "display math",
            "$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n",
            { block: 1 },
        ],
        ["display math with several lines", "$$\na = b\nc = d\n$$\n", { block: 1 }],
        ["display math in a blockquote", "> $$\n> a = b\n> $$\n", { block: 1 }],
        [
            "display math after a paragraph",
            "Lead.\n\n$$\na = b\n$$\n",
            { block: 1 },
        ],
        ["price run", "It costs $5 and $10 today.\n", {}],
        ["lone dollar", "Only $5 today.\n", {}],
        ["unterminated dollar", "Unterminated $ here.\n", {}],
        ["padded dollars are not math", "Spend $ 5 $ today.\n", {}],
        ["dollars in inline code", "Literal `$x$` stays code.\n", {}],
        ["dollars in a fenced code block", "```md\n$x$\n$$\ny = 1\n$$\n```\n", {}],
        ["broken latex", "Broken $\\frac{1}{$ math.\n", { inline: 1 }],
        ["display math holding a dollar", "$$\na \\$ b\n$$\n", { block: 1 }],
        ["display math with a fence tag", "$$align\na = b\n$$\n", { block: 1 }],
    ];

    for (const [name, markdown, shape] of cases) {
        it(`serializes ${name} byte for byte`, async () => {
            await expectShape(markdown, shape);
            expect(await roundTrip(markdown)).toBe(markdown);
        });
    }

    it("keeps a load-bearing dollar escape", async () => {
        const markdown = "Escaped \\$e^{i\\pi}\\$ stays prose.\n";
        await expectShape(markdown, {});
        expect(await roundTrip(markdown)).toBe(markdown);
    });

    it("does not read math across a blank line", async () => {
        const markdown = "Open $a\n\nb$ close.\n";
        await expectShape(markdown, {});
        expect(await roundTrip(markdown)).toBe(markdown);
    });

    it("keeps a table cell's math intact", async () => {
        // Baseline GFM pads table cells to a common width, which is not this
        // plugin's business; what matters is the formula inside the cell.
        await expectShape("| a |\n| - |\n| $x^2$ |\n", { inline: 1 });
        const once = await roundTrip("| a |\n| - |\n| $x^2$ |\n");
        expect(once).toContain("$x^2$");
        expect(await roundTrip(once)).toBe(once);
    });

    it("keeps a list item's display math intact", async () => {
        // The leading `<br />` is the commonmark `list_item` content shape
        // (`paragraph block*`) forcing an empty paragraph before any leading
        // block, exactly as it does for a fenced code block. The math itself
        // survives, and the result is stable.
        await expectShape("- $$\n  a = b\n  $$\n", { block: 1 });
        const once = await roundTrip("- $$\n  a = b\n  $$\n");
        expect(once).toContain("$$\n  a = b\n  $$");
        expect(await roundTrip(once)).toBe(once);
    });

    it("keeps prose escaped once it has been escaped", async () => {
        // The demoted span carries the serializer's own backslashes, so a
        // second pass must not stack another one on top of them.
        const markdown = "Prices $5 \\[a] and $10 today.\n";
        await expectShape(markdown, {});
        const once = await roundTrip(markdown);
        expect(once).toBe(markdown);
        expect(await roundTrip(once)).toBe(once);
    });

    /**
     * Round trips that settle on different bytes than they started with. Each
     * one is stable from the second pass on, which is what keeps a document
     * from drifting further with every keystroke.
     */
    const normalized: Array<[string, string, string]> = [
        [
            "a redundant dollar escape",
            "Costs \\$5 today.\n",
            "Costs $5 today.\n",
        ],
        ["an inline double fence", "Sum $$a + b$$ here.\n", "Sum $a + b$ here.\n"],
        [
            "an unclosed display fence",
            "Lead\n$$ tail.\n",
            "Lead\n\n$$tail.\n$$\n",
        ],
    ];

    for (const [name, markdown, settled] of normalized) {
        it(`settles ${name}`, async () => {
            expect(await roundTrip(markdown)).toBe(settled);
            expect(await roundTrip(settled)).toBe(settled);
        });
    }
});

describe("math document structure", () => {
    it("builds an inline node carrying the latex source", async () => {
        const { root } = await mount("Euler wrote $e^{i\\pi} + 1 = 0$ here.\n");
        const [element] = mathElements(root, "inline");
        expect(element).toBeDefined();
        expect(element.getAttribute("data-mdx-latex")).toBe(
            "e^{i\\pi} + 1 = 0",
        );
    });

    it("builds a block node whose text content is the latex", async () => {
        const { root } = await mount("$$\n\\int_0^1 x\\,dx\n$$\n");
        const [element] = mathElements(root, "block");
        expect(element).toBeDefined();
        expect(element.querySelector("code")?.textContent).toBe(
            "\\int_0^1 x\\,dx",
        );
    });

    it("renders katex beside the source, never inside it", async () => {
        const { root } = await mount("$$\n\\int_0^1 x\\,dx\n$$\n");
        const [element] = mathElements(root, "block");
        const preview = element.querySelector(".mdx-math-preview");
        expect(preview?.querySelector(".katex")).not.toBeNull();
        expect(element.querySelector("code")?.textContent).toBe(
            "\\int_0^1 x\\,dx",
        );
        expect(preview?.getAttribute("contenteditable")).toBe("false");
    });

    it("makes no math node for a price run", async () => {
        const { root } = await mount("It costs $5 and $10 today.\n");
        expect(mathElements(root, "inline")).toHaveLength(0);
        expect(mathElements(root, "block")).toHaveLength(0);
    });

    it("makes no math node inside inline code", async () => {
        const { root } = await mount("Literal `$x$` stays code.\n");
        expect(mathElements(root, "inline")).toHaveLength(0);
        expect(root.querySelector("code")?.textContent).toBe("$x$");
    });

    it("makes no math node inside a fenced code block", async () => {
        const { root } = await mount("```md\n$x$\n$$\ny = 1\n$$\n```\n");
        expect(mathElements(root, "inline")).toHaveLength(0);
        expect(mathElements(root, "block")).toHaveLength(0);
    });

    it("makes no math node for an escaped dollar", async () => {
        const { root } = await mount("Escaped \\$e^{i\\pi}\\$ stays prose.\n");
        expect(mathElements(root, "inline")).toHaveLength(0);
    });

    it("makes no math node across a blank line", async () => {
        const { root } = await mount("Open $a\n\nb$ close.\n");
        expect(mathElements(root, "inline")).toHaveLength(0);
        expect(mathElements(root, "block")).toHaveLength(0);
    });

    it("makes no math node for whitespace-padded dollars", async () => {
        const { root } = await mount("Spend $ 5 $ today.\n");
        expect(mathElements(root, "inline")).toHaveLength(0);
    });
});

describe("math source stays authoritative", () => {
    it("keeps the katex preview out of the serialized document", async () => {
        const { host, root } = await mount(
            `${ANCHOR}$$\n\\int_0^1 x\\,dx\n$$\n`,
        );
        expect(root.querySelector(".katex")).not.toBeNull();
        expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
        host.flush();
        const serialized = host.getMarkdown();
        expect(serialized).toBe(`X${ANCHOR}$$\n\\int_0^1 x\\,dx\n$$\n`);
        expect(serialized).not.toContain("katex");
        expect(serialized).not.toContain("<span");
    });

    it("keeps the katex preview out of the node's text content", async () => {
        const { view } = await mount("$$\n\\int_0^1 x\\,dx\n$$\n");
        const block = view.state.doc.child(0);
        expect(block.type.name).toBe("math_block");
        expect(block.textContent).toBe("\\int_0^1 x\\,dx");

        const { view: inlineView } = await mount("Sum $a + b$ here.\n");
        const inline = inlineView.state.doc.child(0).child(1);
        expect(inline.type.name).toBe("math_inline");
        expect(inline.textContent).toBe("");
        expect(inline.attrs.latex).toBe("a + b");
    });

    it("edits display math as ordinary document text", async () => {
        const { host, view } = await mount("$$\na = b\n$$\n");
        const start = 1;
        view.dispatch(
            view.state.tr.insertText(
                "c = d",
                start,
                start + "a = b".length,
            ),
        );
        host.flush();
        expect(host.getMarkdown()).toBe("$$\nc = d\n$$\n");
    });

    it("edits inline math through the node view input", async () => {
        const { host, root } = await mount("Sum $a + b$ here.\n");
        const [element] = mathElements(root, "inline");
        const preview = element.querySelector<HTMLElement>(".mdx-math-preview");
        preview?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        const input = element.querySelector<HTMLInputElement>(
            "input.mdx-math-source",
        );
        expect(input).not.toBeNull();
        expect(input?.value).toBe("a + b");

        input!.value = "a - b";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        host.flush();

        expect(host.getMarkdown()).toBe("Sum $a - b$ here.\n");
        expect(element.getAttribute("data-mdx-latex")).toBe("a - b");
    });
});

describe("invalid latex", () => {
    it("reports the failure in the preview and keeps the source", async () => {
        const { root } = await mount("Broken $\\frac{1}{$ math.\n");
        const [element] = mathElements(root, "inline");
        expect(element.getAttribute("data-mdx-latex")).toBe("\\frac{1}{");
        const preview = element.querySelector(".mdx-math-preview");
        expect(preview?.hasAttribute("data-mdx-math-invalid")).toBe(true);
        expect(preview?.querySelector(".mdx-math-error")?.textContent).toContain(
            "KaTeX",
        );
        expect(
            preview?.querySelector(".mdx-math-source-fallback")?.textContent,
        ).toBe("\\frac{1}{");
    });

    it("leaves the document editable after a failed render", async () => {
        const { host, root } = await mount(
            `${ANCHOR}Broken $\\frac{1}{$ math.\n`,
        );
        expect(mathElements(root, "inline")).toHaveLength(1);
        expect(host.hasFailed()).toBe(false);
        expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
        host.flush();
        expect(host.getMarkdown()).toBe(
            `X${ANCHOR}Broken $\\frac{1}{$ math.\n`,
        );
        expect(host.hasFailed()).toBe(false);
    });
});

/** The rendered markup as elements, so attributes can be told from text. */
function renderedElements(html: string): Element[] {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    return Array.from(holder.querySelectorAll("*"));
}

describe("the math preview is not a markup channel", () => {
    // KaTeX output is assigned to `innerHTML` without going through the
    // sanitizer, so `trust` is the whole defence: with it on, `\href` and
    // `\includegraphics` put an author-chosen URL straight into the document
    // as an attribute the browser acts on. With it off the same command is
    // rendered as the inert error text it now is.
    it("does not render a link out of \\href", () => {
        const rendered = renderMath("\\href{javascript:alert(1)}{x}", false);
        expect(
            renderedElements(rendered.html).filter((element) =>
                element.hasAttribute("href"),
            ),
        ).toEqual([]);
        expect(rendered.html).toContain("href");
    });

    it("does not fetch an image out of \\includegraphics", () => {
        const rendered = renderMath(
            "\\includegraphics[width=1cm]{https://evil.test/a.png}",
            true,
        );
        expect(
            renderedElements(rendered.html).filter((element) =>
                element.hasAttribute("src"),
            ),
        ).toEqual([]);
    });

    it("keeps a blocked command out of the mounted preview too", async () => {
        const { root } = await mount(
            `${ANCHOR}Link $\\href{javascript:alert(1)}{x}$ here.\n`,
        );
        const [element] = mathElements(root, "inline");
        const preview = element.querySelector(".mdx-math-preview");
        expect(preview?.querySelector("[href]")).toBeNull();
        expect(preview?.querySelector("[src]")).toBeNull();
    });
});
