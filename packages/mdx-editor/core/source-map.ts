import type { SourceRange } from "./types";

export type { SourceRange } from "./types";

export function sourceRange(start: number, end: number): SourceRange {
    return {
        start: Math.max(0, start),
        end: Math.max(Math.max(0, start), end),
    };
}

export function originalSliceForRange(
    markdown: string,
    range: SourceRange,
): string {
    const start = Math.max(0, Math.min(range.start, markdown.length));
    const end = Math.max(start, Math.min(range.end, markdown.length));
    return markdown.slice(start, end);
}
