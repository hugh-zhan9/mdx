"use client";

import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { NodeViewProps } from "./node-views";

export function HtmlBlockNodeView({ node, updateAttrs }: NodeViewProps) {
    const html = String(node.attrs.html || node.textContent || "");
    const tag = String(node.attrs.tag || "");
    const [editing, setEditing] = useState(false);
    const [collapsed, setCollapsed] = useState(Boolean(node.attrs.collapsed));
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (editing) {
            textareaRef.current?.focus();
        }
    }, [editing]);

    function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
        const nextHtml = event.currentTarget.value;
        updateAttrs({ html: nextHtml });
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

    function openEditor() {
        setEditing(true);
    }

    function handlePreviewClick(event: MouseEvent<HTMLDivElement>) {
        // 如果点击的是交互元素（如 details/summary），不进入编辑模式
        if (isInteractiveHtmlTarget(event.target, event.currentTarget)) {
            return;
        }

        openEditor();
    }

    function handlePreviewMouseDown(event: MouseEvent<HTMLDivElement>) {
        if (isInteractiveHtmlTarget(event.target, event.currentTarget)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        openEditor();
    }

    function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        openEditor();
    }

    function handleDetailsToggle(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (target.tagName === "SUMMARY") {
            const newCollapsed = !collapsed;
            setCollapsed(newCollapsed);
            updateAttrs({ collapsed: newCollapsed });
        }
    }

    return (
        <div
            ref={rootRef}
            data-mdx-node-type="html_block"
            data-mdx-html-tag={tag}
            className="mdx-html-block"
            data-mdx-editing={editing ? "true" : "false"}
            onBlur={handleBlur}
        >
            {editing ? (
                <textarea
                    aria-label="HTML block source"
                    ref={textareaRef}
                    value={html}
                    onChange={handleChange}
                    className="mdx-html-block-editor"
                />
            ) : (
                <div
                    aria-label="Edit HTML block"
                    className="mdx-html-block-preview"
                    contentEditable={false}
                    onClick={handlePreviewClick}
                    onMouseDownCapture={handlePreviewMouseDown}
                    onKeyDown={handlePreviewKeyDown}
                    role="button"
                    tabIndex={0}
                    dangerouslySetInnerHTML={{
                        __html: sanitizeBlockHtml(html, tag, collapsed),
                    }}
                />
            )}
        </div>
    );
}

function isInteractiveHtmlTarget(target: EventTarget, root: HTMLElement) {
    if (!(target instanceof Element) || target === root) {
        return false;
    }

    return Boolean(
        target.closest(
            [
                "a",
                "button",
                "summary",
                "input",
                "select",
                "textarea",
                "label",
                "details",
                "[contenteditable='true']",
            ].join(","),
        ),
    );
}

function sanitizeBlockHtml(html: string, tag: string, collapsed: boolean): string {
    if (typeof DOMParser === "undefined") {
        return escapeHtml(html);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // 移除危险标签
    for (const element of Array.from(
        doc.body.querySelectorAll("script, iframe, object, embed"),
    )) {
        element.remove();
    }

    // 移除危险属性
    for (const element of Array.from(doc.body.querySelectorAll("*"))) {
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim().toLowerCase();

            if (
                name.startsWith("on") ||
                value.startsWith("javascript:") ||
                value.startsWith("data:text/html")
            ) {
                element.removeAttribute(attribute.name);
            }
        }
    }

    // 对于 details 元素，设置 open 属性
    if (tag === "details") {
        const detailsElement = doc.body.querySelector("details");
        if (detailsElement) {
            if (collapsed) {
                detailsElement.removeAttribute("open");
            } else {
                detailsElement.setAttribute("open", "");
            }
        }
    }

    return doc.body.innerHTML || escapeHtml(html);
}

function escapeHtml(text: string) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
