import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { MarkdownNode, RemarkPluginRaw } from "@milkdown/kit/transformer";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";

import {
    INLINE_MATH_MDAST_TYPE,
    inlineMathEscapeOffsets,
    isAcceptedInlineMath,
    unescapeMarkdownPunctuation,
} from "./syntax";

/**
 * The slice of `mdast-util-to-markdown`'s serializer state this plugin needs.
 *
 * Declared with method syntax so the members stay bivariant and the real state
 * satisfies this shape without importing a package the workspace does not
 * depend on directly.
 */
interface MathSerializerState {
    safe(value: string, config: { before: string; after: string }): string;
}

interface MathSafeInfo {
    before: string;
    after: string;
}

interface MathTextNode {
    type: string;
    value?: unknown;
}

/**
 * Writes a text node, escaping only the dollars that would otherwise be read
 * back as math.
 *
 * `mathToMarkdown` escapes every `$` in phrasing, which would rewrite
 * `costs $5 and $10 today` on the first keystroke. Escaping exactly the fences
 * of the runs {@link inlineMathEscapeOffsets} reports keeps prose bytes intact
 * while still keeping prose that only looks like math out of a math node.
 */
function mathAwareText(
    node: MathTextNode,
    _parent: unknown,
    state: MathSerializerState,
    info: MathSafeInfo,
): string {
    const value = typeof node.value === "string" ? node.value : "";
    const offsets = inlineMathEscapeOffsets(value, info.after);
    if (offsets.length === 0) return state.safe(value, info);

    let result = "";
    let cursor = 0;
    let before = info.before;
    for (const offset of offsets) {
        result += state.safe(value.slice(cursor, offset), {
            before,
            after: "$",
        });
        result += "\\$";
        before = "$";
        cursor = offset + 1;
    }
    return (
        result + state.safe(value.slice(cursor), { before, after: info.after })
    );
}

/**
 * Installs {@link mathAwareText} as the serializer's `text` handler.
 *
 * It cannot travel in `toMarkdownExtensions`: Milkdown passes its own `text`
 * handler as a top-level stringify option, and `mdast-util-to-markdown` applies
 * top-level handlers after every extension's, so an extension can never own
 * `text`. Updating the options while the plugin is prepared lands the change
 * before the remark processor is built from them.
 */
export const mathTextEscapePlugin: MilkdownPlugin = (ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: { ...options.handlers, text: mathAwareText },
    }));
    return () => {};
};

const mathMarkdown = mathToMarkdown();

const mathToMarkdownExtension = {
    handlers: mathMarkdown.handlers,
    // `{ character: "$", inConstruct: "phrasing" }` is dropped: it escapes every
    // dollar in prose, and `mathAwareText` decides those escapes with the whole
    // text value in hand, which a per-character rule cannot do.
    unsafe: (mathMarkdown.unsafe ?? []).filter(
        (pattern) => pattern.inConstruct !== "phrasing",
    ),
};

/** Reads a node's source, or `null` when the node carries no position. */
function nodeSource(
    node: MarkdownNode,
    source: string,
): { raw: string; after: string } | null {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    return { raw: source.slice(start, end), after: source.slice(end, end + 1) };
}

/** Appends `node`, folding it into the previous child when both are text. */
function pushChild(children: MarkdownNode[], node: MarkdownNode): void {
    const previous = children[children.length - 1];
    if (
        node.type !== "text" ||
        previous?.type !== "text" ||
        typeof previous.value !== "string" ||
        typeof node.value !== "string"
    ) {
        children.push(node);
        return;
    }
    // Merged so the serializer sees the same run of characters micromark saw; a
    // dollar left on a node boundary would be judged without its context.
    previous.value += node.value;
    if (previous.position && node.position) {
        previous.position = {
            start: previous.position.start,
            end: node.position.end,
        };
    }
}

/** Demotes every math span the Pandoc rules reject back to literal text. */
function demoteRejectedMath(parent: MarkdownNode, source: string): void {
    const children = parent.children;
    if (!Array.isArray(children)) return;

    const kept: MarkdownNode[] = [];
    for (const child of children) {
        if (child.type === INLINE_MATH_MDAST_TYPE) {
            const read = nodeSource(child, source);
            if (read && !isAcceptedInlineMath(read.raw, read.after)) {
                pushChild(kept, {
                    type: "text",
                    value: unescapeMarkdownPunctuation(read.raw),
                    position: child.position,
                });
                continue;
            }
            kept.push(child);
            continue;
        }
        demoteRejectedMath(child, source);
        pushChild(kept, child);
    }
    parent.children = kept;
}

export type MathRemarkOptions = Record<string, never>;

/**
 * Teaches the shared remark processor to read and write `$…$` and `$$…$$`.
 *
 * Tokenizing is left to `micromark-extension-math` so the LaTeX inside a span
 * is taken raw, exactly as a code span is: the backslashes in `\{x\}` belong to
 * the math, not to Markdown. The stricter question of whether a span is math at
 * all is settled afterwards, against the source the tokenizer consumed.
 */
export const mathRemarkPlugin: RemarkPluginRaw<MathRemarkOptions> =
    function mathRemark() {
        const data = this.data();
        data.micromarkExtensions = [
            ...(data.micromarkExtensions ?? []),
            math(),
        ];
        data.fromMarkdownExtensions = [
            ...(data.fromMarkdownExtensions ?? []),
            mathFromMarkdown(),
        ];
        data.toMarkdownExtensions = [
            ...(data.toMarkdownExtensions ?? []),
            mathToMarkdownExtension,
        ];

        return (tree, file) => {
            demoteRejectedMath(tree as MarkdownNode, String(file));
        };
    };
