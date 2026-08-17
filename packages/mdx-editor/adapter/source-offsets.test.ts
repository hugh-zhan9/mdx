// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
    Editor,
    defaultValueCtx,
    editorViewCtx,
    remarkCtx,
    rootCtx,
    schemaCtx,
} from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { createBaseMilkdownPlugins } from "../milkdown/base-plugins";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";
import { createSourceOffsetMap } from "./source-offsets";
import type { EditorAdapterDiagnostic } from "./types";
import { allSyntaxFixtures } from "../test/syntax-fixtures";

const mounted: MilkdownEditorHost[] = [];
const rawEditors: Editor[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    while (rawEditors.length > 0) {
        await rawEditors.pop()?.destroy(true);
    }
    document.body.innerHTML = "";
});

interface Harness {
    host: MilkdownEditorHost;
    root: HTMLElement;
    diagnostics: EditorAdapterDiagnostic[];
}

async function mount(
    markdown: string,
    plugins: MilkdownPlugin[],
): Promise<Harness> {
    const root = document.createElement("div");
    document.body.append(root);
    const diagnostics: EditorAdapterDiagnostic[] = [];
    const host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins,
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    mounted.push(host);
    return { host, root, diagnostics };
}

/** Runs one body against both plugin sets the product ships. */
function forEachPluginSet(
    name: string,
    body: (plugins: () => MilkdownPlugin[]) => Promise<void>,
): void {
    it(`${name} (base plugins)`, () => body(createBaseMilkdownPlugins));
    it(`${name} (mdx plugins)`, () => body(createMdxMilkdownPlugins));
}

/** Places a collapsed caret at `offset` and reads it back. */
async function roundTripCaret(
    markdown: string,
    offset: number,
    plugins: MilkdownPlugin[],
): Promise<number | null> {
    const { host } = await mount(markdown, plugins);
    expect(host.setSelection({ anchor: offset, head: offset })).toBe(true);
    return host.getSelection()?.anchor ?? null;
}

describe("source offsets — gfm tables", () => {
    forEachPluginSet(
        "edits the cell the offsets name in a compact table",
        async (plugins) => {
            const markdown = "| a | b |\n| - | - |\n| 1 | 2 |\n";
            const { host } = await mount(markdown, plugins());

            expect(host.replaceSourceRange({ anchor: 6, head: 7 }, "Z")).toBe(
                true,
            );
            host.flush();

            const [header] = host.getMarkdown().split("\n");
            expect(header).toMatch(/^\|\s*a\s*\|\s*Z\s*\|$/);
        },
    );

    forEachPluginSet(
        "keeps body cells distinct from header cells",
        async (plugins) => {
            const markdown =
                "| Name | Value |\n| ---- | ----- |\n| foo  | bar   |\n";
            const { host } = await mount(markdown, plugins());
            expect(markdown.slice(36, 39)).toBe("foo");
            expect(markdown.slice(43, 46)).toBe("bar");

            expect(host.setSelection({ anchor: 36, head: 39 })).toBe(true);
            expect(host.getSelection()).toEqual({ anchor: 36, head: 39 });
            expect(host.setSelection({ anchor: 43, head: 46 })).toBe(true);
            expect(host.getSelection()).toEqual({ anchor: 43, head: 46 });

            expect(host.replaceSourceRange({ anchor: 43, head: 46 }, "BAZ")).toBe(
                true,
            );
            host.flush();

            const result = host.getMarkdown();
            expect(result).toContain("BAZ");
            expect(result).toContain("Value");
            expect(result).not.toContain("bar");
        },
    );
});

describe("source offsets — repeated text", () => {
    forEachPluginSet(
        "binds code content rather than the language tag",
        async (plugins) => {
            const markdown = "```c\ncode\n```\n";
            expect(markdown.slice(5, 9)).toBe("code");
            expect(await roundTripCaret(markdown, 5, plugins())).toBe(5);
        },
    );

    forEachPluginSet(
        "binds text after an image rather than its alt text",
        async (plugins) => {
            const markdown = "Before ![a b](i.png) after";
            expect(markdown.indexOf("after")).toBe(21);
            expect(await roundTripCaret(markdown, 21, plugins())).toBe(21);
        },
    );
});

