import type { Node as ProseMirrorNode } from "prosemirror-model";
import { serializeInlineContent } from "./inline-serializer";

type NodeSerializer = (node: ProseMirrorNode) => string;

export interface BlockSerializerOptions {
    nodeSerializers?: Record<string, NodeSerializer>;
    serializeInline?: (node: ProseMirrorNode) => string;
    serializeNode?: (node: ProseMirrorNode) => string;
}

export function serializeBlockNode(
    node: ProseMirrorNode,
    options: BlockSerializerOptions = {},
): string {
    const serializer = options.nodeSerializers?.[node.type.name];
    if (serializer) {
        return serializer(node);
    }

    const serializeInline =
        options.serializeInline ??
        ((value: ProseMirrorNode) =>
            serializeInlineContent(value, {
                nodeSerializers: options.nodeSerializers,
            }));
    const serializeNode =
        options.serializeNode ??
        ((value: ProseMirrorNode) =>
            serializeBlockNode(value, {
                ...options,
                serializeInline,
            }));

    switch (node.type.name) {
        case "heading":
            return `${"#".repeat(headingLevel(node))} ${serializeInline(node)}\n`;
        case "paragraph":
            return `${escapeParagraphLineStarts(serializeInline(node))}\n`;
        case "bullet_list":
            return serializeList(node, "-", serializeNode, serializeInline);
        case "ordered_list":
            return serializeOrderedList(node, serializeNode, serializeInline);
        case "list_item":
            return serializeListItem(node, "-", serializeNode, serializeInline);
        case "task_item":
            return serializeTaskItem(node, serializeNode, serializeInline);
        case "blockquote":
            return serializeBlockquote(node, serializeNode);
        case "horizontal_rule":
            return "---\n";
        case "table":
            return serializeTable(node, serializeInline);
        case "table_row":
            return serializeTableRow(node, serializeInline);
        case "table_cell":
        case "table_header":
            return `${serializeInline(node)}\n`;
        case "callout":
            return serializeCallout(node, serializeNode);
        case "math_block":
            return `$$\n${textBeforeClosingFence(node.textContent)}$$\n`;
        case "footnote_definition":
            return serializeFootnoteDefinition(node, serializeNode, serializeInline);
        case "mermaid_block":
            return `\`\`\`${mermaidBlockInfo(node)}\n${textBeforeClosingFence(node.textContent)}\`\`\`\n`;
        case "code_block":
            return `\`\`\`${codeBlockInfo(node)}\n${textBeforeClosingFence(node.textContent)}\`\`\`\n`;
        case "frontmatter":
            return `---\n${textBeforeClosingFence(node.textContent)}---\n`;
        case "html_block":
            return String(node.attrs.html ?? node.textContent ?? "");
        case "source_fallback":
            return String(node.attrs.markdown ?? "");
        case "opaque_block":
            return ensureTrailingNewline(node.textContent);
        default:
            return ensureTrailingNewline(node.textContent);
    }
}

function serializeList(
    node: ProseMirrorNode,
    marker: string,
    serializeNode: (node: ProseMirrorNode) => string,
    serializeInline: (node: ProseMirrorNode) => string,
) {
    let output = "";

    node.forEach((child) => {
        output +=
            child.type.name === "task_item"
                ? serializeTaskItem(child, serializeNode, serializeInline)
                : serializeListItem(child, marker, serializeNode, serializeInline);
    });

    return output;
}

function serializeOrderedList(
    node: ProseMirrorNode,
    serializeNode: (node: ProseMirrorNode) => string,
    serializeInline: (node: ProseMirrorNode) => string,
) {
    let output = "";
    let order = typeof node.attrs.order === "number" ? node.attrs.order : 1;

    node.forEach((child) => {
        output += serializeListItem(
            child,
            `${order}.`,
            serializeNode,
            serializeInline,
        );
        order += 1;
    });

    return output;
}

function serializeTaskItem(
    node: ProseMirrorNode,
    serializeNode: (node: ProseMirrorNode) => string,
    serializeInline: (node: ProseMirrorNode) => string,
) {
    return serializeListItem(
        node,
        node.attrs.checked ? "- [x]" : "- [ ]",
        serializeNode,
        serializeInline,
    );
}

