import type { Mark, Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";
import { tryParseFootnoteRef } from "../syntax/footnote/parse";

export function parseInlineMarkdown(
    text: string,
    schema: Schema = mdxEditorSchema,
): ProseMirrorNode[] {
    const children: ProseMirrorNode[] = [];
    let cursor = 0;
    let buffer = "";

    while (cursor < text.length) {
        const image = tryParseImage(text, cursor);
        if (image) {
            pushText(schema, children, buffer);
            buffer = "";
            children.push(
                schema.nodes.image.create({
                    src: image.src,
                    alt: image.alt,
                    title: image.title,
                }),
            );
            cursor = image.nextIndex;
            continue;
        }

        const wikilink = tryParseWikilink(text, cursor);
        if (wikilink) {
            pushText(schema, children, buffer);
            buffer = "";
            pushInlineNodesWithMark(
                schema,
                children,
                parseInlineMarkdown(wikilink.rawLabel, schema),
                schema.marks.link.create({
                    href: `mdx-wikilink:${encodeWikilinkPayload(wikilink.payload)}`,
                }),
            );
            cursor = wikilink.nextIndex;
            continue;
        }

        const link = tryParseLink(text, cursor);
        if (link) {
            pushText(schema, children, buffer);
            buffer = "";
            const linkMark = schema.marks.link.create({
                href: link.href,
                title: link.title,
            });

            if (link.rawLabel.length > 0) {
                pushInlineNodesWithMark(
                    schema,
                    children,
                    parseInlineMarkdown(link.rawLabel, schema),
                    linkMark,
                );
            } else {
                pushText(schema, children, link.href, [linkMark]);
            }
            cursor = link.nextIndex;
            continue;
        }

        const autolink = tryParseAutolink(text, cursor);
        if (autolink) {
            pushText(schema, children, buffer);
            buffer = "";
            pushText(
                schema,
                children,
                autolink.text,
                [
                    schema.marks.link.create({
                        href: autolink.href,
                        title: null,
                    }),
                ],
            );
            cursor = autolink.nextIndex;
            continue;
        }

        const footnoteRef = tryParseFootnoteRef(text, cursor);
        if (footnoteRef) {
            pushText(schema, children, buffer);
            buffer = "";
            children.push(
                schema.nodes.footnote_ref.create({
                    label: footnoteRef.label,
                }),
            );
            cursor = footnoteRef.nextIndex;
            continue;
        }

        const inlineMath = tryParseDelimitedInline(text, cursor, "$", "$", {
            preserveEscapes: true,
        });
        if (inlineMath) {
            pushText(schema, children, buffer);
            buffer = "";
            children.push(
                schema.nodes.math_inline.create({
                    latex: decodeMathEscapes(inlineMath.content),
                }),
            );
            cursor = inlineMath.nextIndex;
            continue;
        }

        const inlineHtml = tryParseInlineHtml(text, cursor);
        if (inlineHtml) {
            pushText(schema, children, buffer);
            buffer = "";
            children.push(
                schema.nodes.inline_html.create({
                    html: inlineHtml.html,
                    tag: inlineHtml.tag,
                    text: inlineHtml.content,
                }),
            );
            cursor = inlineHtml.nextIndex;
            continue;
        }

        const inlineCode = tryParseInlineCode(text, cursor);
        if (inlineCode) {
            pushMarkedText(
                schema,
                children,
                buffer,
                inlineCode.content,
                schema.marks.inline_code.create(),
            );
            buffer = "";
            cursor = inlineCode.nextIndex;
            continue;
        }

        const strong = tryParseDelimitedInline(text, cursor, "**", "**");
        if (strong) {
            pushText(schema, children, buffer);
            pushInlineNodesWithMark(
                schema,
                children,
                parseInlineMarkdown(strong.content, schema),
                schema.marks.strong.create(),
            );
            buffer = "";
            cursor = strong.nextIndex;
            continue;
        }

        const strike = tryParseDelimitedInline(text, cursor, "~~", "~~");
        if (strike) {
            pushText(schema, children, buffer);
            pushInlineNodesWithMark(
                schema,
                children,
                parseInlineMarkdown(strike.content, schema),
                schema.marks.strike.create(),
            );
            buffer = "";
            cursor = strike.nextIndex;
            continue;
        }

        const emphasis = tryParseDelimitedInline(text, cursor, "*", "*");
        if (emphasis) {
            pushText(schema, children, buffer);
            pushInlineNodesWithMark(
                schema,
                children,
                parseInlineMarkdown(emphasis.content, schema),
                schema.marks.emphasis.create(),
            );
            buffer = "";
            cursor = emphasis.nextIndex;
            continue;
        }

        const escaped = tryParseEscapedChar(text, cursor);
        if (escaped) {
            buffer += escaped.value;
            cursor = escaped.nextIndex;
            continue;
        }

        buffer += text[cursor];
        cursor += 1;
    }

    pushText(schema, children, buffer);
    return children;
}

function encodeWikilinkPayload(payload: string): string {
    return encodeURIComponent(payload).replace(/[()]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function pushMarkedText(
    schema: Schema,
    children: ProseMirrorNode[],
    pendingText: string,
    markedText: string,
    mark: Mark,
) {
    pushText(schema, children, pendingText);
    pushText(schema, children, markedText, [mark]);
}

function pushText(
    schema: Schema,
    children: ProseMirrorNode[],
    text: string,
    marks?: readonly Mark[],
) {
    if (text.length > 0) {
        children.push(schema.text(text, marks));
    }
}

function pushInlineNodesWithMark(
    schema: Schema,
    children: ProseMirrorNode[],
    nodes: ProseMirrorNode[],
    mark: Mark,
) {
    for (const node of nodes) {
        if (node.isText) {
            pushText(schema, children, node.text ?? "", mark.addToSet(node.marks));
        } else {
            children.push(node.mark(mark.addToSet(node.marks)));
        }
    }
}

function tryParseEscapedChar(text: string, startIndex: number) {
    if (text[startIndex] !== "\\" || startIndex + 1 >= text.length) {
        return null;
    }

    return {
        value: text[startIndex + 1],
        nextIndex: startIndex + 2,
    };
}

function tryParseWikilink(text: string, startIndex: number) {
    if (!text.startsWith("[[", startIndex)) {
        return null;
    }

    let cursor = startIndex + 2;
    while (cursor < text.length) {
        if (text[cursor] === "\\" && cursor + 1 < text.length) {
            cursor += 2;
            continue;
        }

        if (text[cursor] === "]" && text[cursor + 1] === "]") {
            const body = text.slice(startIndex + 2, cursor);
            const separatorIndex = findUnescaped(body, "|");
            const rawTarget =
                separatorIndex >= 0 ? body.slice(0, separatorIndex) : body;
            const rawLabel =
                separatorIndex >= 0 ? body.slice(separatorIndex + 1) : rawTarget;
            const target = decodeEscapes(rawTarget);
            const label = decodeEscapes(rawLabel);

            return {
                label,
                rawLabel,
                payload:
                    separatorIndex >= 0 ? `${target}|${label}` : target,
                nextIndex: cursor + 2,
            };
        }

        cursor += 1;
    }

    return null;
}

function tryParseImage(text: string, startIndex: number) {
    if (text[startIndex] !== "!" || text[startIndex + 1] !== "[") {
        return null;
    }

    const link = tryParseLink(text, startIndex + 1);
    if (!link) {
        return null;
    }

    if (link.href.length === 0) {
        return null;
    }

    return {
        alt: link.label.length > 0 ? link.label : link.href,
        src: link.href,
        title: link.title,
        nextIndex: link.nextIndex,
    };
}

function tryParseAutolink(text: string, startIndex: number) {
    if (startIndex > 0 && !isAutolinkBoundary(text[startIndex - 1])) {
        return null;
    }

    const url = tryParseBareUrl(text, startIndex);
    if (url) {
        return url;
    }

    return tryParseBareEmail(text, startIndex);
}

function tryParseBareUrl(text: string, startIndex: number) {
    const scheme = text.slice(startIndex).match(/^(https?:\/\/)/i);
    if (!scheme) {
        return null;
    }

    let cursor = startIndex + scheme[1].length;
    while (cursor < text.length && !/\s/.test(text[cursor])) {
        cursor += 1;
    }

    const end = trimAutolinkEnd(text, startIndex, cursor);
    if (end <= startIndex + scheme[1].length) {
        return null;
    }

    const href = text.slice(startIndex, end);
    return {
        href,
        nextIndex: end,
        text: href,
    };
}

function tryParseBareEmail(text: string, startIndex: number) {
    const match = text
        .slice(startIndex)
        .match(/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/);
    if (!match) {
        return null;
    }

    const email = match[0];
    return {
        href: `mailto:${email}`,
        nextIndex: startIndex + email.length,
        text: email,
    };
}

function isAutolinkBoundary(char: string) {
    return /\s|[(<[{]/.test(char);
}

function trimAutolinkEnd(text: string, startIndex: number, endIndex: number) {
    let end = endIndex;
    while (end > startIndex && /[.,!?;:]/.test(text[end - 1])) {
        end -= 1;
    }

    while (
        end > startIndex &&
        text[end - 1] === ")" &&
        countChar(text.slice(startIndex, end), ")") >
            countChar(text.slice(startIndex, end), "(")
    ) {
        end -= 1;
    }

    return end;
}

function countChar(text: string, char: string) {
    let count = 0;
    for (const current of text) {
        if (current === char) {
            count += 1;
        }
    }
    return count;
}

function tryParseLink(text: string, startIndex: number) {
    if (text[startIndex] !== "[" || text[startIndex + 1] === "[") {
        return null;
    }

    const labelEnd = findLinkLabelEnd(text, startIndex);
    if (labelEnd < 0 || text[labelEnd + 1] !== "(") {
        return null;
    }

    const rawLabel = text.slice(startIndex + 1, labelEnd);
    let cursor = labelEnd + 2;
    let href = "";

    if (text[cursor] === "<") {
        cursor += 1;
        while (cursor < text.length) {
            const current = text[cursor];
            if (current === "\\" && cursor + 1 < text.length) {
                href += text[cursor + 1];
                cursor += 2;
                continue;
            }

            if (current === ">") {
                cursor += 1;
                break;
            }

            href += current;
            cursor += 1;
        }

        if (text[cursor - 1] !== ">") {
            return null;
        }

        while (cursor < text.length && /\s/.test(text[cursor])) {
            cursor += 1;
        }

        if (text[cursor] === ")") {
            if (href.length === 0) {
                return null;
            }

            return {
                label: decodeEscapes(rawLabel),
                rawLabel,
                href,
                title: null,
                nextIndex: cursor + 1,
            };
        }
    } else {
        while (cursor < text.length) {
            const current = text[cursor];
            if (current === "\\" && cursor + 1 < text.length) {
                href += text[cursor + 1];
                cursor += 2;
                continue;
            }

            if (current === ")") {
                if (href.length === 0) {
                    return null;
                }

                return {
                    label: decodeEscapes(rawLabel),
                    rawLabel,
                    href,
                    title: null,
                    nextIndex: cursor + 1,
                };
            }

            if (/\s/.test(current)) {
                break;
            }

            href += current;
            cursor += 1;
        }
    }

    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
    }

    if (text[cursor] !== '"') {
        return null;
    }

    cursor += 1;
    let title = "";
    while (cursor < text.length) {
        const current = text[cursor];
        if (current === "\\" && cursor + 1 < text.length) {
            title += text[cursor + 1];
            cursor += 2;
            continue;
        }

        if (current === '"') {
            cursor += 1;
            break;
        }

        title += current;
        cursor += 1;
    }

    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
    }

    if (text[cursor] !== ")") {
        return null;
    }

    if (href.length === 0) {
        return null;
    }

    return {
        label: decodeEscapes(rawLabel),
        rawLabel,
        href,
        title,
        nextIndex: cursor + 1,
    };
}

function tryParseInlineCode(text: string, startIndex: number) {
    if (text[startIndex] !== "`") {
        return null;
    }

    let openerLength = 0;
    while (text[startIndex + openerLength] === "`") {
        openerLength += 1;
    }

    const opener = "`".repeat(openerLength);
    const contentStart = startIndex + openerLength;
    const closeIndex = text.indexOf(opener, contentStart);
    if (closeIndex < 0) {
        return null;
    }

    const rawContent = text.slice(contentStart, closeIndex);

    return {
        content: trimCodeSpanPadding(rawContent),
        nextIndex: closeIndex + openerLength,
    };
}

function tryParseInlineHtml(text: string, startIndex: number) {
    // 安全的行内 HTML 标签白名单
    const safeInlineTags = [
        "kbd",
        "mark",
        "sup",
        "sub",
        "abbr",
        "cite",
        "var",
        "samp",
        "time",
        "small",
        "code",
    ];

    // 匹配开始标签：<tag> 或 <tag attr="value">
    const tagMatch = text.slice(startIndex).match(/^<([a-zA-Z][\w:-]*)\b([^>]*)>/);
    if (!tagMatch) {
        return null;
    }

    const tag = tagMatch[1].toLowerCase();
    if (!safeInlineTags.includes(tag)) {
        return null;
    }

    const openTagLength = tagMatch[0].length;
    const contentStart = startIndex + openTagLength;
    const closeTag = `</${tag}>`;
    const closeIndex = text.indexOf(closeTag, contentStart);

    if (closeIndex < 0) {
        return null;
    }

    const content = text.slice(contentStart, closeIndex);
    const html = text.slice(startIndex, closeIndex + closeTag.length);

    return {
        content,
        html,
        tag,
        nextIndex: closeIndex + closeTag.length,
    };
}

function trimCodeSpanPadding(content: string) {
    if (
        content.length >= 3 &&
        content.startsWith(" ") &&
        content.endsWith(" ")
    ) {
        const inner = content.slice(1, -1);
        if (inner.startsWith("`") || inner.endsWith("`")) {
            return inner;
        }
    }

    return content;
}

function tryParseDelimitedInline(
    text: string,
    startIndex: number,
    opener: string,
    closer: string,
    options: { preserveEscapes?: boolean } = {},
) {
    if (!text.startsWith(opener, startIndex)) {
        return null;
    }

    if (
        opener === "$" &&
        (text[startIndex + 1] === "$" || text[startIndex - 1] === "$")
    ) {
        return null;
    }

    const contentStart = startIndex + opener.length;
    const closeIndex = findUnescapedToken(text, closer, contentStart);
    if (closeIndex < 0 || closeIndex === contentStart) {
        return null;
    }

    if (closer === "$" && text[closeIndex + 1] === "$") {
        return null;
    }

    return {
        content: options.preserveEscapes
            ? text.slice(contentStart, closeIndex)
            : decodeEscapes(text.slice(contentStart, closeIndex)),
        nextIndex: closeIndex + closer.length,
    };
}

function findUnescaped(
    text: string,
    target: string,
    startIndex = 0,
) {
    for (let index = startIndex; index < text.length; index += 1) {
        if (text[index] === "\\" && index + 1 < text.length) {
            index += 1;
            continue;
        }

        if (text[index] === target) {
            return index;
        }
    }

    return -1;
}

function findLinkLabelEnd(text: string, startIndex: number) {
    let depth = 0;
    for (let index = startIndex; index < text.length; index += 1) {
        if (text[index] === "\\" && index + 1 < text.length) {
            index += 1;
            continue;
        }

        if (text[index] === "[") {
            depth += 1;
            continue;
        }

        if (text[index] === "]") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function findUnescapedToken(text: string, target: string, startIndex = 0) {
    for (let index = startIndex; index < text.length; index += 1) {
        if (text[index] === "\\" && index + 1 < text.length) {
            index += 1;
            continue;
        }

        if (text.startsWith(target, index)) {
            return index;
        }
    }

    return -1;
}

function decodeEscapes(text: string) {
    return text.replace(/\\(.)/g, "$1");
}

function decodeMathEscapes(text: string) {
    return text.replace(/\\([\\$])/g, "$1");
}
