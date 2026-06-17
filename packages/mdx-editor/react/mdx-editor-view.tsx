"use client";

import { useMdxEditor } from "./mdx-editor-context";

export function MdxEditorView() {
    const editor = useMdxEditor();

    return (
        <div data-mdx-editor-view data-mdx-text>
            {editor.currentMarkdown}
        </div>
    );
}
