// @vitest-environment jsdom
import { $prose } from "@milkdown/kit/utils";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { DOMParser } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { wikilinkFixtures } from "../../../test/syntax-fixtures";
import {
    wikilinkClickCtx,
    wikilinkPlugins,
    type WikilinkActivation,
} from "./index";
import { findWikilinks, formatWikilink, parseWikilinkBody } from "./syntax";

const EDIT_ANCHOR = "Edit anchor.\n\n";
const EDITED_ANCHOR = "Edit the anchor.\n\n";
/** Offset of `anchor` inside `EDIT_ANCHOR`, the one place every test edits. */
const EDIT_OFFSET = EDIT_ANCHOR.indexOf("anchor");

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
    clicks: WikilinkActivation[];
    view: EditorView;
}

async function mount(markdown: string): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);

    const clicks: WikilinkActivation[] = [];
    let view: EditorView | null = null;

    const capture = $prose(
        () =>
            new Plugin({
                key: new PluginKey("wikilink-test-capture"),
                view: (editorView) => {
                    view = editorView;
                    return {};
                },
            }),
    );
    const installHandler: MilkdownPlugin = (ctx) => () => {
        ctx.set(wikilinkClickCtx.key, (activation) => {
            clicks.push(activation);
        });
    };

    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: [
            ...createBaseMilkdownPlugins(),
            ...wikilinkPlugins(),
            installHandler,
            capture,
        ],
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);

    if (!view) throw new Error("editor view was never created");
    return { host, root, clicks, view };
}

/**
 * Mounts `markdown` behind a throwaway paragraph, edits only that paragraph,
 * and returns the freshly serialized document. Nothing inside `markdown` is
 * touched, so any difference is the plugin's own round-trip behavior.
 */
async function roundTrip(markdown: string): Promise<string> {
    const { host } = await mount(EDIT_ANCHOR + markdown);
    expect(
        host.replaceSourceRange(
            { anchor: EDIT_OFFSET, head: EDIT_OFFSET },
            "the ",
        ),
    ).toBe(true);
    host.flush();
    const serialized = host.getMarkdown();
    expect(serialized.startsWith(EDITED_ANCHOR)).toBe(true);
    return serialized.slice(EDITED_ANCHOR.length);
}

function wikilinkElements(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>("a[data-mdx-wikilink]")];
}

describe("wikilink scanning", () => {
    it("splits on the first pipe only", () => {
        expect(parseWikilinkBody("a/b.c|x|y")).toEqual({
            target: "a/b.c",
            alias: "x|y",
        });
    });

    it("keeps a bare target unaliased", () => {
        expect(parseWikilinkBody("Target Page")).toEqual({
            target: "Target Page",
            alias: null,
        });
    });

    it("rejects an empty target", () => {
        expect(parseWikilinkBody("")).toBeNull();
        expect(parseWikilinkBody("|alias")).toBeNull();
    });

    it("rejects a body that could not be re-parsed", () => {
        expect(parseWikilinkBody("a]b")).toBeNull();
        expect(parseWikilinkBody("a[b")).toBeNull();
        expect(parseWikilinkBody("a\nb")).toBeNull();
    });

    it("finds every link in a run without overlapping", () => {
        expect(findWikilinks("a [[One]] b [[Two|2]] c")).toEqual([
            { start: 2, end: 9, target: "One", alias: null },
            { start: 12, end: 21, target: "Two", alias: "2" },
        ]);
    });

    it("finds nothing when the opener is never terminated", () => {
        expect(findWikilinks("Unterminated [[ open here.")).toEqual([]);
    });

    it("round-trips through the formatter", () => {
        for (const source of ["[[A]]", "[[A|b]]", "[[A|]]", "[[目标 页面|别名]]"]) {
            const body = parseWikilinkBody(source.slice(2, -2));
            expect(body).not.toBeNull();
            expect(formatWikilink(body!.target, body!.alias)).toBe(source);
        }
    });
});