function serializeListItem(
    node: ProseMirrorNode,
    marker: string,
    serializeNode: (node: ProseMirrorNode) => string,
    serializeInline: (node: ProseMirrorNode) => string,
) {
    const firstChild = node.firstChild;
    if (!firstChild) {
        return `${marker}\n`;
    }

    const firstLine =
        firstChild.type.name === "paragraph"
            ? serializeInline(firstChild)
            : serializeNestedBlock(firstChild, serializeNode);
    const firstLines = firstLine.split("\n");
    const lines = [`${marker} ${firstLines[0] ?? ""}`];

    for (const line of firstLines.slice(1)) {
        lines.push(line.length > 0 ? `  ${line}` : "");
    }

    for (let index = 1; index < node.childCount; index += 1) {
        const childText = serializeNestedBlock(node.child(index), serializeNode);
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `  ${line}` : "");
        }
    }

    return `${lines.join("\n")}\n`;
}

function serializeBlockquote(
    node: ProseMirrorNode,
    serializeNode: (node: ProseMirrorNode) => string,
) {
    const lines: string[] = [];

    node.forEach((child) => {
        const childText = serializeNestedBlock(child, serializeNode);
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `> ${line}` : ">");
        }
    });

    return `${lines.join("\n")}\n`;
}

function serializeTable(
    node: ProseMirrorNode,
    serializeInline: (node: ProseMirrorNode) => string,
) {
    let output = "";

    node.forEach((row, _offset, index) => {
        output += serializeTableRow(row, serializeInline);
        if (index === 0 && tableRowHasHeader(row)) {
            output += serializeTableSeparator(row, node.attrs.alignments);
        }
    });

    return output;
}

function serializeTableRow(
    node: ProseMirrorNode,
    serializeInline: (node: ProseMirrorNode) => string,
) {
    const cells: string[] = [];

    node.forEach((cell) => {
        cells.push(escapeTableCellPipes(serializeInline(cell)));
    });

    return `| ${cells.join(" | ")} |\n`;
}

function escapeTableCellPipes(markdown: string) {
    let output = "";

    for (let index = 0; index < markdown.length;) {
        const protectedInline = readProtectedInlineSpan(markdown, index);
        if (protectedInline) {
            output += protectedInline.value;
            index = protectedInline.nextIndex;
            continue;
        }

        const char = markdown[index];
        if (char === "\\" && index + 1 < markdown.length) {
            output += char + markdown[index + 1];
            index += 2;
            continue;
        }

        output += char === "|" ? "\\|" : char;
        index += 1;
    }

    return output;
}

function readProtectedInlineSpan(text: string, startIndex: number) {
    const codeSpan = readCodeSpan(text, startIndex);
    if (codeSpan) {
        return codeSpan;
    }

    const wikilink = readUntilUnescapedToken(text, startIndex, "[[", "]]");
    if (wikilink) {
        return wikilink;
    }

    const markdownLink = readMarkdownLinkOrImage(text, startIndex);
    if (markdownLink) {
        return markdownLink;
    }

    const inlineMath = readUntilUnescapedToken(text, startIndex, "$", "$");
    if (inlineMath) {
        return inlineMath;
    }

    return null;
}

function readCodeSpan(text: string, startIndex: number) {
    if (text[startIndex] !== "`") {
        return null;
    }

    let delimiterLength = 0;
    while (text[startIndex + delimiterLength] === "`") {
        delimiterLength += 1;
    }

    const delimiter = "`".repeat(delimiterLength);
    const closeIndex = text.indexOf(delimiter, startIndex + delimiterLength);
    if (closeIndex < 0) {
        return null;
    }

    const nextIndex = closeIndex + delimiterLength;
    return {
        value: text.slice(startIndex, nextIndex),
        nextIndex,
    };
}

function readMarkdownLinkOrImage(text: string, startIndex: number) {
    const labelStart =
        text[startIndex] === "!" && text[startIndex + 1] === "["
            ? startIndex + 1
            : startIndex;
    if (text[labelStart] !== "[" || text[labelStart + 1] === "[") {
        return null;
    }

    const labelEnd = findUnescapedToken(text, "]", labelStart + 1);
    if (labelEnd < 0) {
        return null;
    }

    let nextIndex = labelEnd + 1;
    if (text[nextIndex] === "(") {
        const targetEnd = findUnescapedToken(text, ")", nextIndex + 1);
        if (targetEnd >= 0) {
            nextIndex = targetEnd + 1;
        }
    }

    return {
        value: text.slice(startIndex, nextIndex),
        nextIndex,
    };
}

function readUntilUnescapedToken(
    text: string,
    startIndex: number,
    opener: string,
    closer: string,
) {
    if (!text.startsWith(opener, startIndex)) {
        return null;
    }

    const closeIndex = findUnescapedToken(text, closer, startIndex + opener.length);
    if (closeIndex < 0) {
        return null;
    }

    const nextIndex = closeIndex + closer.length;
    return {
        value: text.slice(startIndex, nextIndex),
        nextIndex,
    };
}

