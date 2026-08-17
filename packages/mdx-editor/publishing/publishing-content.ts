/**
 * Reading a captured Markdown revision as publishing content.
 *
 * This is publishing's own Markdown reader. It shares no parser state, schema,
 * ProseMirror position, DOM node or line box with the editing surface: it takes
 * a string and returns content semantics — headings, body text, links, images,
 * code and math — and nothing that could address a caret or a selection.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import type { PhrasingContent, Root, RootContent } from "mdast";

import type {
    PublishingBlock,
    PublishingContent,
    PublishingEmphasis,
    PublishingHeadingLevel,
    PublishingInline,
} from "./types";

/** Reads one Markdown revision into ordered publishing content. */
export function readPublishingContent(markdown: string): PublishingContent {
    const tree = fromMarkdown(markdown, {
        extensions: [gfm(), math(), frontmatter(["yaml", "toml"])],
        mdastExtensions: [
            gfmFromMarkdown(),
            mathFromMarkdown(),
            frontmatterFromMarkdown(["yaml", "toml"]),
        ],
    }) as Root;

    const blocks: PublishingBlock[] = [];
    readBlocks(tree.children, blocks, 0);
    return { blocks };
}

function readBlocks(
    nodes: RootContent[],
    blocks: PublishingBlock[],
    depth: number,
): void {
    for (const node of nodes) {
        readBlock(node, blocks, depth);
    }
}

function readBlock(
    node: RootContent,
    blocks: PublishingBlock[],
    depth: number,
): void {
    // Frontmatter is matched before the switch: the mdast types this workspace
    // resolves declare a `yaml` node but no `toml` one, while the reader is
    // configured for both, so the switch cannot narrow them together.
    const nodeType: string = node.type;

    if (nodeType === "yaml" || nodeType === "toml") {
        blocks.push({
            kind: "frontmatter",
            text: (node as { value: string }).value,
        });
        return;
    }

    switch (node.type) {
        case "heading":
            blocks.push({
                kind: "heading",
                level: headingLevel(node.depth),
                inlines: readInlines(node.children),
            });
            return;
        case "paragraph":
            blocks.push({
                kind: "paragraph",
                inlines: readInlines(node.children),
            });
            return;
        case "blockquote":
            for (const child of node.children) {
                const quoted: PublishingBlock[] = [];
                readBlock(child, quoted, depth);
                for (const block of quoted) {
                    blocks.push(
                        block.kind === "paragraph"
                            ? { kind: "quote", inlines: block.inlines }
                            : block,
                    );
                }
            }
            return;
        case "list":
            for (const item of node.children) {
                readListItem(item, node.ordered === true, blocks, depth);
            }
            return;
        case "code":
            blocks.push({
                kind: "code",
                language: node.lang ?? "",
                text: node.value,
            });
            return;
        case "math":
            blocks.push({ kind: "math", text: node.value });
            return;
        case "table": {
            node.children.forEach((row, index) => {
                blocks.push({
                    kind: "table_row",
                    header: index === 0,
                    cells: row.children.map((cell) => readInlines(cell.children)),
                });
            });
            return;
        }
        case "thematicBreak":
            blocks.push({ kind: "thematic_break" });
            return;
        case "html":
            blocks.push({ kind: "html", text: node.value });
            return;
        case "footnoteDefinition":
            readBlocks(node.children, blocks, depth);
            return;
        default:
            return;
    }
}

function readListItem(
    item: RootContent,
    ordered: boolean,
    blocks: PublishingBlock[],
    depth: number,
): void {
    if (item.type !== "listItem") {
        readBlock(item, blocks, depth);
        return;
    }

    for (const child of item.children) {
        if (child.type === "paragraph") {
            blocks.push({
                kind: "list_item",
                ordered,
                depth,
                checked: item.checked ?? null,
                inlines: readInlines(child.children),
            });
            continue;
        }

        readBlock(child, blocks, depth + 1);
    }
}

function headingLevel(depth: number): PublishingHeadingLevel {
    const clamped = Math.min(Math.max(Math.trunc(depth), 1), 6);
    return clamped as PublishingHeadingLevel;
}

