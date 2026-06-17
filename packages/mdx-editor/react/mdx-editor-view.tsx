"use client";

import { useEffect, useRef } from "react";
import { useMdxEditor } from "./mdx-editor-context";

export function MdxEditorView() {
    const editor = useMdxEditor();
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        editor.registerRoot(rootRef.current);

        return () => {
            editor.registerRoot(null);
        };
    }, [editor]);

    return (
        <div
            ref={rootRef}
            data-mdx-editor-root
            data-mdx-node-type="doc"
            data-mdx-editor-view
            data-mdx-text
            tabIndex={0}
        >
            {editor.currentMarkdown}
        </div>
    );
}
