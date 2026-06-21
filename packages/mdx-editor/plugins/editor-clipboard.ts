import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Slice } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { parseMarkdown } from "../parser/parse-markdown";
import { mdxEditorSchema } from "../schema/schema";
import { serializeBlockNode } from "../serializer/block-serializer";
import { serializeMarkdown } from "../serializer/serialize-markdown";

export const MARKDOWN_CLIPBOARD_MIME = "application/x-mdx-markdown";

export const markdownClipboardPluginKey = new PluginKey("markdownClipboard");

export function markdownToClipboardHtml(markdown: string): string {
    const parsed = parseMarkdown(markdown);
    let html = "";

    parsed.doc.forEach((node) => {
        html += renderBlockNode(node);
    });

    return html;
}

export function clipboardTextToMarkdown(text: string, html?: string): string {
    if (!html) {
        return text;
    }

    const sanitized = sanitizeClipboardHtml(html);
    const markdown = htmlToMarkdown(sanitized).trimEnd();

    return markdown.length > 0 ? markdown : text;
}

export function createMarkdownClipboardPlugin() {
    return new Plugin({
        key: markdownClipboardPluginKey,
        props: {
            clipboardTextSerializer(slice) {
                return sliceToMarkdown(slice);
            },
            transformPastedHTML(html) {
                return sanitizeClipboardHtml(html);
            },
            handleDOMEvents: {
                copy(view, event) {
                    return writeSelectionToClipboard(view, event, false);
                },
                cut(view, event) {
                    return writeSelectionToClipboard(view, event, true);
                },
                paste(view, event) {
                    return readMarkdownFromClipboard(view, event);
                },
            },
        },
    });
}

function writeSelectionToClipboard(
    view: EditorView,
    event: ClipboardEvent,
    cut: boolean,
) {
    if (view.state.selection.empty || !event.clipboardData) {
        return false;
    }

    const markdown = sliceToMarkdown(view.state.selection.content());

    event.preventDefault();
    event.clipboardData.clearData();
    event.clipboardData.setData(MARKDOWN_CLIPBOARD_MIME, markdown);
    event.clipboardData.setData("text/plain", markdown);
    event.clipboardData.setData("text/html", markdownToClipboardHtml(markdown));

    if (cut) {
        view.dispatch(
            view.state.tr
                .deleteSelection()
                .scrollIntoView()
                .setMeta("uiEvent", "cut"),
        );
    }

    return true;
}

function readMarkdownFromClipboard(view: EditorView, event: ClipboardEvent) {
    const clipboardData = event.clipboardData;
    if (!clipboardData) {
        return false;
    }

    const internalMarkdown = clipboardData.getData(MARKDOWN_CLIPBOARD_MIME);
    if (internalMarkdown) {
        event.preventDefault();
        insertMarkdown(view, internalMarkdown);
        return true;
    }

    const text = clipboardData.getData("text/plain");
    if (looksLikeBlockMarkdownPaste(text)) {
        event.preventDefault();
        insertMarkdown(view, normalizePastedMarkdown(text));
        return true;
    }

    const html = clipboardData.getData("text/html");
    if (!html) {
        return false;
    }

    const markdown = clipboardTextToMarkdown(text, html);
    if (!markdown) {
        return false;
    }

    event.preventDefault();
    insertMarkdown(view, markdown);
    return true;
}

function looksLikeBlockMarkdownPaste(text: string) {
    return (
        /^[ \t]*\\?(?:```|~~~)/m.test(text) ||
        /^ {0,3}#{1,6}\s+\S/m.test(text) ||
        /^ {0,3}(?:[-*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)\S/m.test(text) ||
        /^ {0,3}>/m.test(text) ||
        /^ {0,3}(?:[-*_][ \t]*){3,}$/m.test(text) ||
        looksLikeInlineMarkdownPaste(text) ||
        looksLikeMarkdownTable(text)
    );
}

function normalizePastedMarkdown(markdown: string) {
    return markdown.replace(
        /^([ \t]*)\\?(```|~~~)/gm,
        (_match, indent: string, marker: string) =>
            `${indent.replace(/\t/g, "   ").slice(0, 3)}${marker}`,
    );
}

