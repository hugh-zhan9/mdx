import type { MarkdownNode, RemarkPluginRaw } from "@milkdown/kit/transformer";

import {
    WIKILINK_MDAST_TYPE,
    findWikilinks,
    formatWikilink,
} from "./syntax";

/** The mdast node this plugin produces and consumes. */
export interface WikilinkMarkdownNode extends MarkdownNode {
    type: typeof WIKILINK_MDAST_TYPE;
    target: string;
    alias: string | null;
}

/**
 * The slice of the remark processor's data this plugin writes to. Declared
 * locally so the plugin does not import a package the workspace does not
 * depend on directly.
 */
interface ProcessorDataWithToMarkdown {
    toMarkdownExtensions?: unknown[];
}

const wikilinkToMarkdown = {
    handlers: {
        // Handler output is inserted verbatim, which is the whole point: the
        // default `text` handler escapes `[`, turning `[[X]]` into `\[\[X]]`.
        [WIKILINK_MDAST_TYPE]: (node: WikilinkMarkdownNode) =>
            formatWikilink(node.target, node.alias),
    },
};

function splitTextNode(node: MarkdownNode): MarkdownNode[] | null {
    const value = node.value;
    if (typeof value !== "string") return null;

    const matches = findWikilinks(value);
    if (matches.length === 0) return null;

    const pieces: MarkdownNode[] = [];
    let cursor = 0;
    for (const match of matches) {
        if (match.start > cursor) {
            pieces.push({ type: "text", value: value.slice(cursor, match.start) });
        }
        pieces.push({
            type: WIKILINK_MDAST_TYPE,
            target: match.target,
            alias: match.alias,
        });
        cursor = match.end;
    }
    if (cursor < value.length) {
        pieces.push({ type: "text", value: value.slice(cursor) });
    }

    return pieces;
}

/**
 * Rewrites `text` children in place. Only `text` nodes are visited, so an
 * `inlineCode` or `code` node — whose payload lives in `value`, not in children
 * — is structurally out of reach and stays literal.
 */
function transformChildren(node: MarkdownNode): void {
    const children = node.children;
    if (!Array.isArray(children)) return;

    let rewritten: MarkdownNode[] | null = null;
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.type === "text") {
            const pieces = splitTextNode(child);
            if (pieces) {
                rewritten ??= children.slice(0, index);
                rewritten.push(...pieces);
                continue;
            }
        } else {
            transformChildren(child);
        }
        rewritten?.push(child);
    }

    if (rewritten) node.children = rewritten;
}

/**
 * Adds the wikilink tokenizer to the parse side and the wikilink writer to the
 * stringify side of Milkdown's shared remark processor.
 */
export const remarkWikilink: RemarkPluginRaw<undefined> =
    function remarkWikilink() {
        const data = this.data() as unknown as ProcessorDataWithToMarkdown;
        const extensions = (data.toMarkdownExtensions ??= []);
        if (!extensions.includes(wikilinkToMarkdown)) {
            extensions.push(wikilinkToMarkdown);
        }

        return (tree) => {
            transformChildren(tree as MarkdownNode);
        };
    };
