/**
 * The `[!TYPE]` marker that opens a GitHub-style callout blockquote.
 *
 * The type is deliberately unconstrained: an unknown or malformed type such as
 * `[!BANANA]` or `[!NOT A TYPE]` still owns the marker, because the alternative
 * is leaving the blockquote to the CommonMark serializer, which escapes the
 * opening bracket and rewrites the file.
 */
const MARKER_PATTERN = /^\[!([^\]\n]*)\](?:[ \t](.*))?$/;

export interface CalloutMarker {
    /** Text between `[!` and `]`, verbatim, casing preserved. */
    kind: string;
    /** Rest of the marker line after the separating space. Empty when absent. */
    title: string;
}

/** Reads a marker from the first line of a blockquote, or `null` if absent. */
export function parseCalloutMarker(line: string): CalloutMarker | null {
    const match = MARKER_PATTERN.exec(line);
    if (!match) return null;
    return { kind: match[1], title: match[2] ?? "" };
}

/** Renders a marker back to its source line. Inverse of `parseCalloutMarker`. */
export function formatCalloutMarker(marker: CalloutMarker): string {
    if (marker.title.length === 0) return `[!${marker.kind}]`;
    return `[!${marker.kind}] ${marker.title}`;
}

/**
 * `kind` is re-emitted between `[!` and `]`. A bracket or line break there
 * would close the marker early and the callout would come back as something
 * else, so those characters can never reach the attribute.
 */
export function sanitizeCalloutKind(value: string): string {
    return value.replace(/[[\]\r\n]/g, "");
}

/** `title` occupies the rest of the marker line, so it cannot contain breaks. */
export function sanitizeCalloutTitle(value: string): string {
    return value.replace(/[\r\n]/g, "");
}
