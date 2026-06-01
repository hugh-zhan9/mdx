import type { MarkdownOutlineHeading } from "./types";

export function parseMarkdownOutline(markdown: string): MarkdownOutlineHeading[] {
    const headings: MarkdownOutlineHeading[] = [];
    const slugCounts = new Map<string, number>();
    let inFence = false;
    let fenceMarker: string | null = null;

    markdown.split(/\r?\n/).forEach((line, index) => {
        const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);

        if (fenceMatch) {
            const marker = fenceMatch[1][0];

            if (!inFence) {
                inFence = true;
                fenceMarker = marker;
            } else if (fenceMarker === marker) {
                inFence = false;
                fenceMarker = null;
            }

            return;
        }

        if (inFence) {
            return;
        }

        const headingMatch = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*$/);

        if (!headingMatch) {
            return;
        }

        const text = headingMatch[2].replace(/[ \t]+#+[ \t]*$/, "").trim();

        if (text.length === 0) {
            return;
        }

        headings.push({
            id: createHeadingId(text, slugCounts),
            level: headingMatch[1].length as MarkdownOutlineHeading["level"],
            text,
            line: index + 1,
        });
    });

    return headings;
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
