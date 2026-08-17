// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditorAdapter } from "../adapter/markdown-editor-adapter";
import type {
    EditorAdapterDiagnostic,
    EditorDocumentSnapshot,
    EditorFindRequest,
    EditorFindResult,
    EditorSurfaceMode,
    MarkdownEditorAdapterHandle,
} from "../adapter/types";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(async () => {
    while (roots.length > 0) {
        const entry = roots.pop();
        if (!entry) continue;
        await act(async () => {
            entry.root.unmount();
        });
        entry.container.remove();
    }
});

interface Session {
    handle: RefObject<MarkdownEditorAdapterHandle | null>;
    container: HTMLElement;
    diagnostics: EditorAdapterDiagnostic[];
    markdown(): string;
    switchTo(mode: EditorSurfaceMode): Promise<void>;
}

async function openSession(initialMarkdown: string): Promise<Session> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });

    const handle = createRef<MarkdownEditorAdapterHandle>();
    let snapshot: EditorDocumentSnapshot = {
        documentId: "doc",
        revision: 1,
        markdown: initialMarkdown,
    };
    let mode: EditorSurfaceMode = "wysiwyg";

    const render = async (): Promise<void> => {
        await act(async () => {
            root.render(
                <MarkdownEditorAdapter
                    ref={handle}
                    snapshot={snapshot}
                    mode={mode}
                    editable
                    onChange={(event) => {
                        snapshot = {
                            documentId: snapshot.documentId,
                            revision: snapshot.revision + 1,
                            markdown: event.markdown,
                        };
                    }}
                    onSelectionChange={() => {}}
                    onModeChange={(next) => {
                        mode = next;
                    }}
                    onDiagnostic={(diagnostic) =>
                        session.diagnostics.push(diagnostic)
                    }
                    onOpenWikilink={() => {}}
                    onReady={() => {}}
                />,
            );
        });
    };

    const session: Session = {
        handle,
        container,
        diagnostics: [],
        markdown: () => snapshot.markdown,
        switchTo: async (next) => {
            await act(async () => {
                await handle.current!.setMode(next);
            });
            await render();
        },
    };

    await render();
    return session;
}

/**
 * A document whose preview chrome repeats its own source.
 *
 * The math block is the point: its LaTeX is the node's text, and the NodeView
 * draws KaTeX beside it — KaTeX emits the source again inside a MathML
 * annotation — so the rendered DOM holds `anchor` once for the document and at
 * least once more for the preview. Anything scanning what is on screen counts
 * those. A walk of the document does not.
 */
const DOCUMENT = [
    "# Find the anchor",
    "",
    "The anchor appears in prose here.",
    "",
    "$$",
    "anchor = 2",
    "$$",
    "",
    "- anchor in a list",
    "",
].join("\n");

/** Where `anchor` really occurs in the Markdown, found without the editor. */
function sourceOccurrences(markdown: string, word: string): number[] {
    const found: number[] = [];
    for (
        let at = markdown.indexOf(word);
        at !== -1;
        at = markdown.indexOf(word, at + word.length)
    ) {
        found.push(at);
    }
    return found;
}

function countIn(text: string, word: string): number {
    return sourceOccurrences(text, word).length;
}

function request(overrides: Partial<EditorFindRequest> = {}): EditorFindRequest {
    return {
        query: "anchor",
        caseSensitive: false,
        wholeWord: false,
        ...overrides,
    };
}

function slices(markdown: string, result: EditorFindResult): string[] {
    return result.matches.map((match) =>
        markdown.slice(match.range.anchor, match.range.head),
    );
}

