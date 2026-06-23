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
import { createEditorClipboardPlugin } from "./editor-clipboard";
import { createMarkdownInputRulesPlugin } from "./editor-input-rules";
import { markdownKeymap } from "./editor-keymap";
import { createEditableLinkPlugin } from "./editor-link-interaction";
import { sourceFallbackPlugin } from "./source-fallback-plugin";

export interface MdxEditorPluginOptions {
    schema?: Schema;
    codeTokenizer?: CodeTokenizer;
    parseMarkdown?: (markdown: string) => ParsedMarkdownDocument;
    serializeMarkdown?: (doc: ProseMirrorNode | ParsedMarkdownDocument) => string;
    clipboard?: KernelClipboard;
}

export function createEditorPluginsForKernel(options: MdxEditorPluginOptions = {}) {
    const schema = options.schema ?? mdxEditorSchema;

    return [
        history(),
        sourceFallbackPlugin(),
        createCodeHighlightPlugin({ codeTokenizer: options.codeTokenizer }),
        createMarkdownInputRulesPlugin(schema),
        createEditorClipboardPlugin({
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
