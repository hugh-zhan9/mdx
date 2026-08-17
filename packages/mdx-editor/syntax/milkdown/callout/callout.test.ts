// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { MilkdownPlugin } from "@milkdown/ctx";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { calloutFixtures } from "../../../test/syntax-fixtures";
import { calloutPlugins } from "./index";
import {
    formatCalloutMarker,
    parseCalloutMarker,
    sanitizeCalloutKind,
    sanitizeCalloutTitle,
} from "./marker";

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
}

async function mount(
    markdown: string,
    plugins: MilkdownPlugin[] = [
        ...createBaseMilkdownPlugins(),
        ...calloutPlugins(),
    ],
): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins,
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);
    return { host, root };
}

/**
 * The host only reserializes once the document changes, so fidelity is measured
 * by editing an anchor paragraph that sits outside the fixture and reading the
 * whole document back.
 */
const ANCHOR = "Anchor.\n\n";

async function serializeAfterOutsideEdit(
    fixture: string,
    plugins?: MilkdownPlugin[],
): Promise<string> {
    const { host } = await mount(`${ANCHOR}${fixture}`, plugins);
    expect(host.replaceSourceRange({ anchor: 0, head: 0 }, "X")).toBe(true);
    host.flush();
    return host.getMarkdown();
}

async function expectRoundTrip(fixture: string): Promise<void> {
    expect(await serializeAfterOutsideEdit(fixture)).toBe(`X${ANCHOR}${fixture}`);
}

function requireElement<T extends Element>(
    root: ParentNode,
    selector: string,
): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`missing element: ${selector}`);
    return found;
}

describe("callout marker", () => {
    it("splits type and title and rebuilds the exact line", () => {
        const cases = [
            "[!WARNING]",
            "[!NOTE] Custom title",
            "[!BANANA]",
            "[!warning]",
            "[!Warning]",
            "[!NOT A TYPE] x",
            "[!]",
            "[!NOTE]  leading space kept",
            "[!NOTE] **bold title**",
        ];
        for (const line of cases) {
            const marker = parseCalloutMarker(line);
            expect(marker, line).not.toBeNull();
            expect(formatCalloutMarker(marker!)).toBe(line);
        }
    });

    it("reports type and title separately", () => {
        expect(parseCalloutMarker("[!NOTE] Custom title")).toEqual({
            kind: "NOTE",
            title: "Custom title",
        });
        expect(parseCalloutMarker("[!WARNING]")).toEqual({
            kind: "WARNING",
            title: "",
        });
        expect(parseCalloutMarker("[!]")).toEqual({ kind: "", title: "" });
    });

    it("rejects lines that are not markers", () => {
        expect(parseCalloutMarker("plain quote")).toBeNull();
        expect(parseCalloutMarker("[NOTE]")).toBeNull();
        expect(parseCalloutMarker("text [!NOTE]")).toBeNull();
        expect(parseCalloutMarker("[!NOTE")).toBeNull();
    });

    it("drops characters that would reshape the marker line", () => {
        expect(sanitizeCalloutKind("WA]RN[ING\n")).toBe("WARNING");
        expect(sanitizeCalloutTitle("one\ntwo")).toBe("onetwo");
    });
});

