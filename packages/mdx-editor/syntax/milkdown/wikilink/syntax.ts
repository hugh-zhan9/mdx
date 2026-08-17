/**
 * Pure `[[target]]` / `[[target|alias]]` scanning and formatting.
 *
 * This module knows nothing about Markdown structure. It only ever sees the
 * value of a single mdast `text` node, which is why inline code and fenced code
 * can never reach it: those arrive as `inlineCode` / `code` nodes that carry
 * their payload in `value`, not as text children.
 */

/** Attribute name shared by the mdast node, the ProseMirror node, and the DOM. */
export const WIKILINK_MDAST_TYPE = "wikilink";

const OPEN = "[[";
const CLOSE = "]]";
const ALIAS_SEPARATOR = "|";

/**
 * Characters that would make the link body unrecoverable on the next parse.
 * U+FFFC is ProseMirror's placeholder for a leaf node in `textBetween`, so
 * excluding it stops an input rule from swallowing an existing wikilink.
 */
const BODY_REJECT = /[[\]\n\r￼]/;

export interface WikilinkBody {
    target: string;
    /** `null` when the source had no `|`; `""` when it had a trailing one. */
    alias: string | null;
}

export interface WikilinkMatch extends WikilinkBody {
    /** Index of the first `[` in the scanned text. */
    start: number;
    /** Index just past the last `]` in the scanned text. */
    end: number;
}

/** Splits the text between `[[` and `]]`, or `null` when it is not a link. */
export function parseWikilinkBody(inner: string): WikilinkBody | null {
    if (BODY_REJECT.test(inner)) return null;

    const separator = inner.indexOf(ALIAS_SEPARATOR);
    const target = separator < 0 ? inner : inner.slice(0, separator);
    if (target.length === 0) return null;

    return {
        target,
        alias: separator < 0 ? null : inner.slice(separator + 1),
    };
}

/**
 * Finds every wikilink in a single text run, left to right and non-overlapping.
 *
 * A `[[` whose body fails validation is not a link, and scanning resumes one
 * character later so `[[[Target]]` still yields the inner `[[Target]]`.
 */
export function findWikilinks(text: string): WikilinkMatch[] {
    const matches: WikilinkMatch[] = [];
    let cursor = 0;

    while (cursor < text.length) {
        const open = text.indexOf(OPEN, cursor);
        if (open < 0) break;

        const close = text.indexOf(CLOSE, open + OPEN.length);
        // No terminator anywhere after this opener means none exists after any
        // later opener either, so the scan is finished.
        if (close < 0) break;

        const body = parseWikilinkBody(text.slice(open + OPEN.length, close));
        if (!body) {
            cursor = open + 1;
            continue;
        }

        matches.push({ start: open, end: close + CLOSE.length, ...body });
        cursor = close + CLOSE.length;
    }

    return matches;
}

/** Renders a wikilink back to Markdown. The output is emitted unescaped. */
export function formatWikilink(target: string, alias: string | null): string {
    const body = alias === null ? target : `${target}${ALIAS_SEPARATOR}${alias}`;
    return `${OPEN}${body}${CLOSE}`;
}

/**
 * True when the pair would serialize to Markdown that parses back to itself.
 *
 * Values reaching the schema through clipboard HTML are attacker-controlled, so
 * they are checked here rather than trusted to be scanner output.
 */
export function isRoundTrippableWikilink(
    target: string,
    alias: string | null,
): boolean {
    if (target.length === 0) return false;
    if (target.includes(ALIAS_SEPARATOR)) return false;
    if (BODY_REJECT.test(target)) return false;
    if (alias !== null && BODY_REJECT.test(alias)) return false;
    return true;
}

/** The text a reader sees for a wikilink: the alias when present, else the target. */
export function wikilinkLabel(target: string, alias: string | null): string {
    return alias === null || alias.length === 0 ? target : alias;
}
