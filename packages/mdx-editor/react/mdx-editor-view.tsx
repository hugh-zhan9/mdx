"use client";

import { useEffect, useRef } from "react";
import { useMdxEditor } from "./mdx-editor-context";

export function MdxEditorView() {
    const { registerRoot } = useMdxEditor();
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        registerRoot(rootRef.current);

        return () => {
            registerRoot(null);
        };
    }, [registerRoot]);

    return (
        <div
            ref={rootRef}
            data-mdx-editor-root
            data-mdx-node-type="doc"
            data-mdx-editor-view
            data-mdx-text
            tabIndex={0}
        />
    );
}