function findUnescapedToken(text: string, token: string, startIndex: number) {
    for (let index = startIndex; index <= text.length - token.length; index += 1) {
        if (text[index] === "\\") {
            index += 1;
            continue;
        }

        if (text.startsWith(token, index)) {
            return index;
        }
    }

    return -1;
}

function serializeTableSeparator(row: ProseMirrorNode, alignments: unknown) {
    const alignmentValues = Array.isArray(alignments) ? alignments : [];
    const cells: string[] = [];

    row.forEach((_cell, _offset, index) => {
        const alignment = alignmentValues[index];
        switch (alignment) {
            case "left":
                cells.push(":---");
                break;
            case "right":
                cells.push("---:");
                break;
            case "center":
                cells.push(":---:");
                break;
            default:
                cells.push("---");
                break;
        }
    });

    return `|${cells.join("|")}|\n`;
}

function tableRowHasHeader(row: ProseMirrorNode) {
    for (let index = 0; index < row.childCount; index += 1) {
        if (row.child(index).type.name === "table_header") {
            return true;
        }
    }

    return false;
}

function serializeCallout(
    node: ProseMirrorNode,
    serializeNode: (node: ProseMirrorNode) => string,
) {
    const title =
        typeof node.attrs.title === "string" && node.attrs.title.length > 0
            ? ` ${node.attrs.title}`
            : "";
    const lines = [`> [!${String(node.attrs.kind ?? "NOTE")}]${title}`];

    node.forEach((child) => {
        const childText = serializeNestedBlock(child, serializeNode);
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `> ${line}` : ">");
        }
    });

    return `${lines.join("\n")}\n`;
}

function serializeFootnoteDefinition(
    node: ProseMirrorNode,
    serializeNode: (node: ProseMirrorNode) => string,
    serializeInline: (node: ProseMirrorNode) => string,
) {
    const label = String(node.attrs.label ?? "");
    const firstChild = node.firstChild;
    if (!firstChild) {
        return `[^${label}]:\n`;
    }

    const firstLine =
        firstChild.type.name === "paragraph"
            ? serializeInline(firstChild)
            : serializeNestedBlock(firstChild, serializeNode);
    const lines = [`[^${label}]: ${firstLine}`];

    for (let index = 1; index < node.childCount; index += 1) {
        const childText = serializeNestedBlock(node.child(index), serializeNode);
        for (const line of childText.split("\n")) {
            lines.push(line.length > 0 ? `    ${line}` : "");
        }
    }

    return `${lines.join("\n")}\n`;
}

function serializeNestedBlock(
    node: ProseMirrorNode,
    serializeNode: (node: ProseMirrorNode) => string,
) {
    return serializeNode(node).replace(/\n$/, "");
}

function escapeParagraphLineStarts(text: string) {
    return text
        .split("\n")
        .map((line) => {
            if (startsWithInlineCodeSpan(line)) {
                return line;
            }

            return line.replace(blockStartMarkerPattern(), "\\$1");
        })
        .join("\n");
}

function blockStartMarkerPattern() {
    return /^(#{1,6}(?:\s|$)|\d+\.\s|(?:[-*_][ \t]*){3,}$|[-*+](?:\s|$)|[-*+]\s+\[[ xX]\]\s|>(?:\s|$)|```|\|(?=.*\|))/;
}

function startsWithInlineCodeSpan(line: string) {
    if (line[0] !== "`") {
        return false;
    }

    let delimiterLength = 0;
    while (line[delimiterLength] === "`") {
        delimiterLength += 1;
    }

    const delimiter = "`".repeat(delimiterLength);

    return line.indexOf(delimiter, delimiterLength) >= delimiterLength;
}

function headingLevel(node: ProseMirrorNode) {
    const level = node.attrs.level;

    return typeof level === "number" && level >= 1 && level <= 6 ? level : 1;
}

function codeBlockInfo(node: ProseMirrorNode) {
    const info = node.attrs.info;
    const language = node.attrs.language;

    if (typeof info === "string" && info.length > 0) {
        return info;
    }

    return typeof language === "string" ? language : "";
}

function mermaidBlockInfo(node: ProseMirrorNode) {
    const info = node.attrs.info;

    return typeof info === "string" && info.length > 0 ? info : "mermaid";
}

function textBeforeClosingFence(text: string) {
    return text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
}

function ensureTrailingNewline(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}
