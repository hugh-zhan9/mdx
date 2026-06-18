import { baseKeymap, chainCommands } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import {
    liftListItem,
    sinkListItem,
    splitListItem,
} from "prosemirror-schema-list";
import type { Command } from "prosemirror-state";
import {
    toggleEmphasisMark,
    toggleStrikeMark,
    toggleStrongMark,
} from "../commands/editor-commands";
import { mdxEditorSchema } from "../schema/schema";

export function markdownKeymap(): Record<string, Command> {
    const { list_item: listItem, task_item: taskItem } = mdxEditorSchema.nodes;
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
        Enter: splitListCommand,
        Backspace: liftListCommand,
        Tab: sinkListCommand,
        "Shift-Tab": liftListCommand,
    };
}
