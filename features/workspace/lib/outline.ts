import type { MarkdownOutlineHeading } from "./types";

export function parseMarkdownOutline(markdown: string): MarkdownOutlineHeading[] {
    const headings: MarkdownOutlineHeading[] = [];
    const slugCounts = new Map<string, number>();
    let fence: { char: "`" | "~"; length: number } | null = null;

    markdown.split(/\r?\n/).forEach((line, index) => {
        if (fence) {
            if (isClosingFence(line, fence)) {
                fence = null;
            }

            return;
        }

        const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

        if (fenceMatch) {
            fence = {
                char: fenceMatch[1][0] as "`" | "~",
                length: fenceMatch[1].length,
            };
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

function isClosingFence(
    line: string,
    fence: { char: "`" | "~"; length: number },
) {
    const pattern = new RegExp(
        `^ {0,3}${escapeForRegExp(fence.char)}{${fence.length},}[ \\t]*$`,
    );

    return pattern.test(line);
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

function escapeForRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