describe("callout round-trip fidelity", () => {
    for (const fixture of calloutFixtures) {
        it(`preserves the ${fixture.name} fixture byte-for-byte`, async () => {
            await expectRoundTrip(fixture.markdown);
            for (const slice of fixture.preservedSlices) {
                expect(
                    await serializeAfterOutsideEdit(fixture.markdown),
                ).toContain(slice);
            }
        });
    }

    it("preserves a callout with no title", async () => {
        await expectRoundTrip("> [!WARNING]\n> Be careful here.\n");
    });

    it("preserves a callout with a custom title", async () => {
        await expectRoundTrip("> [!NOTE] Custom title\n> Body line.\n");
    });

    it("preserves an unknown callout type", async () => {
        await expectRoundTrip("> [!BANANA]\n> Unrecognized type.\n");
    });

    it("preserves lowercase and mixed-case types", async () => {
        await expectRoundTrip("> [!warning]\n> lower.\n");
        await expectRoundTrip("> [!Warning]\n> mixed.\n");
        await expectRoundTrip("> [!nOtE] Odd casing\n> body.\n");
    });

    it("leaves a plain blockquote alone", async () => {
        await expectRoundTrip("> Just a quote.\n> Second line.\n");
        await expectRoundTrip("> Quote.\n>\n> Second paragraph.\n");
    });

    it("preserves markers that only resemble a real type", async () => {
        await expectRoundTrip("> [!NOT A TYPE] x\n");
        await expectRoundTrip("> [!]\n");
        await expectRoundTrip("> [!] body follows\n> more.\n");
    });

    it("preserves a callout with no body", async () => {
        await expectRoundTrip("> [!NOTE]\n");
    });

    it("preserves a blank quoted line between marker and body", async () => {
        await expectRoundTrip("> [!NOTE]\n>\n> Spaced body.\n");
    });

    it("preserves inline formatting inside the body", async () => {
        await expectRoundTrip(
            "> [!TIP] Title\n> Body with **bold**, *em* and `code`.\n",
        );
    });

    it("preserves a marker title that contains inline syntax", async () => {
        await expectRoundTrip("> [!NOTE] **bold title**\n> Body.\n");
    });

    it("preserves several callouts and a plain blockquote together", async () => {
        await expectRoundTrip(
            "> [!NOTE]\n> One.\n\n> Plain.\n\n> [!BANANA] Two\n> Three.\n",
        );
    });
});

describe("callout nested content", () => {
    it("keeps a fenced code block intact", async () => {
        await expectRoundTrip(
            "> [!NOTE]\n> ```js\n> const a = 1;\n> ```\n",
        );
    });

    it("keeps a nested callout intact", async () => {
        await expectRoundTrip("> [!NOTE]\n> > [!TIP]\n> > Inner body.\n");
    });

    it("keeps a nested plain blockquote intact", async () => {
        await expectRoundTrip("> [!NOTE]\n> > Inner quote.\n");
    });

    it("keeps a bullet list intact", async () => {
        await expectRoundTrip("> [!NOTE]\n> - first\n> - second\n");
    });

    it("keeps an ordered list intact", async () => {
        await expectRoundTrip("> [!NOTE]\n> 1. one\n> 2. two\n");
    });

    it("keeps a table intact", async () => {
        await expectRoundTrip(
            "> [!NOTE]\n> | a | b |\n> | - | - |\n> | 1 | 2 |\n",
        );
    });

    it("keeps a heading inside the body intact", async () => {
        await expectRoundTrip("> [!NOTE]\n> # Inner heading\n");
    });

    it("keeps a multi-line body paragraph intact", async () => {
        await expectRoundTrip("> [!NOTE] T\n> line one\n> line two\n");
    });

    it("keeps a nested callout followed by more body intact", async () => {
        await expectRoundTrip(
            "> [!NOTE]\n> > [!TIP] inner\n> > deep\n>\n> after\n",
        );
    });

    it("keeps a callout nested inside a list item intact", async () => {
        await expectRoundTrip("- item\n\n  > [!NOTE]\n  > inside list\n");
    });
});

describe("callout node attributes", () => {
    it("exposes type and title separately", async () => {
        const { root } = await mount("> [!NOTE] Custom title\n> Body line.\n");
        const callout = requireElement<HTMLElement>(root, "[data-callout]");
        expect(callout.getAttribute("data-callout-kind")).toBe("NOTE");
        expect(callout.getAttribute("data-callout-title")).toBe("Custom title");
    });

    it("keeps an unknown type as its own attribute value", async () => {
        const { root } = await mount("> [!BANANA]\n> Body.\n");
        const callout = requireElement<HTMLElement>(root, "[data-callout]");
        expect(callout.getAttribute("data-callout-kind")).toBe("BANANA");
        expect(callout.getAttribute("data-callout-title")).toBe("");
    });

    it("does not turn a plain blockquote into a callout", async () => {
        const { root } = await mount("> Just a quote.\n");
        expect(root.querySelector("[data-callout]")).toBeNull();
        expect(root.querySelector("blockquote")).not.toBeNull();
    });
});

