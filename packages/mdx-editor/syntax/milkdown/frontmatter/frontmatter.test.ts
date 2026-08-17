// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { createBaseMilkdownPlugins } from "../../../milkdown/base-plugins";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../../milkdown/editor-host";
import { frontmatterFixtures } from "../../../test/syntax-fixtures";
import { frontmatterPlugins } from "./index";

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
    plugins = [...createBaseMilkdownPlugins(), ...frontmatterPlugins()],
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
 * Replaces `target` with `replacement` and drains the change queue. The host
 * only re-serializes after a real edit, so every fidelity assertion has to go
 * through one.
 */
function edit(
    host: MilkdownEditorHost,
    markdown: string,
    target: string,
    replacement: string,
): void {
    const anchor = markdown.lastIndexOf(target);
    expect(anchor, `"${target}" is missing from the fixture`).toBeGreaterThan(
        -1,
    );
    expect(
        host.replaceSourceRange(
            { anchor, head: anchor + target.length },
            replacement,
        ),
    ).toBe(true);
    host.flush();
}

function frontmatterElements(root: HTMLElement): Element[] {
    return [...root.querySelectorAll("pre[data-frontmatter]")];
}

describe("frontmatter fixtures", () => {
    for (const fixture of frontmatterFixtures) {
        it(`preserves ${fixture.name} across an edit elsewhere`, async () => {
            const { host, root } = await mount(fixture.markdown);
            expect(frontmatterElements(root)).toHaveLength(1);

            edit(host, fixture.markdown, "Body.", "Edited body.");

            const output = host.getMarkdown();
            for (const slice of fixture.preservedSlices) {
                expect(output).toContain(slice);
            }
            expect(output).toContain("Edited body.");
        });
    }

    it("re-emits the whole document unchanged apart from the edit", async () => {
        const markdown = "---\ntitle: Example\ntags:\n  - a\n  - b\n---\n\nBody.\n";
        const { host } = await mount(markdown);

        edit(host, markdown, "Body.", "Edited body.");

        expect(host.getMarkdown()).toBe(
            "---\ntitle: Example\ntags:\n  - a\n  - b\n---\n\nEdited body.\n",
        );
    });
});

describe("frontmatter recognition", () => {
    it("keeps a thematic break later in the document a thematic break", async () => {
        const markdown = "Intro.\n\n---\n\nBody.\n";
        const { host, root } = await mount(markdown);
        expect(frontmatterElements(root)).toHaveLength(0);
        expect(root.querySelectorAll("hr")).toHaveLength(1);

        edit(host, markdown, "Body.", "Edited body.");

        const output = host.getMarkdown();
        expect(output).toBe("Intro.\n\n***\n\nEdited body.\n");
        expect(frontmatterElements(root)).toHaveLength(0);
    });

    it("separates leading frontmatter from a later thematic break", async () => {
        const markdown = "---\na: 1\n---\n\nBody.\n\n---\n\nMore.\n";
        const { host, root } = await mount(markdown);
        expect(frontmatterElements(root)).toHaveLength(1);
        expect(root.querySelectorAll("hr")).toHaveLength(1);

        edit(host, markdown, "More.", "Edited more.");

        expect(host.getMarkdown()).toBe(
            "---\na: 1\n---\n\nBody.\n\n***\n\nEdited more.\n",
        );
    });

    it("leaves a document without frontmatter alone", async () => {
        const markdown = "Just text.\n\n## Heading\n";
        const { host, root } = await mount(markdown);
        expect(frontmatterElements(root)).toHaveLength(0);

        edit(host, markdown, "Just text.", "Edited text.");

        expect(host.getMarkdown()).toBe("Edited text.\n\n## Heading\n");
    });

    it("does not treat a four-dash rule as frontmatter", async () => {
        const markdown = "----\ntitle: x\n----\n\nBody.\n";
        const { host, root } = await mount(markdown);

        expect(frontmatterElements(root)).toHaveLength(0);
        edit(host, markdown, "Body.", "Edited body.");
        expect(host.getMarkdown()).not.toContain("---\ntitle: x\n---");
    });

    it("does not treat an indented delimiter as frontmatter", async () => {
        const markdown = " ---\ntitle: x\n ---\n\nBody.\n";
        const { root } = await mount(markdown);

        expect(frontmatterElements(root)).toHaveLength(0);
    });
});

