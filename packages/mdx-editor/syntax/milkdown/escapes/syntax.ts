/**
 * Reading which characters the author escaped, out of the source they wrote.
 *
 * An escape is content, not formatting: `\[` written in the source has to come
 * back as `\[`, and `[` written in the source has to come back as `[`. Neither
 * can be decided from the character alone — every `[…]` is a valid link label,
 * so whether a bracket is inert depends on definitions elsewhere in the
 * document, and a document can gain one later. The source says which was
 * written, and that is the only local answer there is.
 *
 * This module is the reading half. It is deliberately pure: given a text node's
 * value and the source span it came from, it says which characters arrived
 * escaped, or says it cannot tell.
 */

/** The mdast node an authored-escape run travels in. */
export const AUTHORED_ESCAPE_MDAST_TYPE = "mdxAuthoredEscape";

/** The ProseMirror mark that carries the run through the document. */
export const AUTHORED_ESCAPE_MARK_NAME = "mdx_authored_escape";

/**
 * What a marked run of text asks the writer for.
 *
 * `escaped` is the recorded fact: every character in the run carried a
 * backslash in the source and gets one back. `auto` is the absence of a fact:
 * the run's value could not be matched against its source, so the writer's own
 * escaping decides, exactly as it did before this layer existed.
 */
export type AuthoredEscapeMode = "escaped" | "auto";

/** ASCII punctuation, the only characters a backslash escape can precede. */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * Everything a blockquote or list item may put in front of a continuation line.
 *
 * `source.slice()` returns the container's own markers and indentation, which
 * never reach a text node's value. Only whitespace and `>` may be dropped that
 * way — a `\` in the dropped span would be exactly the escape this module
 * exists to read.
 */
const CONTAINER_DECORATION = /^[ \t>]*/;

/** A run of a text node's value that shares one provenance. */
export interface AuthoredRun {
    /** True when every character in the run carried a backslash in the source. */
    escaped: boolean;
    /** The characters as the document holds them, with escapes resolved. */
    value: string;
    /** Source offsets of the bytes this run was written as. */
    from: number;
    to: number;
}

/** True for a character a backslash escape can precede. */
export function isEscapableCharacter(character: string): boolean {
    return character.length === 1 && ASCII_PUNCTUATION.test(character);
}

/**
 * Matches one line of a value against one line of its source.
 *
 * Returns one run per character so the caller can merge them; returns null the
 * moment the two disagree, which is what keeps a rewritten value — a decoded
 * `&amp;`, a fragment some other transformer built — from being read as if the
 * source still described it.
 */
function alignLine(
    raw: string,
    line: string,
    base: number,
): AuthoredRun[] | null {
    const runs: AuthoredRun[] = [];
    let source = 0;
    let index = 0;
    while (index < line.length) {
        if (source >= raw.length) return null;
        if (
            raw[source] === "\\" &&
            source + 1 < raw.length &&
            raw[source + 1] === line[index] &&
            ASCII_PUNCTUATION.test(raw[source + 1])
        ) {
            runs.push({
                escaped: true,
                value: line[index],
                from: base + source,
                to: base + source + 2,
            });
            source += 2;
            index += 1;
            continue;
        }
        if (raw[source] === line[index]) {
            runs.push({
                escaped: false,
                value: line[index],
                from: base + source,
                to: base + source + 1,
            });
            source += 1;
            index += 1;
            continue;
        }
        return null;
    }
    // Source left over means the span holds something the value does not
    // account for, so the correspondence this whole layer rests on is broken.
    return source === raw.length ? runs : null;
}

/** Joins neighbouring characters that share a provenance into one run. */
function merge(runs: AuthoredRun[]): AuthoredRun[] {
    const merged: AuthoredRun[] = [];
    for (const run of runs) {
        const last = merged[merged.length - 1];
        if (last && last.escaped === run.escaped && last.to === run.from) {
            last.value += run.value;
            last.to = run.to;
            continue;
        }
        merged.push({ ...run });
    }
    return merged;
}

/**
 * Reads which characters of `value` were escaped in `source[start, end)`, or
 * null when the two do not correspond character for character.
 *
 * Continuation lines are matched after dropping container decoration, the same
 * allowance the footnote transformer makes for the same reason: a blockquote's
 * `> ` and a list item's indentation belong to the container, not to the text.
 * The first line begins at the node itself, so it carries none.
 */
export function readAuthoredEscapes(
    value: string,
    source: string,
    start: number,
    end: number,
): AuthoredRun[] | null {
    if (start > end || end > source.length) return null;
    const rawLines = source.slice(start, end).split("\n");
    const valueLines = value.split("\n");
    if (rawLines.length !== valueLines.length) return null;

    const runs: AuthoredRun[] = [];
    let base = start;
    for (let index = 0; index < rawLines.length; index += 1) {
        const raw = rawLines[index];
        const decoration =
            index === 0 ? 0 : (CONTAINER_DECORATION.exec(raw)?.[0].length ?? 0);
        let lined: AuthoredRun[] | null = null;
        for (let prefix = 0; prefix <= decoration; prefix += 1) {
            lined = alignLine(raw.slice(prefix), valueLines[index], base + prefix);
            if (lined) break;
        }
        if (!lined) return null;
        runs.push(...lined);
        if (index < rawLines.length - 1) {
            // The line ending is in both the value and the source, and it is
            // never escaped: a `\` before it is a hard break, which is a node.
            runs.push({
                escaped: false,
                value: "\n",
                from: base + raw.length,
                to: base + raw.length + 1,
            });
        }
        base += raw.length + 1;
    }
    return merge(runs);
}

/**
 * Writes a run of characters back with the backslashes it arrived with.
 *
 * A character that cannot be escaped is written as it is. Only text typed into
 * an existing run can put one here — a run built from source holds nothing but
 * escaped punctuation — and `\a` would be a literal backslash, not an escape.
 */
export function writeAuthoredEscapes(value: string): string {
    let written = "";
    for (const character of value) {
        written += isEscapableCharacter(character) ? `\\${character}` : character;
    }
    return written;
}
