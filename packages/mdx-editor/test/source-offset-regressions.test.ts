// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createMilkdownEditorHost } from "../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";

async function open(markdown: string) {
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
    return { host, root };
}

describe("independent verification of the offset-map rewrite", () => {
    it("table cell edit hits the intended cell", async () => {
        const md = "| Name | Value |\n| ---- | ----- |\n| foo  | bar   |\n";
        const { host } = await open(md);
        const bar = md.indexOf("bar");
        expect(bar).toBe(43);
        host.replaceSourceRange({ anchor: bar, head: bar + 3 }, "ZZZ");
        host.flush();
        const out = host.getMarkdown();
        await host.destroy();
        expect(out).toBe(
            "| Name | Value |\n| ---- | ----- |\n| foo  | ZZZ   |\n",
        );
    });

    it("caret before inline emphasis is not off by one", async () => {
        const md = "Plain *emphasis* tail.\n";
        const { host } = await open(md);
        host.setSelection({ anchor: 7, head: 7 });
        const got = host.getSelection();
        await host.destroy();
        expect(got).toEqual({ anchor: 7, head: 7 });
    });

    it("code fence language tag does not capture body alignment", async () => {
        const md = "```c\ncode\n```\n";
        const { host } = await open(md);
        host.setSelection({ anchor: 5, head: 5 });
        const got = host.getSelection();
        await host.destroy();
        expect(got).toEqual({ anchor: 5, head: 5 });
    });

    it("append past a trailing inline image lands after it", async () => {
        const md = "Hello ![a](i.png)\n";
        const { host } = await open(md);
        host.replaceSourceRange({ anchor: 17, head: 17 }, "!");
        host.flush();
        const out = host.getMarkdown();
        await host.destroy();
        expect(out).toBe("Hello ![a](i.png)!\n");
    });

    it("an edit never splits a surrogate pair", async () => {
        const md = "x😀y\n";
        const { host } = await open(md);
        host.replaceSourceRange({ anchor: 2, head: 2 }, "Z");
        host.flush();
        const out = host.getMarkdown();
        await host.destroy();
        expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        expect(out).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    it("a leading textless block does not shift later carets", async () => {
        const md = '<div class="note">\n  <p>Hello.</p>\n</div>\n\ntail\n';
        const { host } = await open(md);
        const tail = md.indexOf("tail");
        host.setSelection({ anchor: tail, head: tail });
        const got = host.getSelection();
        await host.destroy();
        expect(got).toEqual({ anchor: tail, head: tail });
    });
});