describe("source offsets — collapsed caret before inline markup", () => {
    const cases: Array<[string, string, number]> = [
        ["emphasis", "Plain *emphasis* tail.\n", 7],
        ["inline code", "Use `code` here\n", 5],
        ["inline html", "Press <kbd>Cmd</kbd> then go\n", 11],
        ["hard break", "line one\\\nline two\n", 10],
    ];

    for (const [label, markdown, offset] of cases) {
        forEachPluginSet(`reports ${label} exactly`, async (plugins) => {
            expect(await roundTripCaret(markdown, offset, plugins())).toBe(
                offset,
            );
        });
    }

    // A reference link is one preserved slice under the product composition,
    // so it has no interior the caret can stand in — the same as an image or a
    // wikilink. Its edges are still exact, which is what a caller placing a
    // caret beside it needs.
    describe("reference link", () => {
        const markdown = "See [ref][1] now.\n\n[1]: x\n";

        it("reports the offset before it exactly", async () => {
            expect(markdown.indexOf("[ref]")).toBe(4);
            expect(
                await roundTripCaret(markdown, 4, createMdxMilkdownPlugins()),
            ).toBe(4);
        });

        it("refuses an offset inside it rather than snapping to an edge", async () => {
            const { host } = await mount(markdown, createMdxMilkdownPlugins());
            expect(host.setSelection({ anchor: 5, head: 5 })).toBe(false);
        });
    });
});

describe("source offsets — leading blocks without text", () => {
    forEachPluginSet("maps past an html block", async (plugins) => {
        const markdown =
            '<div class="note">\n  <p>Hello.</p>\n</div>\n\ntail\n';
        expect(markdown.indexOf("tail")).toBe(43);
        expect(await roundTripCaret(markdown, 43, plugins())).toBe(43);
    });

    forEachPluginSet("maps past an html comment", async (plugins) => {
        const markdown = "<!-- note -->\n\nnote here\n";
        expect(markdown.indexOf("note here")).toBe(15);
        expect(await roundTripCaret(markdown, 15, plugins())).toBe(15);
    });
});

describe("source offsets — trailing inline image", () => {
    forEachPluginSet("appends after the image, not before it", async (plugins) => {
        const markdown = "Hello ![a](i.png)\n";
        const { host } = await mount(markdown, plugins());

        expect(
            host.replaceSourceRange(
                { anchor: markdown.length, head: markdown.length },
                "!",
            ),
        ).toBe(true);
        host.flush();

        expect(host.getMarkdown()).toBe("Hello ![a](i.png)!\n");
    });
});

describe("source offsets — surrogate pairs", () => {
    forEachPluginSet("never splits a pair on the way in", async (plugins) => {
        const markdown = "x\u{1F600}y\n";
        const { host } = await mount(markdown, plugins());

        expect(host.replaceSourceRange({ anchor: 2, head: 2 }, "Z")).toBe(true);
        host.flush();

        const result = host.getMarkdown();
        expect(result).toBe("xZ\u{1F600}y\n");
        for (let index = 0; index < result.length; index += 1) {
            const code = result.charCodeAt(index);
            if (code < 0xd800 || code > 0xdbff) continue;
            const next = result.charCodeAt(index + 1);
            expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        }
    });
});

describe("source offsets — unmappable source is reported", () => {
    forEachPluginSet(
        "refuses a selection whose text has no established source",
        async (plugins) => {
            // The second line carries more indentation than the code block's
            // own, so no span in the parse accounts for the text verbatim.
            const markdown = "    a\n     b\n";
            const { host, diagnostics } = await mount(markdown, plugins());

            host.setSelection({ anchor: 4, head: 5 });

            expect(host.getSelection()).toBeNull();
            expect(
                diagnostics.some(
                    (entry) => entry.code === "editor_position_unmapped",
                ),
            ).toBe(true);
        },
    );

    forEachPluginSet(
        "reports a map built against markdown the document did not produce",
        async (plugins) => {
            const root = document.createElement("div");
            document.body.append(root);
            const editor = Editor.make()
                .config((ctx) => {
                    ctx.set(rootCtx, root);
                    ctx.set(defaultValueCtx, "alpha beta\n");
                })
                .use(plugins());
            await editor.create();
            rawEditors.push(editor);

            const { faithful, mismatched } = editor.action((ctx) => {
                const doc = ctx.get(editorViewCtx).state.doc;
                const schema = ctx.get(schemaCtx);
                const remark = ctx.get(remarkCtx);
                return {
                    faithful: createSourceOffsetMap({
                        doc,
                        markdown: "alpha beta\n",
                        schema,
                        remark,
                    }),
                    mismatched: createSourceOffsetMap({
                        doc,
                        markdown: "something else entirely\n",
                        schema,
                        remark,
                    }),
                };
            });

            expect(faithful.failure).toBeNull();
            expect(faithful.sourceOffsetForPosition(1)).toBe(0);

            expect(mismatched.failure).toBe("document_mismatch");
            expect(mismatched.sourceOffsetForPosition(1)).toBeNull();
            expect(mismatched.positionForSourceOffset(0)).toBeNull();
            expect(mismatched.sourceRangeForSelection(1, 2)).toBeNull();
        },
    );
});

