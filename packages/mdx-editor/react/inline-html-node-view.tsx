"use client";

import type { ChangeEvent, FocusEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { NodeViewProps } from "./node-views";

export function InlineHtmlNodeView({ node, updateAttrs }: NodeViewProps) {
    const html = String(node.attrs.html ?? "");
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const rootRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
        const nextHtml = event.currentTarget.value;
        updateAttrs({
            html: nextHtml,
            tag: firstHtmlTag(nextHtml),
            text: inlineHtmlText(nextHtml),
        });
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

    return (
        <span
            ref={rootRef}
            className="mdx-inline-html"
            contentEditable={false}
            data-mdx-editing={editing ? "true" : "false"}
            onBlur={handleBlur}
        >
            {editing ? (
                <input
                    aria-label="Inline HTML source"
                    className="mdx-inline-html-control"
                    ref={inputRef}
                    value={html}
                    onChange={handleChange}
                    type="text"
                />
            ) : (
                <button
                    aria-label="Edit inline HTML"
                    className="mdx-inline-html-preview"
                    onClick={() => setEditing(true)}
                    type="button"
                >
                    {inlineHtmlPreview(html)}
                </button>
            )}
        </span>
    );
}

function inlineHtmlPreview(html: string) {
    const tag = firstHtmlTag(html);
    const text = inlineHtmlText(html);

    // 白名单标签直接渲染
    const safeRenderTags = ["kbd", "mark", "sup", "sub", "abbr", "cite", "var", "samp", "time", "small", "code"];

    if (tag && safeRenderTags.includes(tag)) {
        // 使用 dangerouslySetInnerHTML 渲染已经通过 parser 白名单验证的 HTML
        return (
            <span
                className="mdx-inline-html-rendered"
                dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(html) }}
            />
        );
    }

    return <span className="mdx-inline-html-fallback">{tag ?? "html"}</span>;
}

function sanitizeInlineHtml(html: string): string {
    if (typeof DOMParser === "undefined") {
        return escapeHtml(html);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // 移除危险属性（事件处理器和 javascript: 协议）
    for (const element of Array.from(doc.body.querySelectorAll("*"))) {
        for (const attr of Array.from(element.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();

            if (
                name.startsWith("on") ||
                value.startsWith("javascript:") ||
                value.startsWith("data:text/html")
            ) {
                element.removeAttribute(attr.name);
            }
        }
    }

    return doc.body.innerHTML;
}

function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function firstHtmlTag(html: string) {
    return html.match(/^\s*<([a-zA-Z][\w:-]*)\b/)?.[1]?.toLowerCase() ?? null;
}

function inlineHtmlText(html: string) {
    return html.replace(/<[^>]*>/g, "").trim();
}