function looksLikeInlineMarkdownPaste(text: string) {
    return /!?\[[^\]\r\n]*\]\((?:<[^>\r\n]*>|[^)\s\r\n]*)?(?:\s+"[^"\r\n]*")?\)/.test(
        text,
    );
}

function looksLikeMarkdownTable(text: string) {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length - 1; index += 1) {
        if (
            lines[index]?.trimStart().startsWith("|") &&
            /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/.test(
                lines[index + 1] ?? "",
            )
        ) {
            return true;
        }
    }

    return false;
}

function insertMarkdown(view: EditorView, markdown: string) {
    const parsed = parseMarkdown(markdown);
    view.dispatch(
        view.state.tr
            .replaceSelection(new Slice(parsed.doc.content, 0, 0))
            .scrollIntoView()
            .setMeta("paste", true)
            .setMeta("uiEvent", "paste"),
    );
}

function sliceToMarkdown(slice: Slice) {
    const singleChild = slice.content.childCount === 1
        ? slice.content.firstChild
        : null;

    if (
        singleChild?.type.name === "paragraph" &&
        slice.openStart > 0 &&
        slice.openEnd > 0
    ) {
        return serializeBlockNode(singleChild).replace(/\n$/, "");
    }

    const blocks: ProseMirrorNode[] = [];
    slice.content.forEach((node) => {
        if (node.isInline) {
            blocks.push(mdxEditorSchema.nodes.paragraph.create(null, node));
        } else {
            blocks.push(node);
        }
    });

    if (blocks.length === 0) {
        return slice.content.textBetween(0, slice.content.size, "\n\n");
    }

    const doc = mdxEditorSchema.nodes.doc.create(null, blocks);

    return serializeMarkdown({
        diagnostics: [],
        doc,
        originalMarkdown: "",
        sourceSlices: [],
    });
}

function renderBlockNode(node: ProseMirrorNode): string {
    switch (node.type.name) {
        case "heading": {
            const level = headingLevel(node);
            return `<h${level}>${renderInlineContent(node)}</h${level}>`;
        }
        case "paragraph":
            return `<p>${renderInlineContent(node)}</p>`;
        case "blockquote":
            return `<blockquote>${renderChildBlocks(node)}</blockquote>`;
        case "horizontal_rule":
            return `<hr data-mdx-node-type="horizontal_rule">`;
        case "bullet_list":
            return `<ul>${renderChildBlocks(node)}</ul>`;
        case "ordered_list": {
            const start = typeof node.attrs.order === "number" && node.attrs.order > 1
                ? ` start="${node.attrs.order}"`
                : "";
            return `<ol${start}>${renderChildBlocks(node)}</ol>`;
        }
        case "list_item":
            return `<li>${renderChildBlocks(node)}</li>`;
        case "task_item": {
            const checked = node.attrs.checked ? " checked" : "";
            return `<li data-mdx-task-item=""><input type="checkbox" disabled${checked}>${renderChildBlocks(node)}</li>`;
        }
        case "table":
            return `<table><tbody>${renderChildBlocks(node)}</tbody></table>`;
        case "table_row":
            return `<tr>${renderChildBlocks(node)}</tr>`;
        case "table_cell":
            return `<td>${renderInlineContent(node)}</td>`;
        case "table_header":
            return `<th>${renderInlineContent(node)}</th>`;
        case "math_block":
            return `<pre data-mdx-node-type="math_block"><code>${escapeHtml(node.textContent)}</code></pre>`;
        case "mermaid_block":
            return `<pre data-mdx-node-type="mermaid_block" data-mdx-language="mermaid"><code>${escapeHtml(node.textContent)}</code></pre>`;
        case "code_block":
            return `<pre data-mdx-node-type="code_block"><code>${escapeHtml(node.textContent)}</code></pre>`;
        case "frontmatter":
            return `<pre data-mdx-node-type="frontmatter"><code>${escapeHtml(node.textContent)}</code></pre>`;
        case "source_fallback":
        case "opaque_block":
            return `<pre><code>${escapeHtml(node.textContent)}</code></pre>`;
        default:
            return `<p>${escapeHtml(node.textContent)}</p>`;
    }
}

function renderChildBlocks(node: ProseMirrorNode) {
    let html = "";

    node.forEach((child) => {
        html += renderBlockNode(child);
    });

    return html;
}

