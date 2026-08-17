import type { MarkdownNode, RemarkPluginRaw } from "@milkdown/kit/transformer";

import {
    FOOTNOTE_REFERENCE_MDAST_TYPE,
    findFootnoteReferences,
} from "./syntax";

interface Position {
    start: { offset?: number | undefined };
    end: { offset?: number | undefined };
}

/**
 * Everything a blockquote or list item may put in front of a continuation line.
 * Anything else between the source and the value means remark rewrote the line.
 */
const CONTAINER_DECORATION = /^[ \t>]*$/;

/**
 * True when a text node's value is the source it came from, character for
 * character, once the container decoration on its continuation lines is
 * discounted.
 *
 * Everything remark does to a text node while parsing — resolving `\[`,
 * expanding `&amp;`, normalizing CRLF — rewrites the value away from the source
 * it spans, so an exact match proves nothing was rewritten. That matters
 * because this transformer reads bracket syntax out of the value and writes it
 * back unescaped; a node where source and value disagree is left alone rather
 * than risk turning `\[^a]` into `[^a]`.
 *
 * A continuation line is compared by suffix because `source.slice()` returns
 * the container's own `> ` markers and indentation, which never reach the
 * value. Only whitespace and `>` may be dropped that way — a `\` in the dropped
 * span would be exactly the escape this guard exists to respect.
 */
function isVerbatimText(node: MarkdownNode, source: string): boolean {
    const value = node.value;
    if (typeof value !== "string") return false;
    const position = node.position as Position | undefined;
    const start = position?.start.offset;
    const end = position?.end.offset;
    if (start === undefined || end === undefined) return false;

    const rawLines = source.slice(start, end).split("\n");
    const valueLines = value.split("\n");
    if (rawLines.length !== valueLines.length) return false;
    // The first line begins at the node itself, so it carries no decoration.
    if (rawLines[0] !== valueLines[0]) return false;

    for (let index = 1; index < rawLines.length; index += 1) {
        const raw = rawLines[index];
        const line = valueLines[index];
        if (!raw.endsWith(line)) return false;
        const dropped = raw.slice(0, raw.length - line.length);
        if (!CONTAINER_DECORATION.test(dropped)) return false;
    }
    return true;
}

function splitTextNode(node: MarkdownNode, source: string): MarkdownNode[] | null {
    if (!isVerbatimText(node, source)) return null;
    const value = node.value as string;

    const matches = findFootnoteReferences(value);
    if (matches.length === 0) return null;

    const pieces: MarkdownNode[] = [];
    let cursor = 0;
    for (const match of matches) {
        if (match.start > cursor) {
            pieces.push({
                type: "text",
                value: value.slice(cursor, match.start),
            });
        }
        pieces.push({
            type: FOOTNOTE_REFERENCE_MDAST_TYPE,
            label: match.label,
            identifier: match.label,
        });
        cursor = match.end;
    }
    if (cursor < value.length) {
        pieces.push({ type: "text", value: value.slice(cursor) });
    }

    return pieces;
}

/**
 * Rewrites `text` children in place. Only `text` nodes are visited, so an
 * `inlineCode` or `code` node — whose payload lives in `value`, not in children
 * — is structurally out of reach and stays literal.
 */
function transformChildren(node: MarkdownNode, source: string): void {
    const children = node.children;
    if (!Array.isArray(children)) return;

    let rewritten: MarkdownNode[] | null = null;
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.type === "text") {
            const pieces = splitTextNode(child, source);
            if (pieces) {
                rewritten ??= children.slice(0, index);
                rewritten.push(...pieces);
                continue;
            }
        } else {
            transformChildren(child, source);
        }
        rewritten?.push(child);
    }

    if (rewritten) node.children = rewritten;
}

/**
 * No options of its own. Typed as remark's own option bag rather than an empty
 * one because this plugin is registered by hand, into the slice whose entries
 * all carry that type, instead of through `$remark`.
 */
export type FootnoteRemarkOptions = Record<string, unknown>;

/**
 * Makes a footnote call a reference even when nothing defines it.
 *
 * GFM only tokenizes `[^label]` once a matching definition exists; until then
 * the call is ordinary text, and the CommonMark writer escapes its `[` on the
 * way out, so writing a reference before its definition rewrites the document.
 * Re-reading the call here keeps those bytes and gives the half-written
 * footnote the same structure as a finished one.
 *
 * Nothing is registered on the stringify side: a `footnoteReference` is already
 * something GFM knows how to write.
 */
export const footnoteRemarkPlugin: RemarkPluginRaw<FootnoteRemarkOptions> =
    function footnoteRemark() {
        return (tree, file) => {
            transformChildren(tree as MarkdownNode, String(file));
        };
    };
