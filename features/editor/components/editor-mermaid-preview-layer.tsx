"use client";

import { useEffect, useRef, useState } from "react";
import { findMermaidCodeFences } from "../lib/mermaid-code-fences";
import {
    applyMermaidSourceVisibility,
    mapMermaidFencesToPreElements,
} from "../lib/mermaid-dom";
import {
    renderMermaidDiagram,
    type MermaidEditorTheme,
} from "../lib/mermaid-renderer";

interface EditorMermaidPreviewLayerProps {
    editorRoot: HTMLElement | null;
    markdown: string;
}

interface RenderState {
    error: string | null;
    svg: string | null;
}

const RENDER_DEBOUNCE_MS = 300;

export function EditorMermaidPreviewLayer({
    editorRoot,
    markdown,
}: EditorMermaidPreviewLayerProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const renderStatesRef = useRef(new Map<string, RenderState>());

    useEffect(() => {
        if (!editorRoot) {
            return;
        }

        const fences = findMermaidCodeFences(markdown);
        const mappings = mapMermaidFencesToPreElements(editorRoot, fences);
        const activeIds = new Set(mappings.map((mapping) => mapping.stableId));
        cleanupStalePreviewNodes(editorRoot, activeIds);

        const timers = mappings.map((mapping) => {
            const preview = ensurePreviewNode(mapping.pre, mapping.stableId);
            const state = renderStatesRef.current.get(mapping.stableId) ?? {
                error: null,
                svg: null,
            };
            const isEditing = editingId === mapping.stableId;
            const hasError = Boolean(state.error);

            applyMermaidSourceVisibility(
                mapping.pre,
                hasError ? "error" : isEditing ? "editing" : "preview",
            );
            renderPreviewNode(preview, state, hasError, () =>
                setEditingId(mapping.stableId),
            );

            const timer = window.setTimeout(() => {
                const theme = currentMermaidTheme();
                void renderMermaidDiagram({
                    code: mapping.fence.code,
                    id: `mdx-${mapping.stableId}`,
                    theme,
                }).then((result) => {
                    renderStatesRef.current.set(
                        mapping.stableId,
                        result.ok
                            ? { error: null, svg: result.svg }
                            : { error: result.error, svg: null },
                    );
                    const nextState = renderStatesRef.current.get(
                        mapping.stableId,
                    );
                    if (!nextState) {
                        return;
                    }
                    applyMermaidSourceVisibility(
                        mapping.pre,
                        nextState.error
                            ? "error"
                            : editingId === mapping.stableId
                              ? "editing"
                              : "preview",
                    );
                    renderPreviewNode(
                        preview,
                        nextState,
                        Boolean(nextState.error),
                        () => setEditingId(mapping.stableId),
                    );
                });
            }, RENDER_DEBOUNCE_MS);

            return timer;
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setEditingId(null);
            }
        };
        const handleFocusOut = (event: FocusEvent) => {
            const relatedTarget = event.relatedTarget;

            if (
                editingId &&
                event.target instanceof Node &&
                (!relatedTarget ||
                    (relatedTarget instanceof Node &&
                        !editorRoot.contains(relatedTarget)))
            ) {
                setEditingId(null);
            }
        };

        editorRoot.addEventListener("keydown", handleKeyDown, true);
        editorRoot.addEventListener("focusout", handleFocusOut, true);

        return () => {
            for (const timer of timers) {
                window.clearTimeout(timer);
            }
            editorRoot.removeEventListener("keydown", handleKeyDown, true);
            editorRoot.removeEventListener("focusout", handleFocusOut, true);
        };
    }, [editingId, editorRoot, markdown]);

    return null;
}

function currentMermaidTheme(): MermaidEditorTheme {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function ensurePreviewNode(pre: HTMLPreElement, stableId: string): HTMLElement {
    const existing = pre.nextElementSibling;
    if (
        existing instanceof HTMLElement &&
        existing.dataset.mdxMermaidPreview === stableId
    ) {
        return existing;
    }

    const node = document.createElement("div");
    node.dataset.mdxMermaidPreview = stableId;
    node.className = "mdx-mermaid-preview";
    node.contentEditable = "false";
    pre.after(node);
    return node;
}

function renderPreviewNode(
    node: HTMLElement,
    state: RenderState,
    hasError: boolean,
    onEdit: () => void,
) {
    node.replaceChildren();
    node.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onEdit();
    };

    const toolbar = document.createElement("div");
    toolbar.className = "mdx-mermaid-preview-toolbar";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "编辑";
    button.className = "mdx-mermaid-edit-button";
    toolbar.append(button);
    node.append(toolbar);

    if (hasError) {
        const error = document.createElement("div");
        error.className = "mdx-mermaid-error";
        error.textContent = "Mermaid 语法无法渲染";
        error.title = state.error ?? "";
        node.append(error);
        return;
    }

    const output = document.createElement("div");
    output.className = "mdx-mermaid-svg";
    output.innerHTML = state.svg ?? "";
    node.append(output);
}

function cleanupStalePreviewNodes(
    editorRoot: HTMLElement,
    activeIds: Set<string>,
): void {
    for (const node of Array.from(
        editorRoot.querySelectorAll<HTMLElement>("[data-mdx-mermaid-preview]"),
    )) {
        const id = node.dataset.mdxMermaidPreview;
        if (!id || !activeIds.has(id)) {
            node.remove();
        }
    }
}
