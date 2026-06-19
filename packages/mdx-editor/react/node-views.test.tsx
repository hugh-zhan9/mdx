// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mdxEditorSchema } from "../schema/schema";
import { createMdxNodeViews } from "./node-views";

describe("createMdxNodeViews", () => {
    it("registers node views for advanced Markdown structures", () => {
        const keys = Object.keys(
            createMdxNodeViews({ imageLoader: undefined }),
        ).sort();

        expect(keys).toEqual(
            expect.arrayContaining([
                "callout",
                "footnote_definition",
                "math_block",
                "math_inline",
                "mermaid_block",
                "source_fallback",
                "table",
                "task_item",
            ]),
        );
        expect(mdxEditorSchema.nodes.mermaid_block).toBeDefined();
    });
});
