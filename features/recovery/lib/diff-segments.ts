import type { DiffLine } from "./types";

/**
 * How much unchanged text stays visible around a change, so a difference is
 * read in its context rather than as a floating line.
 */
export const DEFAULT_DIFF_CONTEXT_LINES = 3;

export interface DiffSegmentLines {
    kind: "lines";
    lines: DiffLine[];
}

export interface DiffSegmentCollapsed {
    kind: "collapsed";
    id: string;
    lines: DiffLine[];
}

export type DiffSegment = DiffSegmentLines | DiffSegmentCollapsed;

export interface DiffSummary {
    added: number;
    removed: number;
    /** Number of separate places that changed, not the number of lines. */
    changes: number;
}

export function summarizeDiff(diffLines: DiffLine[]): DiffSummary {
    let added = 0;
    let removed = 0;
    let changes = 0;
    let insideChange = false;

    for (const line of diffLines) {
        if (line.kind === "equal") {
            insideChange = false;
            continue;
        }

        if (line.kind === "added") {
            added += 1;
        } else {
            removed += 1;
        }

        if (!insideChange) {
            changes += 1;
            insideChange = true;
        }
    }

    return { added, removed, changes };
}

/**
 * Fold long unchanged stretches away.
 *
 * A recovery diff is usually one edit inside a document that is otherwise
 * identical. Rendering every equal line means the reader scrolls a wall of
 * unchanged text looking for the tinted rows, which is the same as not showing
 * the difference at all — and on a long document it is also thousands of DOM
 * nodes nobody asked for.
 */
export function buildDiffSegments(
    diffLines: DiffLine[],
    contextLines: number = DEFAULT_DIFF_CONTEXT_LINES,
): DiffSegment[] {
    const segments: DiffSegment[] = [];

    const pushLines = (lines: DiffLine[]) => {
        if (lines.length === 0) {
            return;
        }

        const last = segments.at(-1);
        if (last?.kind === "lines") {
            last.lines.push(...lines);
            return;
        }

        segments.push({ kind: "lines", lines: [...lines] });
    };

    let index = 0;
    while (index < diffLines.length) {
        if (diffLines[index].kind !== "equal") {
            pushLines([diffLines[index]]);
            index += 1;
            continue;
        }

        let end = index;
        while (end < diffLines.length && diffLines[end].kind === "equal") {
            end += 1;
        }

        const run = diffLines.slice(index, end);
        // Context is only needed on the side that has a change next to it.
        const leading = index === 0 ? 0 : contextLines;
        const trailing = end === diffLines.length ? 0 : contextLines;

        // Folding a single line saves nothing and costs a click.
        if (run.length <= leading + trailing + 1) {
            pushLines(run);
        } else {
            pushLines(run.slice(0, leading));
            segments.push({
                kind: "collapsed",
                id: `collapsed-${index}`,
                lines: run.slice(leading, run.length - trailing),
            });
            pushLines(run.slice(run.length - trailing));
        }

        index = end;
    }

    return segments;
}
