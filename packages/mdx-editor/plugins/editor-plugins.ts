import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";

export function createMdxEditorPlugins() {
    return [history(), keymap(baseKeymap)];
}
