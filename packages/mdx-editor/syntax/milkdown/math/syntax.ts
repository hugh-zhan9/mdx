/** mdast node type for display math, as produced by `mdast-util-math`. */
export const MATH_MDAST_TYPE = "math";

/** mdast node type for inline math, as produced by `mdast-util-math`. */
export const INLINE_MATH_MDAST_TYPE = "inlineMath";

/** ProseMirror node names, matching the ones the rest of MDX already uses. */
export const MATH_INLINE_NODE_NAME = "math_inline";
export const MATH_BLOCK_NODE_NAME = "math_block";

/** A dollar-fenced run inside one plain-text value, as half-open offsets. */
export interface InlineMathRun {
    start: number;
    end: number;
}

function isMathSpace(char: string | undefined): boolean {
    return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isDigit(char: string | undefined): boolean {
    return char !== undefined && char >= "0" && char <= "9";
}

/** Length of the run of `$` starting at `index`, zero when there is none. */
function dollarRunLength(value: string, index: number): number {
    let length = 0;
    while (value[index + length] === "$") length += 1;
    return length;
}

/**
 * Whether a dollar-fenced run micromark tokenized is really math.
 *
 * micromark closes text math at the next `$` whatever surrounds it, which turns
 * `costs $5 and $10 today` into a math span. These are the Pandoc rules that
 * keep currency literal: a single-dollar span may not be padded with
 * whitespace and may not be followed by a digit. Two or more dollars are
 * unambiguous, so such a run is always math.
 *
 * @param raw the source of the run, delimiters included
 * @param after the source that follows the run, of which only the first
 * character is read
 */
export function isAcceptedInlineMath(raw: string, after: string): boolean {
    const size = dollarRunLength(raw, 0);
    if (size === 0 || raw.length <= size * 2) return false;
    if (size > 1) return true;
    const content = raw.slice(size, raw.length - size);
    if (isMathSpace(content[0])) return false;
    if (isMathSpace(content[content.length - 1])) return false;
    return !isDigit(after[0]);
}

/** Offset of the next `$` run of exactly `size` dollars, or `-1`. */
function findClosingRun(value: string, from: number, size: number): number {
    let index = from;
    while (index < value.length) {
        if (value[index] !== "$") {
            index += 1;
            continue;
        }
        const length = dollarRunLength(value, index);
        if (length === size) return index;
        index += length;
    }
    return -1;
}

/**
 * Every run in `value` that would be re-read as math were `value` emitted as
 * plain Markdown text. Mirrors micromark's text-math scan — open at a `$` run,
 * close at the next run of the same size, resume after it — and then keeps only
 * the runs {@link isAcceptedInlineMath} accepts.
 *
 * @param after the text that follows this value, of which only the first
 * character is read
 */
export function findInlineMathRuns(
    value: string,
    after: string,
): InlineMathRun[] {
    const runs: InlineMathRun[] = [];
    let index = 0;
    while (index < value.length) {
        if (value[index] !== "$") {
            index += 1;
            continue;
        }
        const size = dollarRunLength(value, index);
        const closing = findClosingRun(value, index + size, size);
        if (closing === -1) {
            index += size;
            continue;
        }
        const end = closing + size;
        const following = value.slice(end, end + 1) || after;
        if (isAcceptedInlineMath(value.slice(index, end), following)) {
            runs.push({ start: index, end });
        }
        index = end;
    }
    return runs;
}

/**
 * Offsets of the `$` characters that have to be escaped so `value` survives a
 * re-parse as literal text: both fences of every accepted run, every dollar of
 * them, since a partially escaped `$$` fence would leave a shorter live one.
 */
export function inlineMathEscapeOffsets(value: string, after: string): number[] {
    const offsets: number[] = [];
    for (const run of findInlineMathRuns(value, after)) {
        const size = dollarRunLength(value, run.start);
        for (let index = 0; index < size; index += 1) {
            offsets.push(run.start + index, run.end - size + index);
        }
    }
    return offsets.sort((left, right) => left - right);
}

/**
 * Undoes CommonMark character escapes.
 *
 * Needed because the text inside a dollar run is tokenized raw: when such a run
 * is demoted back to prose its source still carries the backslashes the
 * serializer wrote, and leaving them in would add one more backslash on every
 * later round trip.
 */
export function unescapeMarkdownPunctuation(raw: string): string {
    return raw.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}
