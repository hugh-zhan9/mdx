"use client";

import type { ChangeEvent } from "react";
import katex from "katex";
import type { NodeViewProps } from "./node-views";

interface MathNodeViewProps extends NodeViewProps {
    inline?: boolean;
    updateText?: (text: string) => void;
}

export function MathNodeView({
    inline = false,
    node,
    updateAttrs,
    updateText,
}: MathNodeViewProps) {
    const latex = inline ? String(node.attrs.latex ?? "") : node.textContent;
    const rendered = renderLatex(latex, inline);

    function handleChange(
        event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) {
        const value = event.currentTarget.value;
        if (inline) {
            updateAttrs({ latex: value });
            return;
        }

        updateText?.(value);
    }

    const control = inline ? (
        <input
            aria-label="Inline math"
            value={latex}
            onChange={handleChange}
            type="text"
        />
    ) : (
        <textarea
            aria-label="Math block"
            value={latex}
            onChange={handleChange}
        />
    );

    return (
        <span
            className={inline ? "mdx-math-node mdx-math-inline" : "mdx-math-node"}
            data-mdx-node-type={inline ? "math_inline" : "math_block"}
            data-mdx-latex={inline ? latex : undefined}
        >
            <span className="mdx-math-preview" contentEditable={false}>
                {rendered.error ? (
                    <code>{latex}</code>
                ) : (
                    <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
                )}
                {rendered.error ? (
                    <span className="mdx-math-error">{rendered.error}</span>
                ) : null}
            </span>
            <span className="mdx-math-control" contentEditable={false}>
                {control}
            </span>
        </span>
    );
}

function renderLatex(latex: string, inline: boolean) {
    try {
        return {
            error: "",
            html: katex.renderToString(latex, {
                displayMode: !inline,
                throwOnError: true,
            }),
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : "Invalid math",
            html: "",
        };
    }
}