describe("wikilink round trip", () => {
    for (const fixture of wikilinkFixtures) {
        it(`preserves ${fixture.name}`, async () => {
            const serialized = await roundTrip(fixture.markdown);
            for (const slice of fixture.preservedSlices) {
                expect(serialized).toContain(slice);
            }
            expect(serialized).toBe(fixture.markdown);
        });
    }

    const cases: Array<[string, string]> = [
        ["bare target", "See [[Target Page]] for details.\n"],
        ["aliased target", "See [[Target Page|the page]] for details.\n"],
        ["empty alias", "See [[Target Page|]] for details.\n"],
        ["cjk target and alias", "链接 [[目标 页面|别名]] 结束。\n"],
        ["dots and slashes", "Open [[notes/2026-08-13.Daily]] now.\n"],
        ["first pipe wins", "Open [[a/b.c|x|y]] now.\n"],
        ["backslash in target", "Open [[a\\b]] now.\n"],
        ["adjacent links", "Both [[One]][[Two]] here.\n"],
        ["link opens the paragraph", "[[Target Page]] leads.\n"],
        ["link closes the paragraph", "It leads to [[Target Page]]\n"],
        ["link inside a heading", "# See [[Target Page]]\n"],
        ["link inside a list item", "- See [[Target Page]]\n"],
        ["link inside a blockquote", "> See [[Target Page]]\n"],
        ["link inside emphasis", "See *[[Target Page]]* now.\n"],
        ["inline code stays literal", "Literal `[[Not A Link]]` stays code.\n"],
        [
            "fenced code stays literal",
            "```md\n[[Not a wikilink]]\n> [!NOT] a callout\n```\n",
        ],
    ];

    for (const [name, markdown] of cases) {
        it(`serializes ${name} byte for byte`, async () => {
            expect(await roundTrip(markdown)).toBe(markdown);
        });
    }

    it("leaves an indented code block literal", async () => {
        // Baseline CommonMark re-fences indented code, which is not this
        // plugin's business; what matters is that the body is not linkified.
        expect(await roundTrip("    [[Not a wikilink]]\n")).toBe(
            "```\n[[Not a wikilink]]\n```\n",
        );
    });

    it("does not linkify an unterminated opener", async () => {
        // Baseline CommonMark escapes a bare `[` in text, so the bytes change
        // from `[[` to `\[\[`. That escape is not introduced by this plugin,
        // and the result is stable: it re-parses to the same literal text.
        const once = await roundTrip("Unterminated [[ open here.\n");
        expect(once).toBe("Unterminated \\[\\[ open here.\n");
        expect(await roundTrip(once)).toBe(once);
    });
});

describe("wikilink document structure", () => {
    it("renders the alias as the visible label", async () => {
        const { root } = await mount("See [[Target Page|the page]] now.\n");
        const [element] = wikilinkElements(root);
        expect(element).toBeDefined();
        expect(element.textContent).toBe("the page");
        expect(element.getAttribute("data-mdx-wikilink-target")).toBe(
            "Target Page",
        );
        expect(element.getAttribute("data-mdx-wikilink-alias")).toBe("the page");
    });

    it("renders the target when there is no alias", async () => {
        const { root } = await mount("See [[Target Page]] now.\n");
        const [element] = wikilinkElements(root);
        expect(element.textContent).toBe("Target Page");
        expect(element.hasAttribute("data-mdx-wikilink-alias")).toBe(false);
    });

    it("does not create a node inside inline code", async () => {
        const { root } = await mount("Literal `[[Not A Link]]` stays code.\n");
        expect(wikilinkElements(root)).toHaveLength(0);
        expect(root.querySelector("code")?.textContent).toBe("[[Not A Link]]");
    });

    it("does not create a node inside a fenced code block", async () => {
        const { root } = await mount("```md\n[[Not a wikilink]]\n```\n");
        expect(wikilinkElements(root)).toHaveLength(0);
    });

    it("does not create a node for an unterminated opener", async () => {
        const { root } = await mount("Unterminated [[ open here.\n");
        expect(wikilinkElements(root)).toHaveLength(0);
    });

    it("does not create a node for an empty target", async () => {
        const { root } = await mount("Empty [[]] and [[|alias]] here.\n");
        expect(wikilinkElements(root)).toHaveLength(0);
    });

    it("creates one node per link in a paragraph", async () => {
        const { root } = await mount("Both [[One]] and [[Two|2]] here.\n");
        expect(
            wikilinkElements(root).map((element) => element.textContent),
        ).toEqual(["One", "2"]);
    });
});

