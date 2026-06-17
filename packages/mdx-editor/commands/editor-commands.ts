export function insertPlainTextMarkdown(
    markdown: string,
    offset: number,
    text: string,
): string {
    const cursor = Math.max(0, Math.min(offset, markdown.length));

    return `${markdown.slice(0, cursor)}${text}${markdown.slice(cursor)}`;
}

export function insertImageMarkdown(
    markdown: string,
    offset: number,
    url: string,
    altText = "",
): string {
    return insertPlainTextMarkdown(
        markdown,
        offset,
        `![${escapeImageAlt(altText)}](${url})`,
    );
}

function escapeImageAlt(text: string): string {
    return text.replace(/]/g, "\\]");
}
