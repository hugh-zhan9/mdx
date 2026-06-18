import { setBlockType, toggleMark } from "prosemirror-commands";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";

interface TaskItemPosition {
    node: ProseMirrorNode;
    pos: number;
}

export const toggleStrongMark: Command = toggleMarkByName("strong");
export const toggleEmphasisMark: Command = toggleMarkByName("emphasis");
export const toggleStrikeMark: Command = toggleMarkByName("strike");
export const toggleInlineCodeMark: Command = toggleMarkByName("inline_code");

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
    const rowCount = positiveInteger(rows);
    const columnCount = positiveInteger(columns);
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
    const taskItem = closestTaskItem(state);

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

function toggleMarkByName(markName: string): Command {
    return (state, dispatch, view) => {
        const mark = state.schema.marks[markName];

        if (!mark) {
            return false;
        }

        return toggleMark(mark)(state, dispatch, view);
    };
}

function positiveInteger(value: number): number {
    return Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
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

function closestTaskItem(state: EditorState): TaskItemPosition | null {
    const { $from } = state.selection;

    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);

        if (node.type.name === "task_item") {
            return { node, pos: $from.before(depth) };
        }
    }

    return firstTaskItemInSelection(state);
}

function firstTaskItemInSelection(state: EditorState): TaskItemPosition | null {
    let taskItem: TaskItemPosition | null = null;

    state.doc.nodesBetween(
        state.selection.from,
        state.selection.to,
        (node, pos) => {
            if (node.type.name !== "task_item") {
                return true;
            }

            taskItem = { node, pos };

            return false;
        },
    );

    return taskItem;
}