describe("wikilink activation", () => {
    it("reports the parsed target and alias as strings", async () => {
        const { root, clicks } = await mount("See [[Target Page|the page]].\n");
        const [element] = wikilinkElements(root);
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(clicks).toEqual([{ target: "Target Page", alias: "the page" }]);
        expect(typeof clicks[0].target).toBe("string");
    });

    it("reports a null alias for a bare target", async () => {
        const { root, clicks } = await mount("See [[目标 页面]].\n");
        wikilinkElements(root)[0].dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
        );
        expect(clicks).toEqual([{ target: "目标 页面", alias: null }]);
    });

    it("reports each link independently", async () => {
        const { root, clicks } = await mount("[[One]] then [[Two|2]].\n");
        for (const element of wikilinkElements(root)) {
            element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
        expect(clicks).toEqual([
            { target: "One", alias: null },
            { target: "Two", alias: "2" },
        ]);
    });

    it("ignores non-primary buttons", async () => {
        const { root, clicks } = await mount("See [[Target Page]].\n");
        wikilinkElements(root)[0].dispatchEvent(
            new MouseEvent("click", { bubbles: true, button: 2 }),
        );
        expect(clicks).toEqual([]);
    });
});

describe("wikilink input rule", () => {
    /** Drives the same prop a real keystroke drives, without a real keystroke. */
    function type(view: EditorView, at: number, text: string): boolean {
        return (
            view.someProp("handleTextInput", (handler) =>
                handler(view, at, at, text, () => view.state.tr),
            ) === true
        );
    }

    it("converts the link when the closing brackets are typed", async () => {
        const { host, view } = await mount("See here.\n");
        expect(
            host.replaceSourceRange({ anchor: 4, head: 4 }, "[[Target Page]"),
        ).toBe(true);
        host.flush();

        expect(type(view, 1 + "See [[Target Page]".length, "]")).toBe(true);
        host.flush();

        expect(host.getMarkdown()).toBe("See [[Target Page]]here.\n");
    });

    it("leaves the text alone inside an inline code span", async () => {
        const { host, view } = await mount("Literal `[[X]` here.\n");
        const before = view.state.doc.toJSON();

        type(view, 1 + "Literal [[X]".length, "]");
        host.flush();

        expect(view.state.doc.toJSON()).toEqual(before);
        expect(host.getMarkdown()).toBe("Literal `[[X]` here.\n");
    });
});

describe("wikilink metadata reaching the schema is checked, not trusted", () => {
    // The clipboard guard strips `data-mdx-*` from markup it cannot attribute
    // to this session, so the schema rule is the second gate — and the only one
    // left if DOM ever reaches ProseMirror without passing the guard first. It
    // is asked directly here, because through the guard it never fires.
    async function parseAttribute(
        target: string,
        alias?: string,
    ): Promise<number> {
        const { view } = await mount("Anchor.\n");
        const holder = document.createElement("div");
        const aliasAttr =
            alias === undefined
                ? ""
                : ` data-mdx-wikilink-alias="${alias.replace(/"/g, "&quot;")}"`;
        holder.innerHTML = `<p><a data-mdx-wikilink data-mdx-wikilink-target="${target.replace(/"/g, "&quot;")}"${aliasAttr}>x</a></p>`;
        const slice = DOMParser.fromSchema(view.state.schema).parseSlice(holder);
        let found = 0;
        slice.content.descendants((node) => {
            if (node.type.name === "wikilink") found += 1;
        });
        return found;
    }

    it("builds a node from a target that survives a re-parse", async () => {
        expect(await parseAttribute("Target Page")).toBe(1);
        expect(await parseAttribute("Target", "alias")).toBe(1);
    });

    it("refuses a target that would not come back as itself", async () => {
        // Each of these serializes to `[[…]]` that reparses as something else,
        // so accepting it would rewrite the document on the next save.
        expect(await parseAttribute("")).toBe(0);
        expect(await parseAttribute("a|b")).toBe(0);
        expect(await parseAttribute("a]]b")).toBe(0);
        expect(await parseAttribute("a[[b")).toBe(0);
        expect(await parseAttribute("a\nb")).toBe(0);
    });

    it("refuses an alias that would not come back as itself", async () => {
        expect(await parseAttribute("Target", "a]]b")).toBe(0);
        expect(await parseAttribute("Target", "a[[b")).toBe(0);
    });
});
