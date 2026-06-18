import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { mdxEditorSchema } from "../schema/schema";

export function parseInlineMarkdown(text: string): ProseMirrorNode[] {
    const children: ProseMirrorNode[] = [];
    let cursor = 0;
    let buffer = "";

    while (cursor < text.length) {
        const image = tryParseImage(text, cursor);
        if (image) {
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.nodes.image.create({
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
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.text(wikilink.label, [
                    mdxEditorSchema.marks.link.create({
                        href: `mdx-wikilink:${encodeURIComponent(wikilink.payload)}`,
                    }),
                ]),
            );
            cursor = wikilink.nextIndex;
            continue;
        }

        const link = tryParseLink(text, cursor);
        if (link) {
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.text(link.label, [
                    mdxEditorSchema.marks.link.create({
                        href: link.href,
                        title: link.title,
                    }),
                ]),
            );
            cursor = link.nextIndex;
            continue;
        }

        const footnoteRef = tryParseFootnoteRef(text, cursor);
        if (footnoteRef) {
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.nodes.footnote_ref.create({
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
            pushText(children, buffer);
            buffer = "";
            children.push(
                mdxEditorSchema.nodes.math_inline.create({
                    latex: inlineMath.content,
                }),
            );
            cursor = inlineMath.nextIndex;
            continue;
        }

        const inlineCode = tryParseDelimitedInline(text, cursor, "`", "`", {
            preserveEscapes: true,
        });
        if (inlineCode) {
            pushMarkedText(
                children,
                buffer,
                inlineCode.content,
                mdxEditorSchema.marks.inline_code.create(),
            );
            buffer = "";
            cursor = inlineCode.nextIndex;
            continue;
        }

        const strong = tryParseDelimitedInline(text, cursor, "**", "**");
        if (strong) {
            pushMarkedText(
                children,
                buffer,
                strong.content,
                mdxEditorSchema.marks.strong.create(),
            );
            buffer = "";
            cursor = strong.nextIndex;
            continue;
        }

        const strike = tryParseDelimitedInline(text, cursor, "~~", "~~");
        if (strike) {
            pushMarkedText(
                children,
                buffer,
                strike.content,
                mdxEditorSchema.marks.strike.create(),
            );
            buffer = "";
            cursor = strike.nextIndex;
            continue;
        }

        const emphasis = tryParseDelimitedInline(text, cursor, "*", "*");
        if (emphasis) {
            pushMarkedText(
                children,
                buffer,
                emphasis.content,
                mdxEditorSchema.marks.emphasis.create(),
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

    pushText(children, buffer);
    return children;
}

function pushMarkedText(
    children: ProseMirrorNode[],
    pendingText: string,
    markedText: string,
    mark: Mark,
) {
    pushText(children, pendingText);
    pushText(children, markedText, [mark]);
}

function pushText(children: ProseMirrorNode[], text: string, marks?: Mark[]) {
    if (text.length > 0) {
        children.push(mdxEditorSchema.text(text, marks));
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

    return {
        alt: link.label,
        src: link.href,
        title: link.title,
        nextIndex: link.nextIndex,
    };
}

function tryParseLink(text: string, startIndex: number) {
    if (text[startIndex] !== "[" || text[startIndex + 1] === "[") {
        return null;
    }

    const labelEnd = findUnescaped(text, "]", startIndex + 1);
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
            return {
                label: decodeEscapes(rawLabel),
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
                return {
                    label: decodeEscapes(rawLabel),
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

    return {
        label: decodeEscapes(rawLabel),
        href,
        title,
        nextIndex: cursor + 1,
    };
}

function tryParseFootnoteRef(text: string, startIndex: number) {
    if (!text.startsWith("[^", startIndex)) {
        return null;
    }

    const labelEnd = findUnescaped(text, "]", startIndex + 2);
    if (labelEnd < 0) {
        return null;
    }

    const rawLabel = text.slice(startIndex + 2, labelEnd);
    if (rawLabel.length === 0) {
        return null;
    }

    return {
        label: decodeEscapes(rawLabel),
        nextIndex: labelEnd + 1,
    };
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

    if (
        closer === "$" &&
        (text[closeIndex - 1] === "$" || text[closeIndex + 1] === "$")
    ) {
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
