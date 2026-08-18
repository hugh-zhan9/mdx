import { documentProse } from "@/features/editor/lib/document-stats";

import { normalizeWorkspacePath } from "./path";

/**
 * The workspace's notes as a list of notes, rather than as a tree of files.
 *
 * The backend reads each note's first bytes and modification time; everything
 * here is derived from those two facts. Nothing in this file touches the file
 * system, so a list row can be worked out, tested and re-derived without one.
 */

/** One note as the backend reports it. */
export interface NoteIndexEntry {
    path: string;
    /** Milliseconds since the Unix epoch, or null when the platform had none. */
    modifiedMs: number | null;
    /** The note's first bytes, as text. Not the whole document. */
    head: string;
    headTruncated: boolean;
}

/** One row of the note list. */
export interface NoteCard {
    path: string;
    /** What the note calls itself, falling back to what the file is called. */
    title: string;
    /** The opening prose, or an empty string for a note that has none yet. */
    excerpt: string;
    modifiedMs: number | null;
}

/**
 * How much prose a row carries.
 *
 * The row shows two clipped lines, so this is only generous enough that
 * clipping is what the reader sees rather than the end of the string. Sending
 * the whole head into the DOM for every note is a page of text per row.
 */
const EXCERPT_MAX_CHARS = 140;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function noteCard(entry: NoteIndexEntry): NoteCard {
    const title = noteTitle(entry);

    return {
        path: entry.path,
        title,
        excerpt: noteExcerpt(entry.head, title),
        modifiedMs: entry.modifiedMs,
    };
}

/** Which notes the list is a list of. */
export type NoteGroup = "all" | "recent" | "unfiled";

/**
 * How many notes each group holds, before the filter.
 *
 * Counted by the backend from the pass that timed the notes, so they describe
 * the workspace rather than the page on screen.
 */
export interface NoteGroupCounts {
    all: number;
    recent: number;
    unfiled: number;
}

/** One page of notes, and what the workspace holds around it. */
export interface NotePageResult {
    rootPath: string;
    notes: NoteIndexEntry[];
    /** How many notes the group holds once the filter has been applied. */
    matched: number;
    counts: NoteGroupCounts;
    truncated: boolean;
    warnings: string[];
}

/** What one page is a page of. */
export interface NotePageRequest {
    rootPath: string;
    group: NoteGroup;
    /** Matched against file names by the backend, or empty for all of them. */
    query: string;
    /**
     * The folder being looked at, or null for the whole workspace.
     *
     * The same folder the file tree is showing: one state, both columns. Every
     * count comes back relative to it, because a count of the whole workspace
     * while one folder is open is a number about somewhere else.
     */
    focusPath: string | null;
    offset: number;
    limit: number;
}

/**
 * How long ago, in the words a list uses.
 *
 * Coarse on purpose: the row is scanned, not read, and "3小时前" answers the
 * question "is this the one I was just in" that a timestamp does not. A time in
 * the future is a clock that disagrees with itself, not a note edited later, so
 * it reads as just now.
 */
export function formatRelativeTime(
    modifiedMs: number | null,
    nowMs: number,
): string {
    if (modifiedMs === null) {
        return "";
    }

    const elapsed = nowMs - modifiedMs;

    if (elapsed < MINUTE_MS) {
        return "刚刚";
    }

    if (elapsed < HOUR_MS) {
        return `${Math.floor(elapsed / MINUTE_MS)}分钟前`;
    }

    if (elapsed < DAY_MS) {
        return `${Math.floor(elapsed / HOUR_MS)}小时前`;
    }

    if (elapsed < 2 * DAY_MS) {
        return "昨天";
    }

    if (elapsed < 7 * DAY_MS) {
        return `${Math.floor(elapsed / DAY_MS)}天前`;
    }

    const edited = new Date(modifiedMs);
    const month = `${edited.getMonth() + 1}`.padStart(2, "0");
    const day = `${edited.getDate()}`.padStart(2, "0");

    // The year is only worth its space once it is not this one.
    if (edited.getFullYear() === new Date(nowMs).getFullYear()) {
        return `${month}/${day}`;
    }

    return `${edited.getFullYear()}/${month}/${day}`;
}

/**
 * What the note calls itself.
 *
 * Front matter first, then the first heading, then the file name: the first two
 * are what the author wrote at the top of the document, and the third is all
 * there is to go on for a note that has not been given a title yet.
 */
function noteTitle(entry: NoteIndexEntry): string {
    const frontMatter = entry.head.match(
        /^---\r?\n([\s\S]*?)(?:\r?\n---|$)/,
    )?.[1];

    if (frontMatter) {
        const declared = frontMatter.match(/^title:[ \t]*(.+?)[ \t]*$/m)?.[1];
        const unquoted = declared?.replace(/^["'](.*)["']$/, "$1").trim();

        if (unquoted) {
            return unquoted;
        }
    }

    const heading = entry.head
        .replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "")
        .match(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m)?.[1];

    if (heading) {
        return documentProse(heading).trim() || fileNameOf(entry.path);
    }

    return fileNameOf(entry.path);
}

function noteExcerpt(head: string, title: string): string {
    const prose = documentProse(head).replace(/\s+/gu, " ").trim();
    // The title is usually the document's first line, and a row that says it
    // twice has spent its one line of prose on the words already above it.
    const body = prose.startsWith(title)
        ? prose.slice(title.length).trim()
        : prose;

    return [...body].slice(0, EXCERPT_MAX_CHARS).join("");
}

function fileNameOf(path: string): string {
    const name = normalizeWorkspacePath(path).split("/").pop() ?? path;

    return name.replace(/\.(md|markdown)$/i, "");
}
