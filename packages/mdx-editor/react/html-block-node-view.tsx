"use client";

import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { NodeViewProps } from "./node-views";

export function HtmlBlockNodeView({
    editingRequest,
    node,
    updateAttrs,
}: NodeViewProps) {
    const html = String(node.attrs.html || node.textContent || "");
    const tag = String(node.attrs.tag || "");
    const [editing, setEditing] = useState(false);
    const collapsed = Boolean(node.attrs.collapsed);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const lastEditingRequestRef = useRef(editingRequest ?? 0);

    useEffect(() => {
        if (editing) {
            textareaRef.current?.focus();
        }
    }, [editing]);

    useEffect(() => {
        const nextRequest = editingRequest ?? 0;
        if (nextRequest === lastEditingRequestRef.current) {
            return;
        }

        lastEditingRequestRef.current = nextRequest;
        queueMicrotask(() => setEditing(true));
    }, [editingRequest]);

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
        // summary keeps its native details toggle; the rest of details opens source.
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

    function handlePreviewDoubleClick(event: MouseEvent<HTMLDivElement>) {
        if (!isSummaryTarget(event.target, event.currentTarget)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        openEditor();
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
                    onDoubleClickCapture={handlePreviewDoubleClick}
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

function isSummaryTarget(target: EventTarget, root: HTMLElement) {
    return Boolean(getEventTargetElement(target, root)?.closest("summary"));
}

function isInteractiveHtmlTarget(target: EventTarget, root: HTMLElement) {
    const element = getEventTargetElement(target, root);

    if (!element || element === root) {
        return false;
    }

    return Boolean(
        element.closest(
            [
                "a",
                "button",
                "summary",
                "input",
                "select",
                "textarea",
                "label",
                "[contenteditable='true']",
            ].join(","),
        ),
    );
}

function getEventTargetElement(target: EventTarget, root: HTMLElement) {
    if (target instanceof Element) {
        return target;
    }

    if (target instanceof Node && root.contains(target)) {
        return target.parentElement;
    }

    return null;
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
