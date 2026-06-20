import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export type CodeTokenizer = (code: string, lang?: string) => unknown[];

export interface CodeHighlightPluginOptions {
    codeTokenizer?: CodeTokenizer;
}

export function createCodeHighlightPlugin({
    codeTokenizer,
}: CodeHighlightPluginOptions = {}) {
    return new Plugin({
        props: {
            decorations(state) {
                if (!codeTokenizer) {
                    return null;
                }

                return DecorationSet.create(
                    state.doc,
                    codeHighlightDecorations(state.doc, codeTokenizer),
                );
            },
        },
    });
}

function codeHighlightDecorations(
    doc: ProseMirrorNode,
    codeTokenizer: CodeTokenizer,
) {
    const decorations: Decoration[] = [];

    doc.descendants((node, pos) => {
        if (node.type.name !== "code_block") {
            return true;
        }

        const code = node.textContent;
        const tokens = codeTokenizer(code, String(node.attrs.language ?? ""));
        let offset = 0;

        for (const token of tokens) {
            const length = tokenTextLength(token);
            const type = tokenType(token);
            if (type && length > 0) {
                const from = pos + 1 + Math.min(offset, code.length);
                const to = pos + 1 + Math.min(offset + length, code.length);
                if (from < to) {
                    decorations.push(
                        Decoration.inline(from, to, {
                            class: `token ${type}`,
                            "data-mdx-token-type": type,
                        }),
                    );
                }
            }
            offset += length;
        }

        return false;
    });

    return decorations;
}

function tokenType(token: unknown) {
    if (!isTokenObject(token) || typeof token.type !== "string") {
        return null;
    }

    const safe = token.type.replace(/[^A-Za-z0-9_-]/g, "");
    return safe.length > 0 ? safe : null;
}

function tokenTextLength(token: unknown): number {
    if (typeof token === "string") {
        return token.length;
    }
    if (Array.isArray(token)) {
        return token.reduce((length, child) => length + tokenTextLength(child), 0);
    }
    if (isTokenObject(token) && "content" in token) {
        return tokenTextLength(token.content);
    }

    return 0;
}

function isTokenObject(
    token: unknown,
): token is { type?: unknown; content?: unknown } {
    return typeof token === "object" && token !== null;
}
