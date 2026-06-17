export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, "\n");
}

export function expectMarkdownEqual(actual: string, expected: string) {
    expect(normalizeLineEndings(actual)).toBe(normalizeLineEndings(expected));
}
