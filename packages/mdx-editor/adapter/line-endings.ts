/**
 * Line endings, and the offset skew they create.
 *
 * Both editing surfaces hold the document with `\n` line breaks: remark
 * normalizes every line ending while parsing, and CodeMirror stores every line
 * break as a single character. The Markdown the session holds keeps whatever
 * the file arrived with. That makes the session's text and the surface's text
 * two different strings whenever the file uses CRLF, and every offset crossing
 * the boundary has to account for the difference exactly.
 *
 * The translation happens once, where a surface hands Markdown back: nothing
 * inside a document — a preserved slice, a code block's content — ever holds a
 * carriage return, so nothing can accumulate one. An earlier attempt that let
 * `\r` into the document and then rewrote line endings on the way out grew a
 * carriage return inside fenced code on every keystroke.
 */

/** The line ending a serialized document is written with. */
export type LineEndingStyle = "lf" | "crlf";

export interface LineEndingReading {
    style: LineEndingStyle;
    /**
     * True when the document did not use one line ending throughout.
     *
     * Mixed endings are already an anomaly, and preserving them means deciding
     * per line what the author meant — which produces a file no one intended.
     * Such a document normalizes to `\n`, and the caller reports it.
     */
    mixed: boolean;
}

/**
 * Which line ending `markdown` is written with.
 *
 * Uniformly CRLF means every `\r` is followed by `\n` and every `\n` is
 * preceded by one. A document with no `\r` at all is LF. Everything else —
 * including a CR-only document, which is not CRLF — is mixed.
 */
export function readLineEndingStyle(markdown: string): LineEndingReading {
    if (!markdown.includes("\r")) return { style: "lf", mixed: false };
    for (let index = 0; index < markdown.length; index += 1) {
        const code = markdown.charCodeAt(index);
        if (code === 13) {
            if (markdown.charCodeAt(index + 1) !== 10) {
                return { style: "lf", mixed: true };
            }
            index += 1;
            continue;
        }
        if (code === 10) return { style: "lf", mixed: true };
    }
    return { style: "crlf", mixed: false };
}

/** `markdown` with every line ending as `\n`. This is what a surface holds. */
export function toLineFeeds(markdown: string): string {
    return markdown.includes("\r") ? markdown.replace(/\r\n?/g, "\n") : markdown;
}

/**
 * `markdown` written with `style`.
 *
 * `markdown` must already hold `\n` line breaks and nothing else, which is what
 * {@link toLineFeeds} guarantees and what both surfaces hold. Applying this to
 * text that still contains a carriage return would double it.
 */
export function fromLineFeeds(
    markdown: string,
    style: LineEndingStyle,
): string {
    return style === "crlf" ? markdown.replace(/\n/g, "\r\n") : markdown;
}

/**
 * The offset in `toLineFeeds(markdown)` naming the same place as `offset` does
 * in `markdown`, or null when it names no place at all.
 *
 * A CRLF document is longer than the text the surface holds by one unit per
 * line break before the offset. Checking only whether an offset ran past the
 * end catches the last few and lets every earlier one through mis-resolved,
 * which silently edits the wrong text. An offset landing between a `\r` and its
 * `\n` names no position in the normalized text and is refused rather than
 * snapped to one side.
 */
export function toNormalizedOffset(
    markdown: string,
    offset: number,
): number | null {
    if (!markdown.includes("\r")) return offset;
    let normalized = 0;
    let index = 0;
    while (index < offset) {
        const isCrLf =
            markdown.charCodeAt(index) === 13 &&
            markdown.charCodeAt(index + 1) === 10;
        if (isCrLf) {
            // Splitting the pair would name a position the normalized text
            // does not have.
            if (index + 2 > offset) return null;
            index += 2;
        } else {
            index += 1;
        }
        normalized += 1;
    }
    return normalized;
}

/** The offset in `markdown` naming the same place as `normalized` does in its
 * normalization. */
export function fromNormalizedOffset(
    markdown: string,
    normalized: number,
): number {
    if (!markdown.includes("\r")) return normalized;
    let offset = 0;
    for (let step = 0; step < normalized; step += 1) {
        const isCrLf =
            markdown.charCodeAt(offset) === 13 &&
            markdown.charCodeAt(offset + 1) === 10;
        offset += isCrLf ? 2 : 1;
    }
    return offset;
}

/** The diagnostic a surface reports when it normalizes a mixed-ending file. */
export const MIXED_LINE_ENDINGS_DIAGNOSTIC = {
    code: "editor_line_endings_normalized",
    message:
        "the document mixed CRLF and LF line endings and was normalized to LF",
} as const;
