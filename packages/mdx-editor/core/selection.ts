import type { SelectionState } from "./types";

export function selectionSnapshotFromMarkdownOffsets(
    markdown: string,
    anchor: number,
    head: number,
    contextChars = 4000,
): SelectionState {
    const start = clamp(Math.min(anchor, head), 0, markdown.length);
    const end = clamp(Math.max(anchor, head), 0, markdown.length);
    const beforeStart = Math.max(0, start - contextChars);
    const afterEnd = Math.min(markdown.length, end + contextChars);

    return {
        has_selection: end > start,
        selected_text: markdown.slice(start, end),
        before: markdown.slice(beforeStart, start),
        after: markdown.slice(end, afterEnd),
        before_truncated: beforeStart > 0,
        after_truncated: afterEnd < markdown.length,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
