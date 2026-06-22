import { baseKeymap, chainCommands } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import type { Schema } from "prosemirror-model";
import {
    liftListItem,
    sinkListItem,
    splitListItem,
} from "prosemirror-schema-list";
import type { Command } from "prosemirror-state";
import { canSplit } from "prosemirror-transform";
import {
    toggleEmphasisMark,
    toggleStrikeMark,
    toggleStrongMark,
} from "../commands/editor-commands";
import { mdxEditorSchema } from "../schema/schema";

export function markdownKeymap(
    schema: Schema = mdxEditorSchema,
): Record<string, Command> {
    const { list_item: listItem, task_item: taskItem } = schema.nodes;
    const splitListCommand = listItem && taskItem
        ? chainCommands(splitListItem(taskItem), splitListItem(listItem))
        : listItem
            ? splitListItem(listItem)
            : baseKeymap.Enter;
    const liftListCommand = listItem && taskItem
        ? chainCommands(liftListItem(taskItem), liftListItem(listItem))
        : listItem
            ? liftListItem(listItem)
            : baseKeymap.Backspace;
    const sinkListCommand = listItem && taskItem
        ? chainCommands(sinkListItem(taskItem), sinkListItem(listItem))
        : listItem
            ? sinkListItem(listItem)
            : () => false;

    return {
        "Mod-b": toggleStrongMark,
        "Mod-i": toggleEmphasisMark,
        "Mod-Shift-x": toggleStrikeMark,
        "Mod-z": undo,
        "Mod-y": redo,
        "Shift-Mod-z": redo,
        Enter: chainCommands(
            exitHeadingAtEndCommand,
            splitListCommand,
            baseKeymap.Enter,
        ),
        Backspace: chainCommands(
            removeStyledTextBlockAtStartCommand,
            liftListCommand,
            baseKeymap.Backspace,
        ),
        Delete: removeStyledTextBlockAtStartCommand,
        Tab: sinkListCommand,
        "Shift-Tab": liftListCommand,
    };
}

const exitHeadingAtEndCommand: Command = (state, dispatch) => {
    const { $from, empty } = state.selection;
    const paragraph = state.schema.nodes.paragraph;

    if (
        !empty ||
        !paragraph ||
        $from.parent.type.name !== "heading" ||
        $from.parentOffset !== $from.parent.content.size
    ) {
        return false;
    }

    const typesAfter = [{ type: paragraph, attrs: { sourceId: null } }];

    if (!canSplit(state.doc, $from.pos, 1, typesAfter)) {
        return false;
    }

    dispatch?.(
        state.tr
            .split($from.pos, 1, typesAfter)
            .scrollIntoView(),
    );
    return true;
};

const removeStyledTextBlockAtStartCommand: Command = (state, dispatch) => {
    const { $from, empty } = state.selection;
    const paragraph = state.schema.nodes.paragraph;

    if (
        !empty ||
        !paragraph ||
        !removableTextBlockTypes.has($from.parent.type.name) ||
        $from.parentOffset !== 0
    ) {
        return false;
    }

    dispatch?.(
        state.tr
            .setNodeMarkup($from.before(), paragraph, { sourceId: null })
            .scrollIntoView(),
    );
    return true;
};

const removableTextBlockTypes = new Set(["code_block", "heading"]);
