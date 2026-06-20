const WIKILINK_URL_PREFIX = "mdx-wikilink:";
const WIKILINK_PATTERN = /\[\[([^\]\r\n]+)\]\]/g;
const EDITOR_WIKILINK_PATTERN = /\[([^\]\r\n]*)\]\(mdx-wikilink:([^)]+)\)/g;

export function renderWikilinksForEditor(markdown: string): string {
    return transformOutsideCode(markdown, renderWikilinksInSegment);
}

export function restoreWikilinksFromEditor(markdown: string): string {
    return markdown.replace(
        EDITOR_WIKILINK_PATTERN,
        (_match, _label: string, encodedTarget: string) => {
            const target = decodeWikilinkTarget(encodedTarget);

            return target ? `[[${target}]]` : _match;
        },
    );
}

export function wikilinkTargetFromEditorHref(href: string): string | null {
    if (!href.startsWith(WIKILINK_URL_PREFIX)) {
        return null;
    }

    return decodeWikilinkTarget(href.slice(WIKILINK_URL_PREFIX.length));
}

function renderWikilinksInSegment(segment: string): string {
    return segment.replace(WIKILINK_PATTERN, (match, rawTarget: string) => {
        const target = rawTarget.trim();
        if (!target) {
            return match;
        }

        const label = wikilinkLabel(target);
        return `[${label}](${WIKILINK_URL_PREFIX}${encodeWikilinkTarget(target)})`;
    });
}

function encodeWikilinkTarget(target: string): string {
    return encodeURIComponent(target).replace(/[()]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function wikilinkLabel(target: string): string {
    const label = target.split("|").at(1)?.trim();
    if (label) {
        return label;
    }

    return target.split("|")[0].split("#")[0].trim() || target;
}

function decodeWikilinkTarget(encodedTarget: string): string | null {
    try {
        const target = decodeURIComponent(encodedTarget).trim();

        return target || null;
    } catch {
        return null;
    }
}

function transformOutsideCode(
    markdown: string,
    transformSegment: (segment: string) => string,
): string {
    const lines = markdown.split(/(\r?\n)/);
    let inFence = false;
    let fenceMarker: string | null = null;
    let output = "";

    for (let index = 0; index < lines.length; index += 2) {
        const line = lines[index] ?? "";
        const lineEnding = lines[index + 1] ?? "";

        const fence = line.match(/^(`{3,}|~{3,})/);
        if (fence) {
            const marker = fence[1][0];
            if (!inFence) {
                inFence = true;
                fenceMarker = marker;
            } else if (fenceMarker === marker) {
                inFence = false;
                fenceMarker = null;
            }
            output += line + lineEnding;
            continue;
        }

        output +=
            (inFence ? line : transformInlineCodeAware(line, transformSegment)) +
            lineEnding;
    }

    return output;
}

function transformInlineCodeAware(
    line: string,
    transformSegment: (segment: string) => string,
): string {
    let output = "";
    let index = 0;

    while (index < line.length) {
        const codeStart = line.indexOf("`", index);
        if (codeStart === -1) {
            output += transformSegment(line.slice(index));
            break;
        }

        const ticks = readBacktickRun(line, codeStart);
        const codeEnd = line.indexOf(ticks, codeStart + ticks.length);
        if (codeEnd === -1) {
            output += transformSegment(line.slice(index));
            break;
        }

        output += transformSegment(line.slice(index, codeStart));
        output += line.slice(codeStart, codeEnd + ticks.length);
        index = codeEnd + ticks.length;
    }

    return output;
}

function readBacktickRun(line: string, start: number): string {
    let end = start;
    while (line[end] === "`") {
        end += 1;
    }

    return line.slice(start, end);
}
