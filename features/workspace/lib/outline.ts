import type { MarkdownOutlineHeading } from "./types";

/**
 * Reads the document outline out of the Markdown source.
 *
 * Every heading carries the UTF-16 source span of its own text, so navigating
 * to it is a request the editor adapter can answer from the document itself.
 * Nothing here looks at a rendered heading element, and nothing here depends on
 * which editing surface is mounted.
 */
export function parseMarkdownOutline(markdown: string): MarkdownOutlineHeading[] {
    const headings: MarkdownOutlineHeading[] = [];
    const slugCounts = new Map<string, number>();
    let inFence = false;
    let lineStart = 0;

    splitSourceLines(markdown).forEach((line, index) => {
        const currentLineStart = lineStart;
        // Advance past this line and its terminator before any early return, so
        // the next heading's offsets stay anchored to the real source.
        lineStart += line.length + line.terminatorLength;

        if (inFence) {
            if (isClosingFence(line.text)) {
                inFence = false;
            }

            return;
        }

        if (line.text.startsWith("```")) {
            inFence = !hasSameLineClosingFence(line.text);
            return;
        }

        const headingMatch = line.text.match(/^(#{1,6})([ \t]+)(.+?)\s*$/);

        if (!headingMatch) {
            return;
        }

        const text = headingMatch[3].replace(/[ \t]+#+[ \t]*$/, "");

        if (text.length === 0) {
            return;
        }

        const anchor =
            currentLineStart + headingMatch[1].length + headingMatch[2].length;

        headings.push({
            id: createHeadingId(text, slugCounts),
            level: headingMatch[1].length as MarkdownOutlineHeading["level"],
            text,
            line: index + 1,
            range: { anchor, head: anchor + text.length },
        });
    });

    return headings;
}

interface SourceLine {
    text: string;
    /** UTF-16 length of the line's own text, excluding its terminator. */
    length: number;
    /** 0 at end of input, 1 for `\n`, 2 for `\r\n`. */
    terminatorLength: number;
}

/**
 * Splits Markdown into lines while keeping each terminator's real length.
 *
 * `split(/\r?\n/)` discards how many characters separated two lines, which is
 * exactly what an offset has to count. A CRLF document would otherwise report
 * every heading one character early per preceding line.
 */
function splitSourceLines(markdown: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let index = 0;

    while (index <= markdown.length) {
        const newlineIndex = markdown.indexOf("\n", index);

        if (newlineIndex === -1) {
            const text = markdown.slice(index);
            lines.push({ text, length: text.length, terminatorLength: 0 });
            break;
        }

        const hasCarriageReturn = markdown.charCodeAt(newlineIndex - 1) === 13;
        const textEnd = hasCarriageReturn ? newlineIndex - 1 : newlineIndex;
        const text = markdown.slice(index, textEnd);
        lines.push({
            text,
            length: text.length,
            terminatorLength: hasCarriageReturn ? 2 : 1,
        });
        index = newlineIndex + 1;
    }

    return lines;
}

/**
 * A heading as a label, for a list that is read rather than edited.
 *
 * `text` is the heading's Markdown source, and navigation measures the heading's
 * span with its length, so it cannot be tidied in place. This is the same words
 * with the markup taken off, for display only.
 *
 * Character references are decoded because the document itself decodes them:
 * this editor writes a trailing space as `&#x20;` when it saves, and the body
 * then shows that heading as a space. An outline printing the five characters
 * `&#x20;` is describing a heading the reader cannot see.
 */
export function outlineHeadingLabel(text: string): string {
    return decodeCharacterReferences(
        text
            // An image in a heading says whatever its alt text says.
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
            // A link keeps what it says and loses where it points.
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(
                /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g,
                (_match, target: string, label?: string) => label ?? target,
            )
            // Emphasis, strikethrough and code markers, keeping what they wrap.
            .replace(/(\*\*|__|~~|[*_`])/g, ""),
    ).trim();
}

const NAMED_CHARACTER_REFERENCES: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: "\u00a0",
    quot: '"',
};

function decodeCharacterReferences(text: string): string {
    return (
        text
            .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) =>
                characterFrom(Number.parseInt(hex, 16), match),
            )
            .replace(/&#(\d+);/g, (match, decimal: string) =>
                characterFrom(Number(decimal), match),
            )
            // Only the handful a Markdown heading is likely to carry. An
            // unknown name is left exactly as written rather than guessed at.
            .replace(
                /&([a-z]+);/gi,
                (match, name: string) =>
                    NAMED_CHARACTER_REFERENCES[name.toLowerCase()] ?? match,
            )
    );
}

function characterFrom(code: number, original: string): string {
    // A reference outside the code points, or to half of a surrogate pair,
    // names no character. Left as written: it is what the source says.
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) {
        return original;
    }

    if (code >= 0xd800 && code <= 0xdfff) {
        return original;
    }

    return String.fromCodePoint(code);
}

function isClosingFence(line: string) {
    return line.includes("```");
}

function hasSameLineClosingFence(line: string) {
    return line.indexOf("```", 3) !== -1;
}

function createHeadingId(text: string, slugCounts: Map<string, number>) {
    const base =
        text
            .toLowerCase()
            .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
            .replace(/^-+|-+$/g, "") || "heading";
    const count = slugCounts.get(base) ?? 0;

    slugCounts.set(base, count + 1);

    return count === 0 ? base : `${base}-${count}`;
}
