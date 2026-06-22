import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { serializeFootnoteRef } from "../syntax/footnote/serialize";

const WIKILINK_HREF_PREFIX = "mdx-wikilink:";

type NodeSerializer = (node: ProseMirrorNode) => string;

export interface InlineSerializerOptions {
    nodeSerializers?: Record<string, NodeSerializer>;
}

export function serializeInlineContent(
    node: ProseMirrorNode,
    options: InlineSerializerOptions = {},
): string {
    let output = "";
    let index = 0;

    while (index < node.childCount) {
        const child = node.child(index);
        const link = findLinkMark(child);
        if (link) {
            const serializedRun = serializeInlineRun(
                node,
                index,
                (candidate) =>
                    linkMarksEquivalent(link, findLinkMark(candidate)),
                link,
                options,
            );
            output += serializeLinkedText(serializedRun.serialized, link);
            index = serializedRun.nextIndex;
            continue;
        }

        const serializedRun = serializeTextRun(
            node,
            index,
            (candidate) => {
                return findLinkMark(candidate) === null;
            },
            undefined,
            options,
        );
        output += serializedRun.serialized;
        index = serializedRun.nextIndex;
    }

    return output;
}

function serializeInlineNode(
    node: ProseMirrorNode,
    options: InlineSerializerOptions,
) {
    const serializer = options.nodeSerializers?.[node.type.name];
    if (serializer) {
        return serializer(node);
    }

    switch (node.type.name) {
        case "image":
            return serializeImageNode(node);
        case "math_inline":
            return `$${escapeMathInline(String(node.attrs.latex ?? ""))}$`;
        case "footnote_ref":
            return serializeFootnoteRef(node);
        default:
            return node.textContent;
    }
}

function serializeTextRun(
    node: ProseMirrorNode,
    startIndex: number,
    predicate: (candidate: ProseMirrorNode) => boolean,
    excludedMark?: Mark,
    options: InlineSerializerOptions = {},
) {
    return serializeInlineRun(
        node,
        startIndex,
        predicate,
        excludedMark,
        options,
    );
}

function serializeInlineRun(
    node: ProseMirrorNode,
    startIndex: number,
    predicate: (candidate: ProseMirrorNode) => boolean,
    excludedMark?: Mark,
    options: InlineSerializerOptions = {},
) {
    let serialized = "";
    const activeMarks: Mark[] = [];
    let nextIndex = startIndex;

    while (nextIndex < node.childCount) {
        const child = node.child(nextIndex);
        if (!predicate(child)) {
            break;
        }

        const marks = excludedMark
            ? child.marks.filter((mark) => mark !== excludedMark)
            : [...child.marks];
        const activeChildMarks = marks.filter(
            (mark) => mark.type.name !== "inline_code",
        );
        const sharedPrefixLength = sharedMarkPrefixLength(
            activeMarks,
            activeChildMarks,
        );

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
            markIndex < activeChildMarks.length;
            markIndex += 1
        ) {
            serialized += openMark(activeChildMarks[markIndex]);
            activeMarks.push(activeChildMarks[markIndex]);
        }

        if (child.isText) {
            serialized += shouldSerializeAsCodeText(marks)
                ? serializeInlineCodeText(child.text ?? "")
                : escapePlainText(child.text ?? "");
        } else {
            serialized += serializeInlineNode(child, options);
        }
        nextIndex += 1;
    }

    for (
        let markIndex = activeMarks.length - 1;
        markIndex >= 0;
        markIndex -= 1
    ) {
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
        case "kbd":
            return "<kbd>";
        default:
            return "";
    }
}

function closeMark(mark: Mark) {
    if (mark.type.name === "kbd") {
        return "</kbd>";
    }

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
        separatorIndex >= 0
            ? originalPayload.slice(separatorIndex + 1)
            : target;

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
    return title.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeLinkHref(href: string) {
    if (/\s/.test(href)) {
        return `<${href.replaceAll("\\", "\\\\").replaceAll(">", "\\>")}>`;
    }

    return href.replaceAll("\\", "\\\\").replaceAll(")", "\\)");
}

function escapePlainText(text: string) {
    let escaped = "";

    for (const char of text) {
        if ("\\*~`$".includes(char)) {
            escaped += `\\${char}`;
        } else {
            escaped += char;
        }
    }

    return escaped;
}

function serializeInlineCodeText(text: string) {
    const longestBacktickRun =
        text.match(/`+/g)?.reduce((longest, run) => {
            return Math.max(longest, run.length);
        }, 0) ?? 0;
    const delimiter = "`".repeat(longestBacktickRun + 1);
    const needsBoundaryPadding = text.startsWith("`") || text.endsWith("`");

    return needsBoundaryPadding
        ? `${delimiter} ${text} ${delimiter}`
        : `${delimiter}${text}${delimiter}`;
}

function escapeWikilinkSegment(segment: string) {
    return segment.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function escapeMathInline(latex: string) {
    return latex.replaceAll("\\", "\\\\").replaceAll("$", "\\$");
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
