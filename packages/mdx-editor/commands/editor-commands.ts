import { setBlockType, toggleMark } from "prosemirror-commands";
import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import {
    NodeSelection,
    Selection,
    TextSelection,
    type Command,
    type EditorState,
} from "prosemirror-state";
import type { DocumentSelectionRange } from "../core/types";

export const MAX_TABLE_DIMENSION = 100;

interface TaskItemPosition {
    node: ProseMirrorNode;
    pos: number;
}

export const toggleStrongMark: Command = toggleMarkByName("strong");
export const toggleEmphasisMark: Command = toggleMarkByName("emphasis");
export const toggleStrikeMark: Command = toggleMarkByName("strike");
export const toggleInlineCodeMark: Command = toggleMarkByName("inline_code");

export function insertImageNode(
    url: string,
    altText = "",
    title?: string,
    selectionRange?: DocumentSelectionRange | null,
): Command {
    return (state, dispatch) => {
        const image = state.schema.nodes.image;
        if (!image) {
            return false;
        }

        if (dispatch) {
            let transaction = state.tr;
            if (selectionRange) {
                transaction = transaction.setSelection(
                    selectionFromDocumentRange(transaction.doc, selectionRange),
                );
            }

            dispatch(
                transaction
                    .replaceSelectionWith(
                        image.create({
                            alt: altText,
                            src: url,
                            title: title ?? null,
                        }),
                        false,
                    )
                    .scrollIntoView(),
            );
        }

        return true;
    };
}

export function setHeadingBlock(level: 1 | 2 | 3 | 4 | 5 | 6): Command {
    return (state, dispatch, view) => {
        const heading = state.schema.nodes.heading;

        if (!heading) {
            return false;
        }

        return setBlockType(heading, { level })(state, dispatch, view);
    };
}

export function insertTableMarkdown(rows: number, columns: number): string {
    const rowCount = tableDimension(rows);
    const columnCount = tableDimension(columns);
    const emptyRow = tableRow(columnCount, "  ");
    const separatorRow = tableRow(columnCount, "---");

    return [
        emptyRow,
        separatorRow,
        ...Array.from({ length: rowCount }, () => emptyRow),
    ].join("\n") + "\n";
}

export function insertMermaidMarkdown(code = "graph TD\n    A-->B"): string {
    return fencedMarkdown("mermaid", code);
}

export function insertMathBlockMarkdown(latex = ""): string {
    return `$$\n${ensureTrailingNewline(latex)}$$\n`;
}

export const toggleTaskItemChecked: Command = (state, dispatch) => {
    const taskItem = selectedTaskItem(state) ?? activeTaskItem(state);

    if (!taskItem) {
        return false;
    }

    if (dispatch) {
        const { node, pos } = taskItem;
        dispatch(
            state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                checked: !node.attrs.checked,
            }),
        );
    }

    return true;
};

export function insertPlainTextMarkdown(
    markdown: string,
    offset: number,
    text: string,
): string {
    const cursor = Math.max(0, Math.min(offset, markdown.length));

    return `${markdown.slice(0, cursor)}${text}${markdown.slice(cursor)}`;
}

export function insertImageMarkdown(
    markdown: string,
    offset: number,
    url: string,
    altText = "",
): string {
    return insertPlainTextMarkdown(
        markdown,
        offset,
        `![${escapeImageAlt(altText)}](${escapeImageUrl(url)})`,
    );
}

function escapeImageAlt(text: string): string {
    return text
        .replaceAll("\\", "\\\\")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
}

function escapeImageUrl(url: string): string {
    return url.replaceAll("\\", "\\\\").replaceAll(")", "\\)");
}

function selectionFromDocumentRange(
    doc: EditorState["doc"],
    selectionRange: DocumentSelectionRange,
) {
    const anchor = clampPosition(selectionRange.anchor, doc);
    const head = clampPosition(selectionRange.head, doc);

    try {
        return TextSelection.create(doc, anchor, head);
    } catch {
        return Selection.near(doc.resolve(anchor), 1);
    }
}

function clampPosition(position: number, doc: EditorState["doc"]) {
    return Math.max(0, Math.min(position, doc.content.size));
}

function toggleMarkByName(markName: string): Command {
    return (state, dispatch, view) => {
        const mark = state.schema.marks[markName];

        if (!mark) {
            return false;
        }

        return toggleMark(mark)(state, dispatch, view);
    };
}

function tableDimension(value: number): number {
    return Math.min(
        MAX_TABLE_DIMENSION,
        Math.max(1, Math.floor(Number.isFinite(value) ? value : 1)),
    );
}

function tableRow(columns: number, cell: string): string {
    return `|${Array.from({ length: columns }, () => cell).join("|")}|`;
}

function fencedMarkdown(language: string, code: string): string {
    return `\`\`\`${language}\n${ensureTrailingNewline(code)}\`\`\`\n`;
}

function ensureTrailingNewline(text: string): string {
    return text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
}

function selectedTaskItem(state: EditorState): TaskItemPosition | null {
    const { selection } = state;

    if (
        selection instanceof NodeSelection &&
        selection.node.type.name === "task_item"
    ) {
        return { node: selection.node, pos: selection.from };
    }

    return null;
}

function activeTaskItem(state: EditorState): TaskItemPosition | null {
    const { $from, $to } = state.selection;
    const fromTaskItem = taskItemAncestor($from);

    if (!fromTaskItem) {
        return null;
    }

    const toTaskItem = taskItemAncestor($to);

    if (!toTaskItem || fromTaskItem.pos !== toTaskItem.pos) {
        return null;
    }

    return fromTaskItem;
}

function taskItemAncestor($pos: ResolvedPos): TaskItemPosition | null {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);

        if (node.type.name === "task_item") {
            return { node, pos: $pos.before(depth) };
        }
    }

    return null;
}
