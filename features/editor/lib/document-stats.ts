/**
 * What a document says, counted as prose rather than as Markdown.
 *
 * The counts are for the person writing, so they are taken over what the
 * document says and not over the characters it is stored as: fenced code and
 * front matter are not prose and are dropped whole, while inline markers are
 * dropped and the words they wrap are kept — a bold word is still a word.
 *
 * Nothing here reads the editor or the rendered document. It is a function of
 * the Markdown source, so the same document always counts the same however it
 * is being displayed.
 */

export interface DocumentStats {
    /** Latin word runs plus CJK characters, which are words with no spaces. */
    words: number;
    /** Prose characters, not counting whitespace. */
    characters: number;
    /** Whole minutes to read, or 0 for a document with no prose in it. */
    minutes: number;
}

/**
 * Reading pace, in words per minute.
 *
 * One pace for both scripts because one number is what a status bar has room
 * to be honest about: a CJK character counts as a word here, and 300 of them a
 * minute is the ordinary Chinese reading speed, which is also within the range
 * quoted for English prose.
 */
const WORDS_PER_MINUTE = 300;

/**
 * Characters that are words on their own.
 *
 * CJK ideographs, kana and Hangul syllables: scripts that do not put spaces
 * between words, so there is nothing else to count.
 */
const CJK_PATTERN =
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu;

/** A Latin-script word, keeping the marks that sit inside one. */
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

export function documentStats(markdown: string): DocumentStats {
    const prose = documentProse(markdown);
    const cjk = prose.match(CJK_PATTERN)?.length ?? 0;
    // CJK characters are already counted, and a run of them carries no spaces
    // to separate the Latin words around it. Blanking them first keeps a
    // Chinese sentence with one English word in it from counting as one word.
    const latin = prose.replace(CJK_PATTERN, " ").match(WORD_PATTERN)?.length ?? 0;
    const words = cjk + latin;

    return {
        words,
        characters: [...prose.replace(/\s+/gu, "")].length,
        // A document with anything in it takes at least a minute to read, but
        // one with nothing in it does not take a minute, and rounding up to
        // "about 1 minute" for an empty file would be a reading time for text
        // that is not there.
        minutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    };
}

/**
 * The document with its markup taken out.
 *
 * Order matters: whole blocks go first, so that a `#` inside a fenced code
 * block is never mistaken for a heading marker and stripped as one.
 *
 * Exported because a note's excerpt asks the same question as a note's word
 * count — what does this document say — and two answers to it would drift.
 */
export function documentProse(markdown: string): string {
    return (
        markdown
            // Front matter, only where it can legally be: the very start.
            .replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "")
            // Fenced code, including a fence left unclosed while it is typed.
            // The unclosed case ends at the end of the input, spelled as a `$`
            // with nothing after it: under `m` a bare `$` matches every line
            // end, which would have closed the fence on its first line.
            .replace(
                /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|$(?![\s\S]))/gm,
                "",
            )
            // HTML tags, whose attributes are not words the author wrote.
            .replace(/<[^>]*>/g, " ")
            // An image contributes no prose: its alt text names a picture.
            .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
            // A link keeps what it says and loses where it points.
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_match, target, label) =>
                label ?? target,
            )
            // Reference definitions are addresses, not prose.
            .replace(/^[ \t]*\[[^\]]+\]:[^\n]*$/gm, " ")
            // Block markers: heading hashes, quote arrows, list bullets and
            // numbers, and the whole line of a thematic break.
            .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
            .replace(/^[ \t]*>+[ \t]?/gm, "")
            .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
            .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, " ")
            // A task box is a state, not a word.
            .replace(/^[ \t]*\[[ xX]\][ \t]+/gm, "")
            // Table rules draw a table; the cells around them stay.
            .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, " ")
            .replace(/\|/g, " ")
            // Inline emphasis and strikethrough markers. Inline code keeps its
            // text: what is written between backticks is what the line says.
            .replace(/(\*\*|__|~~|[*_`])/g, "")
    );
}
