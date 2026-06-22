import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { sourceRange } from "../../core/source-map";
import type { SourceSlice } from "../../core/types";

interface LogicalLine {
    text: string;
    start: number;
    end: number;
}

export function tryParseFootnoteDefinition(
    logicalLines: readonly LogicalLine[],
    startLine: number,
    markdown: string,
    sourceSlices: SourceSlice[],
    schema: Schema,
    parseInline: (text: string, schema: Schema) => ProseMirrorNode[],
) {
    const line = logicalLines[startLine];
    const match = (line?.text ?? "").match(/^\[\^([^\]]+)\]:[ \t]*(.*)$/);
    if (!line || !match || !schema.nodes.footnote_definition) {
        return null;
    }

    const contentLines = [match[2]];
    let endLine = startLine;

    while (endLine + 1 < logicalLines.length) {
        const nextLine = logicalLines[endLine + 1];
        if (!nextLine || nextLine.text.trim() === "") {
            break;
        }

        if (!/^[ \t]+/.test(nextLine.text)) {
            break;
        }

        contentLines.push(stripFootnoteContinuationIndent(nextLine.text));
        endLine += 1;
    }

    const sourceId = addSlice(
        sourceSlices,
        markdown,
        line.start,
        logicalLines[endLine]?.end ?? line.end,
    );
    const content = contentLines.map((contentLine) =>
        schema.nodes.paragraph.create(
            { sourceId: null },
            parseInline(contentLine, schema),
        ),
    );

    return {
        node: schema.nodes.footnote_definition.create(
            { label: match[1], sourceId },
            content,
        ),
        nextCursor: endLine + 1,
    };
}

export function stripFootnoteContinuationIndent(text: string) {
    if (text.startsWith("\t")) {
        return text.slice(1);
    }

    return text.replace(/^ {1,4}/, "");
}

export function tryParseFootnoteRef(text: string, startIndex: number) {
    if (!text.startsWith("[^", startIndex)) {
        return null;
    }

    const labelEnd = findUnescaped(text, "]", startIndex + 2);
    if (labelEnd < 0) {
        return null;
    }

    const rawLabel = text.slice(startIndex + 2, labelEnd);
    if (rawLabel.length === 0) {
        return null;
    }

    return {
        label: decodeEscapes(rawLabel),
        nextIndex: labelEnd + 1,
    };
}

function addSlice(
    sourceSlices: SourceSlice[],
    markdown: string,
    start: number,
    end: number,
) {
    const id = `source-${sourceSlices.length}`;
    sourceSlices.push({
        id,
        range: sourceRange(start, end),
        text: markdown.slice(start, end),
    });
    return id;
}

function findUnescaped(
    text: string,
    target: string,
    startIndex = 0,
) {
    for (let index = startIndex; index < text.length; index += 1) {
        if (text[index] === "\\" && index + 1 < text.length) {
            index += 1;
            continue;
        }

        if (text[index] === target) {
            return index;
        }
    }

    return -1;
}

function decodeEscapes(text: string) {
    return text.replace(/\\(.)/g, "$1");
}
