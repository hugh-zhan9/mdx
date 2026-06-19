import {
    InputRule,
    inputRules,
    textblockTypeInputRule,
    wrappingInputRule,
} from "prosemirror-inputrules";
import { TextSelection } from "prosemirror-state";
import type {
    Node as ProseMirrorNode,
    ResolvedPos,
    Schema,
} from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";

interface ListItemPosition {
    node: ProseMirrorNode;
    pos: number;
}

export function markdownInputRules(schema: Schema = mdxEditorSchema): InputRule[] {
    const rules: InputRule[] = [];
    const {
        blockquote,
        bullet_list: bulletList,
        code_block: codeBlock,
        heading,
        ordered_list: orderedList,
    } = schema.nodes;

    if (heading) {
        rules.push(
            textblockTypeInputRule(/^#{1,6}\s$/, heading, (match) => ({
                level: match[0].trim().length,
            })),
        );
    }

    if (bulletList) {
        rules.push(taskListInputRule(schema));
        rules.push(wrappingInputRule(/^\s*([-+*])\s$/, bulletList));
        rules.push(taskItemMarkerInputRule(schema));
    }

    if (orderedList) {
        rules.push(
            wrappingInputRule(/^(\d+)\.\s$/, orderedList, (match) => ({
                order: Number(match[1]),
            })),
        );
    }

    if (blockquote) {
        rules.push(wrappingInputRule(/^\s*>\s$/, blockquote));
    }

    if (codeBlock) {
        rules.push(
            textblockTypeInputRule(/^```([A-Za-z0-9_-]+)?\s$/, codeBlock, (match) => ({
                info: match[1] ?? "",
                language: match[1] ?? "",
            })),
        );
    }

    rules.push(new InputRule(/^\|(?:[^|]*\|)+\s$/, () => null));

    return rules;
}

export function markdownInputRulesPlugin(schema: Schema = mdxEditorSchema) {
    return inputRules({ rules: markdownInputRules(schema) });
}

function taskListInputRule(schema: Schema): InputRule {
    return new InputRule(
        /^\s*([-+*])\s+(?:\[ \]|\[([xX])\])\s$/,
        (state, match, start, end) => {
            const { bullet_list: bulletList, paragraph, task_item: taskItem } =
                schema.nodes;

            if (!bulletList || !paragraph || !taskItem) {
                return null;
            }

            const $start = state.doc.resolve(start);

            if (!$start.parent.type.isTextblock) {
                return null;
            }

            const blockStart = $start.before();
            const blockEnd = $start.after();
            const tr = state.tr.delete(start, end);
            const mappedBlockStart = tr.mapping.map(blockStart);
            const mappedBlockEnd = tr.mapping.map(blockEnd);
            const taskParagraph = paragraph.create(
                null,
                tr.doc.resolve(mappedBlockStart + 1).parent.content,
            );
            const taskNode = taskItem.create(
                { checked: Boolean(match[2]) },
                taskParagraph,
            );
            const listNode = bulletList.create(null, taskNode);

            tr.replaceWith(mappedBlockStart, mappedBlockEnd, listNode);
            tr.setSelection(
                TextSelection.near(tr.doc.resolve(mappedBlockStart + 3)),
            );

            return tr;
        },
    );
}

function taskItemMarkerInputRule(schema: Schema): InputRule {
    return new InputRule(
        /^(?:\[ \]|\[([xX])\])\s$/,
        (state, match, start, end) => {
            const { task_item: taskItem } = schema.nodes;

            if (!taskItem) {
                return null;
            }

            const listItem = listItemAncestor(state.doc.resolve(start));

            if (!listItem || listItem.node.type.name !== "list_item") {
                return null;
            }

            const tr = state.tr.delete(start, end);
            const mappedListItemPos = tr.mapping.map(listItem.pos);

            tr.setNodeMarkup(mappedListItemPos, taskItem, {
                ...listItem.node.attrs,
                checked: Boolean(match[1]),
            });
            tr.setSelection(
                TextSelection.near(tr.doc.resolve(mappedListItemPos + 2)),
            );

            return tr;
        },
    );
}

function listItemAncestor($pos: ResolvedPos): ListItemPosition | null {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);

        if (node.type.name === "list_item" || node.type.name === "task_item") {
            return { node, pos: $pos.before(depth) };
        }
    }

    return null;
}
