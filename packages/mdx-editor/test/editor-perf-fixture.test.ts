// @vitest-environment jsdom
/**
 * Pins what the `D-015` performance fixtures are for.
 *
 * `D-015` forbids claiming a threshold with a reduced-syntax fixture. A
 * generator can drift into one without changing size or losing determinism —
 * a weight edited to zero, a construct that stopped being emitted — and the
 * checksum pin would happily follow it. These tests are what notices: the
 * fixture has to carry every syntax family the product claims, and the real
 * Milkdown syntax layer has to parse and re-serialize it byte for byte.
 *
 * A fixture that did not round-trip would mean the measurement was taken on a
 * document the editor silently rewrites, which is not the document that was
 * checksummed.
 */
import { describe, expect, it } from "vitest";

import { createEditingSurface } from "../adapter/editing-surface";
import {
    EDITOR_PERF_FIXTURES,
    fixtureSyntaxProfile,
    generateEditorPerfFixture,
} from "../../../scripts/editor-perf-fixture.mjs";

const [small, large] = EDITOR_PERF_FIXTURES;

function generate(descriptor: (typeof EDITOR_PERF_FIXTURES)[number]): string {
    return generateEditorPerfFixture({
        seed: descriptor.seed,
        targetBytes: descriptor.bytes,
    });
}

describe("D-015 performance fixtures", () => {
    it("is deterministic across independent generations", () => {
        for (const descriptor of EDITOR_PERF_FIXTURES) {
            expect(generate(descriptor)).toBe(generate(descriptor));
        }
    });

    it("lands on the exact byte targets", () => {
        expect(small.bytes).toBe(100 * 1024);
        expect(large.bytes).toBe(1024 * 1024);
        for (const descriptor of EDITOR_PERF_FIXTURES) {
            expect(new TextEncoder().encode(generate(descriptor)).length).toBe(
                descriptor.bytes,
            );
        }
    });

    it("carries every syntax family the product claims", () => {
        for (const descriptor of EDITOR_PERF_FIXTURES) {
            const profile = fixtureSyntaxProfile(generate(descriptor));
            expect(profile.frontmatter).toBe(1);
            expect(profile.headings).toBeGreaterThanOrEqual(10);
            expect(profile.callouts).toBeGreaterThanOrEqual(10);
            expect(profile.mermaidFences).toBeGreaterThanOrEqual(4);
            expect(profile.codeFences).toBeGreaterThanOrEqual(10);
            expect(profile.blockMath).toBeGreaterThanOrEqual(5);
            expect(profile.inlineMath).toBeGreaterThanOrEqual(30);
            expect(profile.footnoteCalls).toBeGreaterThanOrEqual(10);
            expect(profile.footnoteDefinitions).toBeGreaterThanOrEqual(5);
            expect(profile.wikilinks).toBeGreaterThanOrEqual(30);
            expect(profile.htmlBlocks).toBeGreaterThanOrEqual(4);
            expect(profile.inlineHtml).toBeGreaterThanOrEqual(10);
            expect(profile.directives).toBeGreaterThanOrEqual(4);
            expect(profile.tableRows).toBeGreaterThanOrEqual(30);
            expect(profile.listItems).toBeGreaterThanOrEqual(50);
            expect(profile.taskItems).toBeGreaterThanOrEqual(10);
            expect(profile.emoji).toBeGreaterThanOrEqual(10);
            expect(profile.cjkCharacters).toBeGreaterThanOrEqual(500);
        }
    });

    it("round-trips through the real Milkdown syntax layer unchanged", async () => {
        for (const descriptor of EDITOR_PERF_FIXTURES) {
            const markdown = generate(descriptor);
            const root = document.createElement("div");
            document.body.append(root);
            const surface = await createEditingSurface("wysiwyg", {
                root,
                markdown,
                editable: true,
                onMarkdownChange: () => {},
                onSelectionChange: () => {},
            });
            expect(surface.getMarkdown()).toBe(markdown);
            await surface.destroy();
            root.remove();
        }
    }, 120_000);
});
