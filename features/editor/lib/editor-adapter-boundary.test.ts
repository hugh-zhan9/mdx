import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The modules the adapter surface is built from.
 *
 * These are the files a Workspace or Document session reaches the Markdown
 * editor through once the product entry switches. Everything else under
 * `features/**` still belongs to the surface being replaced, which owns its own
 * rendering and is expected to look at it.
 */
const ADAPTER_PATH_MODULES = [
    "features/editor/components/markdown-editor-surface.tsx",
    "features/editor/hooks/use-adapter-find-replace.ts",
    "features/editor/lib/editor-command-pin.ts",
    "features/editor/lib/editor-shortcuts.ts",
    "features/editor/lib/find-bar-state.ts",
    "features/editor/lib/editor-session-binding.ts",
    "features/editor/lib/editor-surface-qualification.ts",
    "features/editor/lib/image-transfer.ts",
    "features/workspace/lib/outline.ts",
];

/**
 * Editor frameworks the product must not reach past the package boundary for.
 * The adapter owns them; a feature that imported one would be holding a
 * position, a plugin key or a view that the contract does not define.
 */
const FRAMEWORK_IMPORTS = [
    "@milkdown/",
    "prosemirror-",
    "@codemirror/",
    "milkdown/kit",
];

/**
 * Ways of asking the rendered document a question. Every one of these was how
 * some integration used to find text, headings or a click target; all of them
 * are answered by source offsets now.
 */
const IMPLEMENTATION_DOM_QUERIES = [
    "querySelector",
    "getElementsByTagName",
    "getElementsByClassName",
    "createTreeWalker",
    "caretPositionFromPoint",
    "caretRangeFromPoint",
    "textContent",
    "ProseMirror",
    "cm-editor",
    "cm-content",
];

/** Modules whose whole purpose is a scan of rendered output. */
const RENDERED_OUTPUT_MODULES = [
    "outline-scroll",
    "visible-text-search",
    "wikilink-markdown",
    "markdown-line-scroll",
    "editor-dom-contract",
    "hybrid-editor-host",
    "layout-bridge-runtime",
];

function sourceOf(path: string): string {
    return readFileSync(path, "utf8");
}

describe("adapter path stays inside the editor contract", () => {
    it.each(ADAPTER_PATH_MODULES)(
        "%s imports no editor framework directly",
        (path) => {
            const source = sourceOf(path);

            for (const framework of FRAMEWORK_IMPORTS) {
                expect(source).not.toContain(framework);
            }
        },
    );

    it.each(ADAPTER_PATH_MODULES)("%s queries no rendered document", (path) => {
        const source = sourceOf(path);

        for (const query of IMPLEMENTATION_DOM_QUERIES) {
            expect(source).not.toContain(query);
        }
    });

    it.each(ADAPTER_PATH_MODULES)(
        "%s does not depend on a scan of rendered output",
        (path) => {
            const source = sourceOf(path);

            for (const scanner of RENDERED_OUTPUT_MODULES) {
                expect(source).not.toContain(`from "${scanner}`);
                expect(source).not.toContain(`/${scanner}"`);
            }
        },
    );

    it("reaches the editor only through the package entry", () => {
        for (const path of ADAPTER_PATH_MODULES) {
            const deepImports = sourceOf(path).match(
                /from "[^"]*packages\/mdx-editor\/[^"]+"/g,
            );

            expect(deepImports).toBeNull();
        }
    });
});
