"use client";

import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { NodeViewProps } from "./node-views";

export function SourceFallbackNodeView({
    editingRequest,
    node,
    updateAttrs,
}: NodeViewProps) {
    const markdown = String(node.attrs.markdown || node.textContent || "");
    const [editing, setEditing] = useState(false);
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
        updateAttrs({ markdown: event.currentTarget.value });
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

    return (
        <div
            ref={rootRef}
            data-mdx-node-type="source_fallback"
            className="mdx-source-fallback"
            data-mdx-editing={editing ? "true" : "false"}
            onBlur={handleBlur}
        >
            {editing ? (
                <textarea
                    aria-label="Markdown source fallback"
                    ref={textareaRef}
                    value={markdown}
                    onChange={handleChange}
                />
            ) : (
                <div
                    aria-label="Edit source fallback"
                    className="mdx-source-fallback-preview"
                    contentEditable={false}
                    onClick={handlePreviewClick}
                    onMouseDownCapture={handlePreviewMouseDown}
                    onKeyDown={handlePreviewKeyDown}
                    role="button"
                    tabIndex={0}
                    dangerouslySetInnerHTML={{
                        __html: sanitizeFallbackHtml(markdown),
                    }}
                />
            )}
        </div>
    );
}

function isInteractiveHtmlTarget(target: EventTarget, root: HTMLElement) {
    const element = eventTargetElement(target, root);
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

function eventTargetElement(target: EventTarget, root: HTMLElement) {
    if (target instanceof Element) {
        return target;
    }

    if (target instanceof Node && root.contains(target)) {
        return target.parentElement;
    }

    return null;
}

function sanitizeFallbackHtml(markdown: string) {
    if (typeof DOMParser === "undefined") {
        return escapeHtml(markdown);
    }

    const parser = new DOMParser();
    const document = parser.parseFromString(markdown, "text/html");

    for (const element of Array.from(
        document.body.querySelectorAll("script, iframe, object, embed"),
    )) {
        element.remove();
    }

    for (const element of Array.from(document.body.querySelectorAll("*"))) {
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

    return document.body.innerHTML || escapeHtml(markdown);
}

function escapeHtml(text: string) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
