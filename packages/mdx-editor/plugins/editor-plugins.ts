import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Schema } from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";
import {
    createCodeHighlightPlugin,
    type CodeTokenizer,
} from "./editor-code-highlight";
import { createMarkdownClipboardPlugin } from "./editor-clipboard";
import { markdownInputRulesPlugin } from "./editor-input-rules";
import { markdownKeymap } from "./editor-keymap";
import { createEditableLinkPlugin } from "./editor-link-interaction";
import { createSourceFallbackPlugin } from "./source-fallback-plugin";

export interface MdxEditorPluginOptions {
    schema?: Schema;
    codeTokenizer?: CodeTokenizer;
}

export function createMdxEditorPlugins(options: MdxEditorPluginOptions = {}) {
    const schema = options.schema ?? mdxEditorSchema;

    return [
        history(),
        createSourceFallbackPlugin(),
        createCodeHighlightPlugin({ codeTokenizer: options.codeTokenizer }),
        markdownInputRulesPlugin(schema),
        createMarkdownClipboardPlugin({ schema }),
        createEditableLinkPlugin(),
        keymap(markdownKeymap(schema)),
        keymap(baseKeymap),
    ];
}