describe("find — the semantic document, not what is on screen", () => {
    it("counts a preview's repeat of its own source zero times", async () => {
        const session = await openSession(DOCUMENT);
        expect(session.container.querySelector(".ProseMirror")).not.toBeNull();

        // The preview really did render, and it really does repeat the source:
        // without this the exclusion below would be a claim about nothing.
        const preview =
            session.container.querySelector<HTMLElement>(".mdx-math-preview");
        expect(preview).not.toBeNull();
        expect(preview!.textContent).toContain("anchor");
        const onScreen = countIn(session.container.textContent ?? "", "anchor");
        expect(onScreen).toBeGreaterThan(4);

        const result = session.handle.current!.find(request());

        expect(result.matches).toHaveLength(4);
        expect(result.matches.map((match) => match.range.anchor)).toEqual(
            sourceOccurrences(DOCUMENT, "anchor"),
        );
        expect(slices(DOCUMENT, result)).toEqual([
            "anchor",
            "anchor",
            "anchor",
            "anchor",
        ]);
        expect(session.diagnostics).toEqual([]);
    }, 60000);

    it("returns the same matches on whichever surface is mounted", async () => {
        const session = await openSession(DOCUMENT);
        const visual = session.handle.current!.find(request());
        // The visual surface is the one that answered, and it is the one with
        // the preview DOM.
        expect(session.container.querySelector(".mdx-math-preview")).not.toBeNull();

        await session.switchTo("source");

        // The source surface has no preview at all, so a result that matched
        // only because the previous surface had one would change here.
        expect(session.container.querySelector(".cm-editor")).not.toBeNull();
        expect(session.container.querySelector(".ProseMirror")).toBeNull();
        expect(session.container.querySelector(".mdx-math-preview")).toBeNull();

        const source = session.handle.current!.find(request());

        expect(source.matches).toEqual(visual.matches);
        expect(source.matches).toHaveLength(4);
    }, 60000);

    it("honours case sensitivity identically on both surfaces", async () => {
        const markdown = "Anchor and anchor and ANCHOR.\n";
        const session = await openSession(markdown);

        const visualAny = session.handle.current!.find(request());
        const visualExact = session.handle.current!.find(
            request({ caseSensitive: true }),
        );
        expect(slices(markdown, visualAny)).toEqual([
            "Anchor",
            "anchor",
            "ANCHOR",
        ]);
        expect(slices(markdown, visualExact)).toEqual(["anchor"]);

        await session.switchTo("source");

        expect(session.handle.current!.find(request()).matches).toEqual(
            visualAny.matches,
        );
        expect(
            session.handle.current!.find(request({ caseSensitive: true }))
                .matches,
        ).toEqual(visualExact.matches);
    }, 60000);

    it("honours whole-word matching identically on both surfaces", async () => {
        const markdown = "anchor anchors anchoring anchor.\n";
        const session = await openSession(markdown);

        const loose = session.handle.current!.find(request());
        const whole = session.handle.current!.find(
            request({ wholeWord: true }),
        );
        expect(loose.matches).toHaveLength(4);
        expect(whole.matches.map((match) => match.range)).toEqual([
            { anchor: 0, head: 6 },
            { anchor: 25, head: 31 },
        ]);

        await session.switchTo("source");

        expect(
            session.handle.current!.find(request({ wholeWord: true })).matches,
        ).toEqual(whole.matches);
    }, 60000);

    it("finds text the markup around it hides from a raw reading", async () => {
        // `emphasis` is one word in the document and four characters of markup
        // away from itself in the source. A search over the document's text
        // finds it; the range still points at the source it came from.
        const markdown = "Some *emphasis* here.\n";
        const session = await openSession(markdown);

        const result = session.handle.current!.find(
            request({ query: "emphasis" }),
        );

        expect(result.matches.map((match) => match.range)).toEqual([
            { anchor: 6, head: 14 },
        ]);
        expect(markdown.slice(6, 14)).toBe("emphasis");
    }, 60000);

    it("does not match across the gap between two blocks", async () => {
        // `end` closes one paragraph and `Start` opens the next. They are
        // adjacent in neither the document nor the source, and joining the
        // blocks to search them would make `endStart` a match.
        const markdown = "The end\n\nStart again.\n";
        const session = await openSession(markdown);

        expect(
            session.handle.current!.find(request({ query: "endStart" })).matches,
        ).toEqual([]);
        expect(
            session.handle.current!.find(request({ query: "end" })).matches,
        ).toHaveLength(1);
    }, 60000);

    it("reports no matches, and no active match, for an empty query", async () => {
        const session = await openSession(DOCUMENT);
        expect(session.handle.current!.find(request({ query: "" }))).toEqual({
            matches: [],
            activeMatchId: null,
        });
    }, 60000);
});

describe("find — the active match", () => {
    it("is the first match at or after the caret", async () => {
        const session = await openSession(DOCUMENT);
        const all = session.handle.current!.find(request());
        const [, second, third] = all.matches;

        // Caret placed just past the second match.
        act(() => {
            session.handle.current!.setSelection({
                anchor: second.range.head,
                head: second.range.head,
            });
        });

        const result = session.handle.current!.find(request());
        expect(result.activeMatchId).toBe(third.id);
        expect(result.matches.map((match) => match.id)).toEqual(
            all.matches.map((match) => match.id),
        );
    }, 60000);

    it("wraps to the first match when the caret is past the last one", async () => {
        const markdown = "anchor at the top and nothing after.\n";
        const session = await openSession(markdown);
        act(() => {
            session.handle.current!.setSelection({
                anchor: markdown.length - 1,
                head: markdown.length - 1,
            });
        });

        const result = session.handle.current!.find(request());
        expect(result.matches).toHaveLength(1);
        expect(result.activeMatchId).toBe(result.matches[0].id);
    }, 60000);
});
