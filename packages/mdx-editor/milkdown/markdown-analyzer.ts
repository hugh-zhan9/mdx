import {
    Editor,
    defaultValueCtx,
    remarkCtx,
    rootCtx,
    schemaCtx,
} from "@milkdown/kit/core";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import {
    readMarkdownDocument,
    type SourceOffsetMap,
} from "../adapter/source-offsets";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";

/**
 * A document read out of Markdown, with the offsets that put it back.
 */
export interface MarkdownAnalysis {
    doc: ProseMirrorNode;
    map: SourceOffsetMap;
}

/**
 * Reads Markdown into the document the product's own syntax layer builds from
 * it.
 *
 * The source surface is CodeMirror: it holds Markdown, not a document, so it
 * cannot answer a question about the document's text on its own. Rather than
 * grow a second reading of Markdown that could disagree with the editor's, it
 * asks this — the same schema, the same remark, the same plugin composition the
 * WYSIWYG surface is built from. Two answers to "what text does this document
 * contain" that come from one parser cannot diverge.
 *
 * This holds no content. It parses on demand and keeps its own document empty,
 * so it is not a second copy of anything the session owns.
 */
export interface MarkdownAnalyzer {
    /** The document `markdown` builds, or null when it does not build one. */
    analyze(markdown: string): MarkdownAnalysis | null;
}

function createAnalyzer(editor: Editor): MarkdownAnalyzer {
    /**
     * One-entry cache. Find is asked once per keystroke in the query box
     * against Markdown that has not moved, so re-reading the whole document
     * every time would make typing a query cost a parse per character.
     */
    let cached: { markdown: string; analysis: MarkdownAnalysis | null } | null =
        null;

    return {
        analyze(markdown) {
            if (cached && cached.markdown === markdown) return cached.analysis;
            const analysis = ((): MarkdownAnalysis | null => {
                try {
                    return editor.action((ctx) =>
                        // Each call parses with a state of its own, so content
                        // that defeats the parser — a nesting deep enough to
                        // exhaust the stack — costs this one answer and not
                        // every answer after it. The editor's own parser is
                        // shared and does not survive such an input.
                        readMarkdownDocument({
                            markdown,
                            schema: ctx.get(schemaCtx),
                            remark: ctx.get(remarkCtx),
                        }),
                    );
                } catch {
                    // Content the syntax layer cannot build has no document and
                    // therefore no document text. The caller reports that
                    // rather than falling back to a reading of the raw
                    // Markdown, which would answer a different question.
                    return null;
                }
            })();
            cached = { markdown, analysis };
            return analysis;
        },
    };
}

/**
 * The one analyzer this process uses.
 *
 * The schema and the remark instance depend on the plugin composition and
 * nothing else, so one is enough, and one is what makes every surface's answer
 * the same answer. Built lazily because building it costs an editor.
 */
let shared: Promise<MarkdownAnalyzer> | null = null;

export function getSharedMarkdownAnalyzer(): Promise<MarkdownAnalyzer> {
    shared ??= (async () => {
        const editor = Editor.make()
            .config((ctx) => {
                // Off-document: nothing here is ever shown, and the empty
                // default value is what keeps this from holding content.
                ctx.set(rootCtx, document.createElement("div"));
                ctx.set(defaultValueCtx, "");
            })
            .use(createMdxMilkdownPlugins());
        await editor.create();
        return createAnalyzer(editor);
    })();
    return shared;
}
