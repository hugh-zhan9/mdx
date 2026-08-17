import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $nodeSchema, $prose, $remark } from "@milkdown/kit/utils";
import {
    frontmatterFromMarkdown,
    frontmatterToMarkdown,
} from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";

/** ProseMirror node name for a frontmatter block. */
const frontmatterNodeName = "frontmatter";

/**
 * Delimiter styles recognised, in mdast node-type form: `yaml` is fenced by
 * `---`, `toml` by `+++`. The mdast type doubles as the node's `kind` attribute
 * so the original delimiter is re-emitted on serialization.
 */
type FrontmatterKind = "yaml" | "toml";

const frontmatterMatters: FrontmatterKind[] = ["yaml", "toml"];

function toFrontmatterKind(value: unknown): FrontmatterKind {
    return value === "toml" ? "toml" : "yaml";
}

/**
 * Teaches the shared remark processor to tokenize frontmatter. Without this the
 * mdast has no `yaml`/`toml` node at all and `---` at the top of a document is
 * read as a thematic break followed by a setext heading.
 *
 * The micromark construct only fires on line 1 at column 1, which is what keeps
 * a later `---` a thematic break.
 */
const attachFrontmatterSyntax: RemarkPluginRaw<Record<string, never>> =
    function attachFrontmatterSyntax() {
        const data = this.data();
        data.micromarkExtensions = [
            ...(data.micromarkExtensions ?? []),
            frontmatter(frontmatterMatters),
        ];
        data.fromMarkdownExtensions = [
            ...(data.fromMarkdownExtensions ?? []),
            frontmatterFromMarkdown(frontmatterMatters),
        ];
        data.toMarkdownExtensions = [
            ...(data.toMarkdownExtensions ?? []),
            frontmatterToMarkdown(frontmatterMatters),
        ];
    };

const frontmatterRemark = $remark(
    "mdxFrontmatter",
    () => attachFrontmatterSyntax,
);

/**
 * A code-block-shaped node whose text content is the frontmatter body exactly
 * as written. Nothing parses the body as YAML or TOML, so key order, quoting,
 * and indentation are whatever the author typed.
 */
const frontmatterSchema = $nodeSchema(frontmatterNodeName, () => ({
    content: "text*",
    group: "block",
    marks: "",
    defining: true,
    code: true,
    attrs: {
        kind: {
            default: "yaml",
            validate: "string",
        },
    },
    parseDOM: [
        {
            tag: "pre[data-frontmatter]",
            preserveWhitespace: "full" as const,
            // Wins over the commonmark `pre` rule, which would otherwise claim
            // this element as a code block.
            priority: 70,
            getAttrs: (dom: HTMLElement | string) => {
                if (typeof dom === "string") return null;
                return { kind: toFrontmatterKind(dom.dataset.frontmatter) };
            },
        },
    ],
    toDOM: (node: ProseMirrorNode) => [
        "pre",
        {
            "data-frontmatter": toFrontmatterKind(node.attrs.kind),
            class: "milkdown-frontmatter",
        },
        ["code", { spellcheck: "false" }, 0],
    ],
    parseMarkdown: {
        match: ({ type }) => type === "yaml" || type === "toml",
        runner: (state, node, type) => {
            const value = typeof node.value === "string" ? node.value : "";
            state.openNode(type, { kind: toFrontmatterKind(node.type) });
            if (value) state.addText(value);
            state.closeNode();
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === frontmatterNodeName,
        runner: (state, node) => {
            state.addNode(
                toFrontmatterKind(node.attrs.kind),
                undefined,
                node.textContent,
            );
        },
    },
}));

/**
 * Keeps frontmatter at the top of the document, where it is the only place it
 * means anything.
 *
 * Frontmatter is only frontmatter at line 1, column 1. A node that reaches the
 * middle of the document — by paste, drag, or undo — still serializes as
 * `---\n…\n---`, which reparses as a thematic break followed by a setext
 * heading. That is silent, total loss of the block. Converting it to a code
 * block the moment it lands keeps every byte and makes the change visible,
 * rather than discovering it on the next open.
 */
const frontmatterPosition = $prose(
    () =>
        new Plugin({
            key: new PluginKey("mdx-frontmatter-position"),
            appendTransaction: (_transactions, _oldState, newState) => {
                const codeBlock = newState.schema.nodes.code_block;
                if (!codeBlock) return null;

                const misplaced: Array<{ pos: number; node: ProseMirrorNode }> =
                    [];
                newState.doc.forEach((child, offset, index) => {
                    if (index === 0) return;
                    if (child.type.name !== frontmatterNodeName) return;
                    misplaced.push({ pos: offset, node: child });
                });
                if (misplaced.length === 0) return null;

                const tr = newState.tr;
                for (const { pos, node } of misplaced.reverse()) {
                    tr.replaceWith(
                        tr.mapping.map(pos),
                        tr.mapping.map(pos + node.nodeSize),
                        codeBlock.create(
                            { language: toFrontmatterKind(node.attrs.kind) },
                            node.content,
                        ),
                    );
                }
                return tr;
            },
        }),
);

/**
 * YAML/TOML frontmatter as an editable source block.
 *
 * Compose after the base plugins so the commonmark schema registers first and
 * keeps owning the document's default block type.
 */
export function frontmatterPlugins(): MilkdownPlugin[] {
    return [frontmatterRemark, frontmatterSchema, frontmatterPosition].flat();
}
