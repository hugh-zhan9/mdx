"use client";

import type { ChangeEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { NodeViewProps } from "./node-views";
import {
    renderMermaidDiagram,
    type MermaidEditorTheme,
} from "./mermaid-renderer";

interface MermaidNodeViewProps extends NodeViewProps {
    updateText?: (text: string) => void;
}

interface RenderState {
    code: string;
    error: string | null;
    svg: string | null;
}

export function MermaidNodeView({ node, updateText }: MermaidNodeViewProps) {
    const code = node.textContent;
    const renderId = useMermaidRenderId(node.attrs.sourceId);
    const [themeRevision, setThemeRevision] = useState(0);
    const [state, setState] = useState<RenderState>({
        code: "",
        error: null,
        svg: null,
    });
    const generationRef = useRef(0);
    const previewId =
        typeof node.attrs.sourceId === "string" && node.attrs.sourceId.length > 0
            ? node.attrs.sourceId
            : "mermaid-node-view";

    useEffect(() => {
        const observer = new MutationObserver((mutations) => {
            if (
                mutations.some(
                    (mutation) =>
                        mutation.type === "attributes" &&
                        mutation.attributeName === "data-theme",
                )
            ) {
                setThemeRevision((revision) => revision + 1);
            }
        });

        observer.observe(document.documentElement, {
            attributeFilter: ["data-theme"],
            attributes: true,
        });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;

        if (code.trim().length === 0) {
            return;
        }

        void renderMermaidDiagram({
            code,
            id: renderId,
            theme: currentMermaidTheme(),
        }).then((result) => {
            if (generationRef.current !== generation) {
                return;
            }

            setState(
                result.ok
                    ? { code, error: null, svg: result.svg }
                    : { code, error: result.error, svg: null },
            );
        });
    }, [code, renderId, themeRevision]);

    function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
        updateText?.(event.currentTarget.value);
    }

    return (
        <div
            className="mdx-mermaid-node"
            data-mdx-node-type="mermaid_block"
            data-mdx-code-block=""
            data-mdx-language="mermaid"
        >
            <textarea
                aria-label="Mermaid source"
                value={code}
                onChange={handleChange}
            />
            <div
                className="mdx-mermaid-preview"
                data-mdx-mermaid-preview={previewId}
                contentEditable={false}
            >
                {state.code === code && state.error ? (
                    <div className="mdx-mermaid-error" title={state.error}>
                        Mermaid 语法无法渲染
                    </div>
                ) : (
                    <div
                        className="mdx-mermaid-svg"
                        dangerouslySetInnerHTML={{
                            __html: state.code === code ? (state.svg ?? "") : "",
                        }}
                    />
                )}
            </div>
        </div>
    );
}

function useMermaidRenderId(sourceId: unknown): string {
    const reactId = useId();
    const suffix =
        typeof sourceId === "string" && sourceId.length > 0
            ? sourceId
            : "mermaid-node-view";

    return `mdx-${reactId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "");
}

function currentMermaidTheme(): MermaidEditorTheme {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
