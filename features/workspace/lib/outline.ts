import type { MarkdownOutlineHeading } from "./types";

export function parseMarkdownOutline(markdown: string): MarkdownOutlineHeading[] {
    const headings: MarkdownOutlineHeading[] = [];
    const slugCounts = new Map<string, number>();
    let inFence = false;

    markdown.split(/\r?\n/).forEach((line, index) => {
        if (inFence) {
            if (isClosingFence(line)) {
                inFence = false;
            }

            return;
        }

        if (line.startsWith("```")) {
            inFence = true;
            return;
        }

        const headingMatch = line.match(/^(#{1,6})[ \t]+(.+?)\s*$/);

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

function isClosingFence(line: string) {
    return line.startsWith("```");
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
