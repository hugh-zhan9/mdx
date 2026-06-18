import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { createSourceFallbackPlugin } from "./source-fallback-plugin";

export function createMdxEditorPlugins() {
    return [history(), createSourceFallbackPlugin(), keymap(baseKeymap)];
}