function renderInlineContent(node: ProseMirrorNode) {
    let html = "";

    node.forEach((child) => {
        html += renderInlineNode(child);
    });

    return html;
}

function renderInlineNode(node: ProseMirrorNode): string {
    if (node.isText) {
        return renderMarks(escapeHtml(node.text ?? ""), node);
    }

    switch (node.type.name) {
        case "image": {
            const src = safeUrl(String(node.attrs.src ?? ""));
            const title = node.attrs.title
                ? ` title="${escapeAttribute(String(node.attrs.title))}"`
                : "";
            return src
                ? `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(String(node.attrs.alt ?? ""))}"${title}>`
                : "";
        }
        case "footnote_ref":
            return `<sup>${escapeHtml(`[^${String(node.attrs.label ?? "")}]`)}</sup>`;
        case "math_inline":
            return `<code>${escapeHtml(String(node.attrs.latex ?? ""))}</code>`;
        default:
            return escapeHtml(node.textContent);
    }
}

function renderMarks(html: string, node: ProseMirrorNode) {
    let rendered = html;

    for (let index = node.marks.length - 1; index >= 0; index -= 1) {
        const mark = node.marks[index];
        switch (mark.type.name) {
            case "strong":
                rendered = `<strong>${rendered}</strong>`;
                break;
            case "emphasis":
                rendered = `<em>${rendered}</em>`;
                break;
            case "strike":
                rendered = `<del>${rendered}</del>`;
                break;
            case "inline_code":
                rendered = `<code>${rendered}</code>`;
                break;
            case "link": {
                const href = safeUrl(String(mark.attrs.href ?? ""));
                const title = mark.attrs.title
                    ? ` title="${escapeAttribute(String(mark.attrs.title))}"`
                    : "";
                rendered = href
                    ? `<a href="${escapeAttribute(href)}"${title}>${rendered}</a>`
                    : rendered;
                break;
            }
        }
    }

    return rendered;
}

function sanitizeClipboardHtml(html: string) {
    const document = parseHtmlDocument(html);

    if (document) {
        for (const element of Array.from(document.querySelectorAll("script"))) {
            element.remove();
        }

        for (const element of Array.from(document.body.querySelectorAll("*"))) {
            for (const attribute of Array.from(element.attributes)) {
                const name = attribute.name.toLowerCase();
                if (name.startsWith("on")) {
                    element.removeAttribute(attribute.name);
                    continue;
                }

                if (
                    ["href", "src", "xlink:href"].includes(name) &&
                    isUnsafeUrl(attribute.value)
                ) {
                    element.removeAttribute(attribute.name);
                }
            }
        }

        return document.body.innerHTML;
    }

    return sanitizeHtmlWithoutDom(html);
}

function sanitizeHtmlWithoutDom(html: string) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<script\b[^>]*(?:>|$)[\s\S]*$/gi, "")
        .replace(
            /<([a-z][\w:-]*)(\s[^<>]*?)?>/gi,
            (tag, tagName: string, attributes: string | undefined) => {
                const safeAttributes = sanitizeHtmlAttributes(attributes ?? "");

                return `<${tagName}${safeAttributes}>`;
            },
        );
}

function sanitizeHtmlAttributes(attributes: string) {
    return attributes.replace(
        /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
        (
            attribute,
            name: string,
            doubleQuotedValue: string | undefined,
            singleQuotedValue: string | undefined,
            unquotedValue: string | undefined,
        ) => {
            const lowerName = name.toLowerCase();
            if (lowerName.startsWith("on")) {
                return "";
            }

            const value = doubleQuotedValue ?? singleQuotedValue ?? unquotedValue;
            if (
                value !== undefined &&
                ["href", "src", "xlink:href"].includes(lowerName) &&
                isUnsafeUrl(decodeHtmlAttributeValue(value))
            ) {
                return "";
            }

            return attribute;
        },
    );
}

function htmlToMarkdown(html: string) {
    const document = parseHtmlDocument(html);
    if (!document) {
        return stripHtmlToText(html);
    }

    return renderHtmlChildrenAsMarkdown(document.body).trimEnd();
}

function renderHtmlChildrenAsMarkdown(parent: ParentNode) {
    let markdown = "";

    parent.childNodes.forEach((child) => {
        markdown += renderHtmlNodeAsMarkdown(child);
    });

    return markdown;
}

