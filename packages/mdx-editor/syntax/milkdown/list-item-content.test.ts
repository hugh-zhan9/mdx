// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "./index";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) await mounted.pop()?.destroy();
    document.body.innerHTML = "";
});

async function roundTrip(markdown: string): Promise<string> {
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
    const end = host.getMarkdown().length;
    host.replaceSourceRange({ anchor: end, head: end }, "\n\ntail");
    host.flush();
    return host.getMarkdown();
}

describe("list item content — relaxing it must not displace the task item", () => {
    // `extendSchema` captures the spec it is called on and re-registers the node
    // under the same id, so the last registration wins outright rather than
    // composing. Relaxing CommonMark's `list_item` therefore replaced GFM's task
    // list item, and every checkbox in the document was silently dropped:
    // `- [x] done` came back as `- done`. Extending GFM's item is what keeps
    // both the relaxed content model and the checkbox.
    it("keeps a checked box", async () => {
        const result = await roundTrip("- [x] done\n");
        expect(result).toContain("- [x] done");
    });

    it("keeps an unchecked box", async () => {
        const result = await roundTrip("- [ ] todo\n");
        expect(result).toContain("- [ ] todo");
    });

    it("keeps a mixed task list", async () => {
        const result = await roundTrip("- [x] done\n- [ ] todo\n- [x] also\n");
        expect(result).toContain("- [x] done");
        expect(result).toContain("- [ ] todo");
        expect(result).toContain("- [x] also");
    });

    it("still lets a list item start with a block that is not a paragraph", async () => {
        // The reason the schema was relaxed in the first place: without it,
        // ProseMirror inserts an empty paragraph that serializes to `<br />`.
        const result = await roundTrip("- ```js\n  let x = 1;\n  ```\n");
        expect(result).not.toContain("<br />");
        expect(result).toContain("let x = 1;");
    });

    it("leaves an ordinary bullet list alone", async () => {
        const result = await roundTrip("- first\n- second\n");
        expect(result).toContain("- first");
        expect(result).toContain("- second");
        expect(result).not.toContain("[ ]");
    });
});
