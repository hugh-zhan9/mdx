import {
    InitReady,
    remarkPluginsCtx,
    remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { RemarkPlugin } from "@milkdown/kit/transformer";
import { $markSchema, $remark } from "@milkdown/kit/utils";

import {
    authoredEscapeHandlers,
    createAuthoredEscapeRemarkPlugin,
    type TextHandler,
} from "./remark-escapes";
import {
    AUTHORED_ESCAPE_MARK_NAME,
    AUTHORED_ESCAPE_MDAST_TYPE,
    type AuthoredEscapeMode,
} from "./syntax";

export {
    AUTHORED_ESCAPE_MARK_NAME,
    AUTHORED_ESCAPE_MDAST_TYPE,
    isEscapableCharacter,
    readAuthoredEscapes,
    writeAuthoredEscapes,
    type AuthoredEscapeMode,
    type AuthoredRun,
} from "./syntax";

/** Marks the DOM element the mark renders as, and reads it back on paste. */
const DOM_CLASS = "mdx-authored-escape";
const DOM_MODE = "data-escape-mode";

function readMode(value: string | null): AuthoredEscapeMode {
    return value === "auto" ? "auto" : "escaped";
}

/**
 * The mark that carries an escape the author wrote through the document.
 *
 * A mark rather than a node because the escaped character is ordinary text: it
 * is found by search, addressed by a source offset and edited like any other
 * character. Only what the source spelled it as travels alongside.
 *
 * `priority` pins it inside every other mark, the way the preset pins inline
 * code. An escaped character inside emphasis has to be written as `*a\[b*`;
 * opening this mark outside the emphasis would close and reopen the emphasis
 * around it instead. Composing this family last already puts it there, and this
 * says so rather than leaving it to the composition order.
 *
 * `inclusive: false` keeps typing next to an escaped character from inheriting
 * it, which would put a backslash in front of whatever was typed.
 *
 * The DOM carries no `data-mdx` attribute deliberately. That namespace is what
 * the clipboard guard stamps its session token onto, and prose containing an
 * escape would then carry the token into every application it is copied to. The
 * class this parses back from needs no proof of origin: the most a forged one
 * can do is put a backslash in front of a punctuation character, which reads
 * back as that same character.
 */
const authoredEscapeMark = $markSchema(AUTHORED_ESCAPE_MARK_NAME, () => ({
    priority: 100,
    inclusive: false,
    attrs: { mode: { default: "escaped", validate: "string" } },
    parseDOM: [
        {
            tag: `span.${DOM_CLASS}`,
            getAttrs: (dom: HTMLElement) => ({
                mode: readMode(dom.getAttribute(DOM_MODE)),
            }),
        },
    ],
    toDOM: (mark) => [
        "span",
        { class: DOM_CLASS, [DOM_MODE]: String(mark.attrs.mode) },
        0,
    ],
    parseMarkdown: {
        match: (node) => node.type === AUTHORED_ESCAPE_MDAST_TYPE,
        runner: (state, node, markType) => {
            state.openMark(markType, {
                mode: readMode(typeof node.mode === "string" ? node.mode : null),
            });
            state.next(node.children ?? []);
            state.closeMark(markType);
        },
    },
    toMarkdown: {
        match: (mark) => mark.type.name === AUTHORED_ESCAPE_MARK_NAME,
        runner: (state, mark) => {
            state.withMark(mark, AUTHORED_ESCAPE_MDAST_TYPE, undefined, {
                mode: readMode(
                    typeof mark.attrs.mode === "string" ? mark.attrs.mode : null,
                ),
            });
        },
    },
}));

/**
 * The reading pass, registered ahead of every remark plugin the presets install
 * rather than after them.
 *
 * `$remark` appends, and the commonmark preset is composed first, so its soft
 * line break splitter would reach a multi-line paragraph first and leave
 * fragments with no source position — text whose escapes are already resolved
 * and no longer readable. Prepending is the only way to reach the tree first;
 * the slice is a plain array and `$remark` offers no ordering control.
 */
const authoredEscapesFirst: MilkdownPlugin = (ctx) => async () => {
    await ctx.wait(InitReady);
    const entry: RemarkPlugin = {
        plugin: createAuthoredEscapeRemarkPlugin(),
        options: {},
    };
    ctx.update(remarkPluginsCtx, (plugins) => [entry, ...plugins]);
    return () => {
        ctx.update(remarkPluginsCtx, (plugins) =>
            plugins.filter((plugin) => plugin !== entry),
        );
    };
};

/** The same pass again, for text a family hands back after its own transform. */
const authoredEscapesLast = $remark("mdxAuthoredEscapesLast", () =>
    createAuthoredEscapeRemarkPlugin(),
);

/**
 * Installs the writer side over whichever `text` handler is in place.
 *
 * It cannot travel in `toMarkdownExtensions`: Milkdown passes its own `text`
 * handler as a top-level stringify option, and `mdast-util-to-markdown` applies
 * top-level handlers after every extension's, so an extension can never own
 * `text`. Updating the options while the plugin is prepared lands the change
 * before the remark processor is built from them, and composing this family
 * last means the handler it wraps is the one its owner installed.
 */
const authoredEscapeStringify: MilkdownPlugin = (ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: authoredEscapeHandlers(
            options.handlers as Record<string, TextHandler> | undefined,
        ),
    }));
    return () => {};
};

/**
 * Escapes as the author wrote them.
 *
 * The parse side records which characters carried a backslash in the source and
 * the write side puts those backslashes back, so an escape survives an edit
 * anywhere else in the document. The write side also stops the serializer from
 * inventing escapes for prose punctuation, which is the other half of the same
 * rule: `array[0]` was written without a backslash and comes back without one.
 *
 * Compose last. The writer wrapping is only correct over the final `text`
 * handler, and the reading pass has to see the tree both before and after every
 * other transformer.
 */
export function authoredEscapePlugins(): MilkdownPlugin[] {
    return [
        ...authoredEscapeMark,
        authoredEscapesFirst,
        ...authoredEscapesLast,
        authoredEscapeStringify,
    ];
}
