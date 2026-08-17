/** mdast node type for a footnote call, as GFM's own utilities name it. */
export const FOOTNOTE_REFERENCE_MDAST_TYPE = "footnoteReference";

/** ProseMirror node name the GFM preset gives a footnote call. */
export const FOOTNOTE_REFERENCE_NODE_NAME = "footnote_reference";

/** ProseMirror node name the GFM preset gives a footnote definition. */
export const FOOTNOTE_DEFINITION_NODE_NAME = "footnote_definition";

/** Marks the element that carries a footnote call. */
export const FOOTNOTE_REFERENCE_DOM_MARKER = "data-mdx-footnote-reference";

/** Carries the call's label, verbatim. */
export const FOOTNOTE_LABEL_DOM_ATTRIBUTE = "data-mdx-footnote-label";

/**
 * A footnote call as GFM tokenizes it: `[^`, a label, `]`.
 *
 * The label matches GFM's own grammar minus its backslash escapes — at least
 * one and at most 999 characters, none of them `[`, `]`, or whitespace.
 * Escapes are excluded because the escaped and the unescaped spelling of one
 * label do not come back as the same bytes.
 */
const FOOTNOTE_REFERENCE_PATTERN = /\[\^([^[\]\s\\]{1,999})\]/g;

export interface FootnoteReferenceMatch {
    label: string;
    /** Index of `[` in the searched string. */
    start: number;
    /** Index just past `]` in the searched string. */
    end: number;
}

/** Every footnote call in `value`, in source order. */
export function findFootnoteReferences(
    value: string,
): FootnoteReferenceMatch[] {
    const matches: FootnoteReferenceMatch[] = [];
    const pattern = new RegExp(FOOTNOTE_REFERENCE_PATTERN);
    let match = pattern.exec(value);
    while (match !== null) {
        matches.push({
            label: match[1],
            start: match.index,
            end: match.index + match[0].length,
        });
        match = pattern.exec(value);
    }
    return matches;
}

/** Writes a label back as the call the parser would read it from. */
export function formatFootnoteReference(label: string): string {
    return `[^${label}]`;
}

/** True when `label` survives a write-then-read cycle unchanged. */
export function isRoundTrippableFootnoteLabel(label: string): boolean {
    const found = findFootnoteReferences(formatFootnoteReference(label));
    return found.length === 1 && found[0].label === label;
}
