import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";

const WIKILINK_HREF_PREFIX = "mdx-wikilink:";

export function serializeInlineContent(node: ProseMirrorNode): string {
    let output = "";
    let index = 0;

    while (index < node.childCount) {
        const child = node.child(index);
        if (!child.isText) {
            output += serializeInlineNode(child);
            index += 1;
            continue;
        }

        const link = findLinkMark(child);
        if (!link) {
            const serializedRun = serializeTextRun(node, index, (candidate) => {
                return candidate.isText && findLinkMark(candidate) === null;
            });
            output += serializedRun.serialized;
            index = serializedRun.nextIndex;
            continue;
        }

        const serializedRun = serializeTextRun(
            node,
            index,
            (candidate) => {
                return (
                    candidate.isText &&
                    linkMarksEquivalent(link, findLinkMark(candidate))
                );
            },
            link,
        );
        output += serializeLinkedText(serializedRun.serialized, link);
        index = serializedRun.nextIndex;
    }

    return output;
}

function serializeInlineNode(node: ProseMirrorNode) {
    switch (node.type.name) {
        case "image":
            return serializeImageNode(node);
        case "math_inline":
            return `$${escapeMathInline(String(node.attrs.latex ?? ""))}$`;
        case "footnote_ref":
            return `[^${escapeFootnoteLabel(String(node.attrs.label ?? ""))}]`;
        default:
            return node.textContent;
    }
}

function serializeTextRun(
    node: ProseMirrorNode,
    startIndex: number,
    predicate: (candidate: ProseMirrorNode) => boolean,
    excludedMark?: Mark,
) {
    let serialized = "";
    const activeMarks: Mark[] = [];
    let nextIndex = startIndex;

    while (nextIndex < node.childCount) {
        const child = node.child(nextIndex);
        if (!child.isText || !predicate(child)) {
            break;
        }

        const marks = excludedMark
            ? child.marks.filter((mark) => mark !== excludedMark)
            : [...child.marks];
        const sharedPrefixLength = sharedMarkPrefixLength(activeMarks, marks);

        for (
            let markIndex = activeMarks.length - 1;
            markIndex >= sharedPrefixLength;
            markIndex -= 1
        ) {
            serialized += closeMark(activeMarks[markIndex]);
        }
        activeMarks.length = sharedPrefixLength;

        for (
            let markIndex = sharedPrefixLength;
            markIndex < marks.length;
            markIndex += 1
        ) {
            serialized += openMark(marks[markIndex]);
            activeMarks.push(marks[markIndex]);
        }

        serialized += shouldSerializeAsCodeText(marks)
            ? escapeInlineCodeText(child.text ?? "")
            : escapePlainText(child.text ?? "");
        nextIndex += 1;
    }

    for (let markIndex = activeMarks.length - 1; markIndex >= 0; markIndex -= 1) {
        serialized += closeMark(activeMarks[markIndex]);
    }

    return {
        serialized,
        nextIndex,
    };
}

function serializeLinkedText(text: string, link: Mark) {
    const href = String(link.attrs.href ?? "");
    if (href.startsWith(WIKILINK_HREF_PREFIX)) {
        return serializeWikilink(text, href);
    }

    const title =
        typeof link.attrs.title === "string" && link.attrs.title.length > 0
            ? ` "${escapeLinkTitle(link.attrs.title)}"`
            : "";

    return `[${text}](${escapeLinkHref(href)}${title})`;
}

function serializeImageNode(node: ProseMirrorNode) {
    const alt = escapePlainText(String(node.attrs.alt ?? ""));
    const src = escapeLinkHref(String(node.attrs.src ?? ""));
    const title =
        typeof node.attrs.title === "string" && node.attrs.title.length > 0
            ? ` "${escapeLinkTitle(node.attrs.title)}"`
            : "";

    return `![${alt}](${src}${title})`;
}

function findLinkMark(node: ProseMirrorNode) {
    return node.marks.find((mark) => mark.type.name === "link") ?? null;
}

function linkMarksEquivalent(left: Mark, right: Mark | null) {
    return (
        right !== null &&
        left.type.name === right.type.name &&
        attrsEquivalent(left.attrs, right.attrs)
    );
}

function sharedMarkPrefixLength(left: readonly Mark[], right: readonly Mark[]) {
    let index = 0;
    while (
        index < left.length &&
        index < right.length &&
        left[index] !== undefined &&
        right[index] !== undefined &&
        left[index].type.name === right[index].type.name &&
        attrsEquivalent(left[index].attrs, right[index].attrs)
    ) {
        index += 1;
    }

    return index;
}

function openMark(mark: Mark) {
    switch (mark.type.name) {
        case "strong":
            return "**";
        case "emphasis":
            return "*";
        case "strike":
            return "~~";
        case "inline_code":
            return "`";
        default:
            return "";
    }
}

function closeMark(mark: Mark) {
    return openMark(mark);
}

function shouldSerializeAsCodeText(marks: readonly Mark[]) {
    return marks.some((mark) => mark.type.name === "inline_code");
}

function serializeWikilink(text: string, href: string) {
    const originalPayload = decodeWikilinkPayload(
        href.slice(WIKILINK_HREF_PREFIX.length),
    );
    const separatorIndex = originalPayload.indexOf("|");
    const target =
        separatorIndex >= 0
            ? originalPayload.slice(0, separatorIndex)
            : originalPayload;
    const originalLabel =
        separatorIndex >= 0 ? originalPayload.slice(separatorIndex + 1) : target;

    if (text === originalLabel) {
        return separatorIndex >= 0
            ? `[[${escapeWikilinkSegment(target)}|${escapeWikilinkSegment(originalLabel)}]]`
            : `[[${escapeWikilinkSegment(originalPayload)}]]`;
    }

    if (text === target) {
        return `[[${escapeWikilinkSegment(target)}]]`;
    }

    return `[[${escapeWikilinkSegment(target)}|${text}]]`;
}

function decodeWikilinkPayload(payload: string) {
    try {
        return decodeURIComponent(payload);
    } catch {
        return payload;
    }
}

function escapeLinkTitle(title: string) {
    return title.replaceAll('"', '\\"');
}

function escapeLinkHref(href: string) {
    return href.replaceAll("\\", "\\\\").replaceAll(")", "\\)");
}

function escapePlainText(text: string) {
    return text
        .replaceAll("\\", "\\\\")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
}

function escapeInlineCodeText(text: string) {
    return text.replaceAll("`", "\\`");
}

function escapeWikilinkSegment(segment: string) {
    return segment
        .replaceAll("\\", "\\\\")
        .replaceAll("]", "\\]");
}

function escapeMathInline(latex: string) {
    return latex.replaceAll("$", "\\$");
}

function escapeFootnoteLabel(label: string) {
    return label
        .replaceAll("\\", "\\\\")
        .replaceAll("]", "\\]");
}

function attrsEquivalent(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

    keys.delete("sourceId");

    for (const key of keys) {
        if (!Object.is(left[key], right[key])) {
            return false;
        }
    }

    return true;
}