describe("frontmatter fidelity", () => {
    it("does not reformat YAML the author wrote by hand", async () => {
        const raw = [
            "---",
            "# a comment",
            "title: 'single quoted'",
            'other:  "double  quoted"',
            "empty:",
            "nested:",
            "    deep:     value",
            "flow: [1,   2]",
            "blank_line_follows: true",
            "",
            "trailing: 0",
            "---",
        ].join("\n");
        const markdown = `${raw}\n\nBody.\n`;
        const { host } = await mount(markdown);

        edit(host, markdown, "Body.", "Edited body.");

        expect(host.getMarkdown()).toBe(`${raw}\n\nEdited body.\n`);
    });

    it("round-trips TOML frontmatter with its own delimiters", async () => {
        const markdown = '+++\ntitle = "x"\ncount = 2\n+++\n\nBody.\n';
        const { host, root } = await mount(markdown);
        expect(
            root.querySelector("pre[data-frontmatter]")?.getAttribute(
                "data-frontmatter",
            ),
        ).toBe("toml");

        edit(host, markdown, "Body.", "Edited body.");

        expect(host.getMarkdown()).toBe(
            '+++\ntitle = "x"\ncount = 2\n+++\n\nEdited body.\n',
        );
    });

    it("keeps markdown-looking lines inside the frontmatter inert", async () => {
        const markdown = "---\n# not a heading\n- not a list\n---\n\nBody.\n";
        const { host } = await mount(markdown);

        edit(host, markdown, "Body.", "Edited body.");

        expect(host.getMarkdown()).toBe(
            "---\n# not a heading\n- not a list\n---\n\nEdited body.\n",
        );
    });

    it("round-trips a document that is only frontmatter", async () => {
        const markdown = "---\na: 1\n---\n";
        const { host } = await mount(markdown);

        edit(host, markdown, "1", "2");

        expect(host.getMarkdown()).toBe("---\na: 2\n---\n");
    });

    it("keeps an adjacent fenced code block intact", async () => {
        const markdown =
            "---\na: 1\n---\n\n```js\nconst x = 1;\n```\n\nBody.\n";
        const { host } = await mount(markdown);

        edit(host, markdown, "Body.", "Edited body.");

        expect(host.getMarkdown()).toBe(
            "---\na: 1\n---\n\n```js\nconst x = 1;\n```\n\nEdited body.\n",
        );
    });
});

describe("frontmatter as an editable block", () => {
    it("exposes the raw body as editable text content", async () => {
        const markdown = "---\ntitle: old\n---\n\nBody.\n";
        const { host, root } = await mount(markdown);

        const element = root.querySelector("pre[data-frontmatter]");
        expect(element?.textContent).toBe("title: old");
        expect(element?.closest("[contenteditable=false]")).toBeNull();

        edit(host, markdown, "old", "new value");

        expect(host.getMarkdown()).toBe(
            "---\ntitle: new value\n---\n\nBody.\n",
        );
    });

    it("accepts an edit that empties the frontmatter body", async () => {
        const markdown = "---\na: 1\n---\n\nBody.\n";
        const { host } = await mount(markdown);

        edit(host, markdown, "a: 1", "");

        expect(host.getMarkdown()).toBe("---\n---\n\nBody.\n");
    });

    it("accepts an edit that fills an empty frontmatter body", async () => {
        const markdown = "---\n---\n\nBody.\n";
        const { host, root } = await mount(markdown);
        expect(root.querySelector("pre[data-frontmatter]")?.textContent).toBe(
            "",
        );

        edit(host, markdown, "Body.", "Edited body.");

        expect(host.getMarkdown()).toBe("---\n---\n\nEdited body.\n");
    });
});