function renderHtmlNodeAsMarkdown(node: Node): string {
    if (node.nodeType === node.TEXT_NODE) {
        return escapeMarkdownText(node.textContent ?? "");
    }

    if (node.nodeType !== node.ELEMENT_NODE) {
        return "";
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    switch (tagName) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
            return `${"#".repeat(Number(tagName.slice(1)))} ${renderHtmlChildrenAsMarkdown(element).trim()}\n\n`;
        case "p":
        case "div":
        case "section":
        case "article":
            return `${renderHtmlChildrenAsMarkdown(element).trim()}\n\n`;
        case "br":
            return "\n";
        case "strong":
        case "b":
            return `**${renderHtmlChildrenAsMarkdown(element)}**`;
        case "em":
        case "i":
            return `*${renderHtmlChildrenAsMarkdown(element)}*`;
        case "s":
        case "del":
            return `~~${renderHtmlChildrenAsMarkdown(element)}~~`;
        case "code":
            return element.closest("pre")
                ? element.textContent ?? ""
                : `\`${escapeInlineCode(element.textContent ?? "")}\``;
        case "pre":
            return `\`\`\`\n${element.textContent ?? ""}\`\`\`\n\n`;
        case "a": {
            const label = renderHtmlChildrenAsMarkdown(element);
            const href = safeUrl(element.getAttribute("href") ?? "");
            return href ? `[${label}](${href})` : label;
        }
        case "img": {
            const src = safeUrl(element.getAttribute("src") ?? "");
            const alt = escapeMarkdownText(element.getAttribute("alt") ?? "");
            return src ? `![${alt}](${src})` : "";
        }
        case "blockquote":
            return `${renderHtmlChildrenAsMarkdown(element)
                .trimEnd()
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n")}\n\n`;
        case "hr":
            return "---\n\n";
        case "ul":
            return renderListElement(element, false);
        case "ol":
            return renderListElement(element, true);
        case "li":
            return `${renderHtmlChildrenAsMarkdown(element).trim()}\n`;
        default:
            return renderHtmlChildrenAsMarkdown(element);
    }
}

function renderListElement(element: HTMLElement, ordered: boolean) {
    let index = Number(element.getAttribute("start") ?? "1");
    const lines: string[] = [];

    for (const item of Array.from(element.children)) {
        if (item.tagName.toLowerCase() !== "li") {
            continue;
        }

        const marker = ordered ? `${index}.` : "-";
        lines.push(`${marker} ${renderHtmlChildrenAsMarkdown(item).trim()}`);
        index += 1;
    }

    return `${lines.join("\n")}\n\n`;
}

function parseHtmlDocument(html: string): Document | null {
    const DomParser = globalThis.DOMParser;
    if (!DomParser) {
        return null;
    }

    return new DomParser().parseFromString(html, "text/html");
}

function stripHtmlToText(html: string) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function escapeHtml(text: string) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function escapeAttribute(text: string) {
    return escapeHtml(text).replaceAll('"', "&quot;");
}

function escapeMarkdownText(text: string) {
    let escaped = "";

    for (const char of text) {
        escaped += "\\*~`".includes(char) ? `\\${char}` : char;
    }

    return escaped;
}

function escapeInlineCode(text: string) {
    return text.replaceAll("`", "\\`");
}

function safeUrl(url: string) {
    return isUnsafeUrl(url) ? "" : url;
}

function decodeHtmlAttributeValue(value: string) {
    return value
        .replace(/&#(\d+);?/g, (_match, code: string) =>
            String.fromCodePoint(Number(code)),
        )
        .replace(/&#x([0-9a-f]+);?/gi, (_match, code: string) =>
            String.fromCodePoint(Number.parseInt(code, 16)),
        )
        .replace(/&colon;?/gi, ":")
        .replace(/&Tab;?/g, "\t")
        .replace(/&NewLine;?/g, "\n");
}

function isUnsafeUrl(url: string) {
    return url.replace(/[\u0000-\u001f\s]+/g, "").toLowerCase().startsWith(
        "javascript:",
    );
}

function headingLevel(node: ProseMirrorNode) {
    const level = node.attrs.level;

    return typeof level === "number" && level >= 1 && level <= 6 ? level : 1;
}
