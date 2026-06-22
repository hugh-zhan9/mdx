"use client";

import type { ChangeEvent, FocusEvent } from "react";
import { useEffect, useRef, useState } from "react";
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
    const [editing, setEditing] = useState(false);
    const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
        null,
    );
    const rootRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
        if (editing) {
            controlRef.current?.focus();
        }
    }, [editing]);

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

    function handleBlur(event: FocusEvent) {
        const relatedTarget = event.relatedTarget;
        if (
            relatedTarget instanceof Node &&
            rootRef.current?.contains(relatedTarget)
        ) {
            return;
        }

        setEditing(false);
    }

    const control = inline ? (
        <input
            aria-label="Inline math"
            ref={(element) => {
                controlRef.current = element;
            }}
            value={latex}
            onChange={handleChange}
            type="text"
        />
    ) : (
        <textarea
            aria-label="Math block"
            ref={(element) => {
                controlRef.current = element;
            }}
            value={latex}
            onChange={handleChange}
        />
    );

    return (
        <span
            ref={rootRef}
            className={inline ? "mdx-math-node mdx-math-inline" : "mdx-math-node"}
            data-mdx-node-type={inline ? "math_inline" : "math_block"}
            data-mdx-latex={inline ? latex : undefined}
            data-mdx-editing={editing ? "true" : "false"}
            onBlur={handleBlur}
        >
            <span
                className="mdx-math-preview"
                contentEditable={false}
                onClick={() => setEditing(true)}
            >
                {rendered.error ? (
                    <code>{latex}</code>
                ) : (
                    <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
                )}
                {rendered.error ? (
                    <span className="mdx-math-error">{rendered.error}</span>
                ) : null}
            </span>
            {editing ? (
                <span className="mdx-math-control" contentEditable={false}>
                    {control}
                </span>
            ) : null}
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
