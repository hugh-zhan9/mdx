import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { markdownInputRulesPlugin } from "./editor-input-rules";
import { markdownKeymap } from "./editor-keymap";
import { createSourceFallbackPlugin } from "./source-fallback-plugin";

export function createMdxEditorPlugins() {
    return [
        history(),
        createSourceFallbackPlugin(),
        markdownInputRulesPlugin(),
        keymap(markdownKeymap()),
        keymap(baseKeymap),
    ];
}
