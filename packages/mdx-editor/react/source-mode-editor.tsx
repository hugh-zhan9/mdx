"use client";

export interface SourceModeEditorProps {
    markdown: string;
    onMarkdownChange: (markdown: string) => void;
}

export function SourceModeEditor({
    markdown,
    onMarkdownChange,
}: SourceModeEditorProps) {
    return (
        <textarea
            aria-label="Markdown source"
            className="min-h-full w-full resize-none font-mono text-sm"
            data-mdx-source-mode
            value={markdown}
            onChange={(event) => onMarkdownChange(event.currentTarget.value)}
        />
    );
}
