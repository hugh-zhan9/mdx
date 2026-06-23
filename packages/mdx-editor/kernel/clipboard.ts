import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { ParsedMarkdownDocument } from "../core/types";
import type { ClipboardContext, SyntaxRegistry } from "./types";

export interface KernelClipboard {
    serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
    serializeHtml(doc: ProseMirrorNode): string;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    parseHtml(html: string): ParsedMarkdownDocument;
}

export function createKernelClipboard(options: {
    schema: Schema;
    registry: SyntaxRegistry;
    parseMarkdown(markdown: string): ParsedMarkdownDocument;
    serializeMarkdown(doc: ProseMirrorNode | ParsedMarkdownDocument): string;
}): KernelClipboard {
    const context: ClipboardContext = {
        schema: options.schema,
        parseMarkdown: options.parseMarkdown,
        serializeMarkdown: (doc) => options.serializeMarkdown(doc),
    };

    return {
        serializeMarkdown: options.serializeMarkdown,
        serializeHtml: (doc) => serializeHtmlNode(doc, options.registry, context),
        parseMarkdown: options.parseMarkdown,
        parseHtml: (html) => {
            const sanitized = sanitizeClipboardHtml(html);
            const markdown = htmlToMarkdown(sanitized);

            return options.parseMarkdown(markdown.length > 0 ? markdown : "");
        },
    };
}

function serializeHtmlNode(
    node: ProseMirrorNode,
    registry: SyntaxRegistry,
    context: ClipboardContext,
): string {
    for (const contribution of registry.clipboard) {
        const renderer = contribution.toClipboardHtml?.[node.type.name];
        if (renderer) {
            return renderer(node, context);
        }
    }

    if (node.isText) {
        return renderMarks(escapeHtml(node.text ?? ""), node);
    }

    switch (node.type.name) {
        case "doc":
            return renderChildNodes(node, registry, context);
        case "heading": {
            const level = headingLevel(node);
            return `<h${level}>${renderChildNodes(node, registry, context)}</h${level}>`;
        }
        case "paragraph":
            return `<p>${renderChildNodes(node, registry, context)}</p>`;
        case "blockquote":
            return `<blockquote>${renderChildNodes(node, registry, context)}</blockquote>`;
        case "horizontal_rule":
            return `<hr data-mdx-node-type="horizontal_rule">`;
        case "bullet_list":
            return `<ul>${renderChildNodes(node, registry, context)}</ul>`;
        case "ordered_list": {
            const start = typeof node.attrs.order === "number" && node.attrs.order > 1
                ? ` start="${node.attrs.order}"`
                : "";
            return `<ol${start}>${renderChildNodes(node, registry, context)}</ol>`;
        }
        case "list_item":
            return `<li>${renderChildNodes(node, registry, context)}</li>`;
        case "task_item": {
            const checked = node.attrs.checked ? " checked" : "";
            return `<li data-mdx-task-item=""><input type="checkbox" disabled${checked}>${renderChildNodes(node, registry, context)}</li>`;
        }
        case "table":
            return `<table><tbody>${renderChildNodes(node, registry, context)}</tbody></table>`;
        case "table_row":
            return `<tr>${renderChildNodes(node, registry, context)}</tr>`;
        case "table_cell":
            return `<td>${renderChildNodes(node, registry, context)}</td>`;
        case "table_header":
            return `<th>${renderChildNodes(node, registry, context)}</th>`;
        case "image":
            return renderImage(node);
        case "math_inline":
            return `<code>${escapeHtml(String(node.attrs.latex ?? ""))}</code>`;
        case "math_block":
            return `<pre data-mdx-node-type="math_block"><code>${escapeHtml(node.textContent)}</code></pre>`;
        case "frontmatter":
            return `<pre data-mdx-node-type="frontmatter"><code>${escapeHtml(node.textContent)}</code></pre>`;
        case "callout":
            return `<blockquote>${renderChildNodes(node, registry, context)}</blockquote>`;
        case "opaque_block":
            return `<pre><code>${escapeHtml(node.textContent)}</code></pre>`;
        default:
            if (node.isInline) {
                return escapeHtml(node.textContent);
            }
            return `<p>${escapeHtml(node.textContent)}</p>`;
    }
}

function renderChildNodes(
    node: ProseMirrorNode,
    registry: SyntaxRegistry,
    context: ClipboardContext,
) {
    let html = "";

    node.forEach((child) => {
        html += serializeHtmlNode(child, registry, context);
    });

    return html;
}

function renderImage(node: ProseMirrorNode) {
    const src = safeUrl(String(node.attrs.src ?? ""));
    if (!src) {
        return "";
    }

    const title = node.attrs.title
        ? ` title="${escapeAttribute(String(node.attrs.title))}"`
        : "";

    return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(String(node.attrs.alt ?? ""))}"${title}>`;
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

export function sanitizeClipboardHtml(html: string) {
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
            (_tag, tagName: string, attributes: string | undefined) => {
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
        return stripHtmlToText(html).trimEnd();
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
    const nodeType = element.getAttribute("data-mdx-node-type");
    const tagName = element.tagName.toLowerCase();

    if (nodeType === "source_fallback") {
        return ensureTrailingNewline(element.textContent ?? "");
    }

    if (nodeType === "html_block") {
        return ensureTrailingNewline(sanitizedRawHtmlFromMetadata(element));
    }

    if (nodeType === "inline_html") {
        return sanitizedRawHtmlFromMetadata(element);
    }

    if (nodeType === "mermaid_block") {
        return `\`\`\`${element.getAttribute("data-mdx-info") ?? "mermaid"}\n${textBeforeFence(element.textContent ?? "")}\`\`\`\n\n`;
    }

    if (nodeType === "code_block") {
        return `\`\`\`${element.getAttribute("data-mdx-info") ?? ""}\n${textBeforeFence(element.textContent ?? "")}\`\`\`\n\n`;
    }

    if (nodeType === "frontmatter") {
        return `---\n${textBeforeFence(element.textContent ?? "")}---\n\n`;
    }

    if (nodeType === "footnote_ref") {
        return `[^${escapeFootnoteLabel(element.getAttribute("data-mdx-label") ?? element.textContent ?? "")}]`;
    }

    if (nodeType === "footnote_definition") {
        return `[^${escapeFootnoteLabel(element.getAttribute("data-mdx-label") ?? "")}]: ${renderHtmlChildrenAsMarkdown(element).trim()}\n\n`;
    }

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
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<script\b[^>]*(?:>|$)[\s\S]*$/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

export function escapeHtml(text: string) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

export function escapeAttribute(text: string) {
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

function escapeFootnoteLabel(label: string) {
    return label
        .replaceAll("\\", "\\\\")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
}

function textBeforeFence(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

function ensureTrailingNewline(text: string) {
    return text.endsWith("\n") ? text : `${text}\n`;
}

function sanitizedRawHtmlFromMetadata(element: HTMLElement) {
    return sanitizeClipboardHtml(
        element.getAttribute("data-mdx-html") ?? element.textContent ?? "",
    );
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
