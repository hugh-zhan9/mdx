import { DOMParser } from "prosemirror-model";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { mdxEditorSchema } from "./schema";

describe("mdxEditorSchema DOM contract", () => {
    it("round-trips typed pre blocks through specific DOM parse rules", () => {
        const dom = new JSDOM(
            `<article><pre data-mdx-node-type="frontmatter" data-mdx-syntax="frontmatter" data-mdx-source-id="source-0"><code>title: Test
</code></pre><pre data-mdx-node-type="code_block" data-mdx-code-block="" data-mdx-language="mermaid" data-mdx-info="mermaid live" data-mdx-source-id="source-1"><code>graph TD
</code></pre><pre data-mdx-node-type="opaque" data-mdx-source-id="source-2" data-mdx-reason="unsupported"><code>:::callout
</code></pre></article>`,
        );

        const parsed = DOMParser.fromSchema(mdxEditorSchema).parse(
            dom.window.document.querySelector("article")!,
            { preserveWhitespace: "full" },
        );

        expect(parsed.child(0).type.name).toBe("frontmatter");
        expect(parsed.child(0).attrs.sourceId).toBe("source-0");
        expect(parsed.child(0).textContent).toBe("title: Test\n");
        expect(parsed.child(1).type.name).toBe("code_block");
        expect(parsed.child(1).attrs).toEqual({
            language: "mermaid",
            info: "mermaid live",
            sourceId: "source-1",
        });
        expect(parsed.child(2).type.name).toBe("opaque_block");
        expect(parsed.child(2).attrs).toEqual({
            reason: "unsupported",
            sourceId: "source-2",
        });
    });
});