function readInlines(
    nodes: PhrasingContent[],
    emphasis: PublishingEmphasis[] = [],
): PublishingInline[] {
    const inlines: PublishingInline[] = [];

    for (const node of nodes) {
        switch (node.type) {
            case "text":
                pushText(inlines, node.value, emphasis);
                break;
            case "strong":
                inlines.push(...readInlines(node.children, [...emphasis, "strong"]));
                break;
            case "emphasis":
                inlines.push(
                    ...readInlines(node.children, [...emphasis, "emphasis"]),
                );
                break;
            case "delete":
                inlines.push(...readInlines(node.children, [...emphasis, "strike"]));
                break;
            case "inlineCode":
                inlines.push({
                    kind: "code",
                    text: node.value,
                    ...(emphasis.length > 0 ? { emphasis: [...emphasis] } : {}),
                });
                break;
            case "inlineMath":
                inlines.push({
                    kind: "math",
                    text: node.value,
                    ...(emphasis.length > 0 ? { emphasis: [...emphasis] } : {}),
                });
                break;
            case "link":
                inlines.push({
                    kind: "link",
                    text: plainText(node.children),
                    target: node.url,
                    ...(node.title ? { title: node.title } : {}),
                    ...(emphasis.length > 0 ? { emphasis: [...emphasis] } : {}),
                });
                break;
            case "image":
                inlines.push({
                    kind: "image",
                    text: "",
                    target: node.url,
                    alt: node.alt ?? "",
                    ...(node.title ? { title: node.title } : {}),
                });
                break;
            case "break":
                inlines.push({ kind: "break", text: "" });
                break;
            case "html":
                pushText(inlines, node.value, emphasis);
                break;
            case "linkReference":
            case "imageReference":
            case "footnoteReference":
                pushText(inlines, plainText(childrenOf(node)), emphasis);
                break;
            default:
                break;
        }
    }

    return inlines;
}

function pushText(
    inlines: PublishingInline[],
    text: string,
    emphasis: PublishingEmphasis[],
): void {
    if (text.length === 0) {
        return;
    }

    inlines.push({
        kind: "text",
        text,
        ...(emphasis.length > 0 ? { emphasis: [...emphasis] } : {}),
    });
}

function childrenOf(node: PhrasingContent): PhrasingContent[] {
    return "children" in node ? (node.children as PhrasingContent[]) : [];
}

function plainText(nodes: PhrasingContent[]): string {
    return nodes
        .map((node) => {
            if (node.type === "text" || node.type === "inlineCode") {
                return node.value;
            }

            if (node.type === "inlineMath") {
                return node.value;
            }

            return plainText(childrenOf(node));
        })
        .join("");
}

/**
 * The canonical semantic reading of publishing content.
 *
 * Two renderings agree when their digests are equal. The tokens name content —
 * heading level and text, body text, link destinations, image sources, code and
 * math — and never a position, a size or a colour, so the comparison is a
 * content comparison and can never become a pixel comparison.
 */
export function publishingContentDigest(
    content: PublishingContent,
): string[] {
    const tokens: string[] = [];

    for (const block of content.blocks) {
        switch (block.kind) {
            case "heading":
                tokens.push(`heading:${block.level}`);
                pushInlineTokens(tokens, block.inlines);
                break;
            case "paragraph":
                tokens.push("paragraph");
                pushInlineTokens(tokens, block.inlines);
                break;
            case "quote":
                tokens.push("quote");
                pushInlineTokens(tokens, block.inlines);
                break;
            case "list_item":
                tokens.push(
                    `list_item:${block.ordered ? "ordered" : "bullet"}:${block.depth}:${
                        block.checked === null ? "none" : String(block.checked)
                    }`,
                );
                pushInlineTokens(tokens, block.inlines);
                break;
            case "code":
                tokens.push(`code:${block.language}=${block.text}`);
                break;
            case "math":
                tokens.push(`math=${block.text}`);
                break;
            case "table_row":
                tokens.push(`table_row:${block.header ? "header" : "body"}`);
                for (const cell of block.cells) {
                    tokens.push("table_cell");
                    pushInlineTokens(tokens, cell);
                }
                break;
            case "thematic_break":
                tokens.push("thematic_break");
                break;
            case "html":
                tokens.push(`html=${block.text}`);
                break;
            case "frontmatter":
                tokens.push(`frontmatter=${block.text}`);
                break;
        }
    }

    return tokens;
}

function pushInlineTokens(
    tokens: string[],
    inlines: PublishingInline[],
): void {
    for (const inline of inlines) {
        const emphasis =
            inline.emphasis && inline.emphasis.length > 0
                ? `[${[...inline.emphasis].sort().join("+")}]`
                : "";

        switch (inline.kind) {
            case "text":
                tokens.push(`text${emphasis}=${inline.text}`);
                break;
            case "link":
                tokens.push(`link${emphasis}=${inline.target ?? ""}|${inline.text}`);
                break;
            case "image":
                tokens.push(`image=${inline.target ?? ""}|${inline.alt ?? ""}`);
                break;
            case "code":
                tokens.push(`inline_code${emphasis}=${inline.text}`);
                break;
            case "math":
                tokens.push(`inline_math${emphasis}=${inline.text}`);
                break;
            case "break":
                tokens.push("break");
                break;
        }
    }
}
