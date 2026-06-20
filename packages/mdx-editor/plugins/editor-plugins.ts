import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
    createCodeHighlightPlugin,
    type CodeTokenizer,
} from "./editor-code-highlight";
import { createMarkdownClipboardPlugin } from "./editor-clipboard";
import { markdownInputRulesPlugin } from "./editor-input-rules";
import { markdownKeymap } from "./editor-keymap";
import { createSourceFallbackPlugin } from "./source-fallback-plugin";

export interface MdxEditorPluginOptions {
    codeTokenizer?: CodeTokenizer;
}

export function createMdxEditorPlugins(options: MdxEditorPluginOptions = {}) {
    return [
        history(),
        createSourceFallbackPlugin(),
        createCodeHighlightPlugin({ codeTokenizer: options.codeTokenizer }),
        markdownInputRulesPlugin(),
        createMarkdownClipboardPlugin(),
        keymap(markdownKeymap()),
        keymap(baseKeymap),
    ];
}