describe("source offsets — empty blocks", () => {
    forEachPluginSet(
        "reports a caret in a trailing empty paragraph past the previous block",
        async (plugins) => {
            const { host, root } = await mount("abc\n", plugins());
            expect(host.setSelection({ anchor: 3, head: 3 })).toBe(true);
            host.focus();

            const surface = root.querySelector<HTMLElement>(".ProseMirror");
            expect(surface).not.toBeNull();
            surface!.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "Enter",
                    bubbles: true,
                    cancelable: true,
                }),
            );
            host.flush();

            expect(host.getMarkdown()).toBe("abc\n\n");
            expect(host.getSelection()).toEqual({ anchor: 5, head: 5 });
        },
    );

    forEachPluginSet("reports a caret in an empty table cell", async (plugins) => {
        const markdown = "| a |  |\n| - | - |\n";
        const { host } = await mount(markdown, plugins());

        expect(host.setSelection({ anchor: 6, head: 6 })).toBe(true);
        const reported = host.getSelection();
        expect(reported).not.toBeNull();
        expect(reported!.anchor).toBeGreaterThan(3);
        expect(reported!.anchor).toBeLessThanOrEqual(8);

        expect(host.replaceSourceRange({ anchor: 6, head: 6 }, "z")).toBe(true);
        host.flush();

        const [header] = host.getMarkdown().split("\n");
        expect(header).toMatch(/^\|\s*a\s*\|\s*z\s*\|$/);
    });
});

describe("source offsets — markup the document holds as attributes", () => {
    forEachPluginSet("refuses an offset inside a link destination", async (plugins) => {
        const markdown = "See [site](https://example.com) now.\n";
        const { host, diagnostics } = await mount(markdown, plugins());
        const inside = markdown.indexOf("example");

        expect(
            host.replaceSourceRange(
                { anchor: inside, head: inside + "example".length },
                "ZQXJ",
            ),
        ).toBe(false);
        expect(host.getMarkdown()).toBe(markdown);
        expect(
            diagnostics.some((entry) => entry.code === "editor_position_unmapped"),
        ).toBe(true);

        // The link's own text is still addressable.
        const text = markdown.indexOf("site");
        expect(
            host.replaceSourceRange(
                { anchor: text, head: text + "site".length },
                "here",
            ),
        ).toBe(true);
        host.flush();
        expect(host.getMarkdown()).toContain("[here](https://example.com)");
    });

    forEachPluginSet("refuses an offset inside an image url", async (plugins) => {
        const markdown = "Look ![alt](pic.png) now.\n";
        const { host } = await mount(markdown, plugins());
        const inside = markdown.indexOf("pic");
        expect(
            host.replaceSourceRange(
                { anchor: inside, head: inside + 3 },
                "ZQXJ",
            ),
        ).toBe(false);
        expect(host.getMarkdown()).toBe(markdown);
    });
});

describe("source offsets — reported offsets are stable", () => {
    // Every offset the map reports must map back to itself and must never move
    // backwards as the probed offset advances. A map that quietly pins a region
    // to one place, as an alignment scan does when it loses its place, breaks
    // one or the other.
    forEachPluginSet("replays and orders every reported offset", async (plugins) => {
        const set = plugins();
        for (const fixture of allSyntaxFixtures) {
            const { host } = await mount(fixture.markdown, set);
            let previous = -1;
            for (
                let offset = 0;
                offset <= fixture.markdown.length;
                offset += 1
            ) {
                if (!host.setSelection({ anchor: offset, head: offset })) continue;
                const first = host.getSelection();
                if (!first) continue;
                expect(first.anchor).toBeGreaterThanOrEqual(previous);
                previous = first.anchor;
                expect(
                    host.setSelection({
                        anchor: first.anchor,
                        head: first.anchor,
                    }),
                ).toBe(true);
                expect(host.getSelection()).toEqual(first);
            }
        }
    });
});

describe("source offsets — selection ranges", () => {
    forEachPluginSet("round-trips a range across inline markup", async (plugins) => {
        const markdown = "Plain *emphasis* tail.\n";
        const { host } = await mount(markdown, plugins());
        host.setSelection({ anchor: 7, head: 15 });
        expect(host.getSelection()).toEqual({ anchor: 7, head: 15 });
    });

    forEachPluginSet("keeps offsets monotonic across blocks", async (plugins) => {
        const markdown = "# One\n\nTwo\n\n- Three\n- Four\n";
        const { host } = await mount(markdown, plugins());
        const reported = ["One", "Two", "Three", "Four"].map((word) => {
            const offset = markdown.indexOf(word);
            host.setSelection({ anchor: offset, head: offset });
            return host.getSelection()?.anchor ?? -1;
        });
        expect(reported).toEqual([2, 7, 14, 22]);
    });
});