describe("callout editing", () => {
    it("rewrites the type when the type input changes", async () => {
        const { host, root } = await mount("> [!NOTE] Custom title\n> Body.\n");
        const input = requireElement<HTMLInputElement>(root, ".mdx-callout-kind");
        expect(input.value).toBe("NOTE");
        input.value = "TIP";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        host.flush();
        expect(host.getMarkdown()).toBe("> [!TIP] Custom title\n> Body.\n");
    });

    it("rewrites the title when the title input changes", async () => {
        const { host, root } = await mount("> [!NOTE]\n> Body.\n");
        const input = requireElement<HTMLInputElement>(
            root,
            ".mdx-callout-title",
        );
        expect(input.value).toBe("");
        input.value = "Fresh title";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        host.flush();
        expect(host.getMarkdown()).toBe("> [!NOTE] Fresh title\n> Body.\n");
    });

    it("clears the title back to a bare marker", async () => {
        const { host, root } = await mount("> [!NOTE] Custom title\n> Body.\n");
        const input = requireElement<HTMLInputElement>(
            root,
            ".mdx-callout-title",
        );
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        host.flush();
        expect(host.getMarkdown()).toBe("> [!NOTE]\n> Body.\n");
    });

    it("refuses type characters that would break the marker", async () => {
        const { host, root } = await mount("> [!NOTE]\n> Body.\n");
        const input = requireElement<HTMLInputElement>(root, ".mdx-callout-kind");
        input.value = "TI]P";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        host.flush();
        expect(input.value).toBe("TIP");
        expect(host.getMarkdown()).toBe("> [!TIP]\n> Body.\n");
    });

    it("edits the body without disturbing the marker", async () => {
        const markdown = "> [!WARNING] Heads up\n> Be careful here.\n";
        const { host } = await mount(markdown);
        const offset = markdown.indexOf("careful");
        expect(
            host.replaceSourceRange({ anchor: offset, head: offset }, "very "),
        ).toBe(true);
        host.flush();
        expect(host.getMarkdown()).toBe(
            "> [!WARNING] Heads up\n> Be very careful here.\n",
        );
    });

    it("reopens an edited callout as the same node", async () => {
        const markdown = "> [!NOTE] Title\n> Body.\n";
        const { host } = await mount(markdown);
        const offset = markdown.indexOf("Body.");
        expect(
            host.replaceSourceRange({ anchor: offset, head: offset }, "New "),
        ).toBe(true);
        host.flush();
        const next = host.getMarkdown();
        expect(next).toBe("> [!NOTE] Title\n> New Body.\n");

        const { root: reopened } = await mount(next);
        const callout = requireElement<HTMLElement>(reopened, "[data-callout]");
        expect(callout.getAttribute("data-callout-kind")).toBe("NOTE");
        expect(callout.getAttribute("data-callout-title")).toBe("Title");
        expect(callout.textContent).toContain("New Body.");
    });
});

describe("callout regression guard", () => {
    it("serializes the same bytes on every later pass", async () => {
        const fixtures = [
            "> [!WARNING]\n> Be careful here.\n",
            "> [!NOTE] Custom title\n> Body line.\n",
            "> [!BANANA]\n> Unrecognized type.\n",
            "> [!NOT A TYPE] x\n",
            "> [!]\n",
            "> [!NOTE]\n>\n> Spaced body.\n",
            "> Plain quote.\n",
        ];
        for (const fixture of fixtures) {
            const once = await serializeAfterOutsideEdit(fixture);
            const slice = once.slice(`X${ANCHOR}`.length);
            expect(slice, fixture).toBe(fixture);
            const twice = await serializeAfterOutsideEdit(slice);
            expect(twice, fixture).toBe(once);
        }
    });

    it("leaves the pre-existing bracket escape outside the marker grammar", async () => {
        // A blockquote that starts with `[` but is not a marker keeps
        // CommonMark's escaping, exactly as it does outside a blockquote. The
        // callout grammar requires a space before a title, so `[!NOTE]x` is not
        // a marker and is not claimed.
        expect(await serializeAfterOutsideEdit("> [!NOTE]x\n")).toContain(
            "> \\[!NOTE]x",
        );
        expect(await serializeAfterOutsideEdit("> [not a link]\n")).toContain(
            "> \\[not a link]",
        );
    });

    it("pins the baseline defect the plugin fixes", async () => {
        const baseline = await serializeAfterOutsideEdit(
            "> [!WARNING]\n> careful\n",
            createBaseMilkdownPlugins(),
        );
        expect(baseline).toContain("> \\[!WARNING]");
        expect(await serializeAfterOutsideEdit("> [!WARNING]\n> careful\n")).toBe(
            `X${ANCHOR}> [!WARNING]\n> careful\n`,
        );
    });
});
