import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Schema } from "prosemirror-model";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { ParsedMarkdownDocument } from "../core/types";
import type { KernelClipboard } from "../kernel/clipboard";
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
    parseMarkdown?: (markdown: string) => ParsedMarkdownDocument;
    serializeMarkdown?: (doc: ProseMirrorNode | ParsedMarkdownDocument) => string;
    clipboard?: KernelClipboard;
}

export function createMdxEditorPlugins(options: MdxEditorPluginOptions = {}) {
    const schema = options.schema ?? mdxEditorSchema;

    return [
        history(),
        createSourceFallbackPlugin(),
        createCodeHighlightPlugin({ codeTokenizer: options.codeTokenizer }),
        markdownInputRulesPlugin(schema),
        createMarkdownClipboardPlugin({
            schema,
            parseMarkdown: options.parseMarkdown,
            serializeMarkdown: options.serializeMarkdown,
            clipboard: options.clipboard,
        }),
        createEditableLinkPlugin(schema),
        keymap(markdownKeymap(schema)),
        keymap(baseKeymap),
    ];
}
