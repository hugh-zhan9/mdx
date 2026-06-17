"use client";

import { useEffect, useId, useRef, useState } from "react";
import { findMermaidCodeFences } from "../lib/mermaid-code-fences";
import {
    applyMermaidSourceVisibility,
    mapMermaidFencesToPreElements,
    type MermaidPreMapping,
} from "../lib/mermaid-dom";
import { MDX_CODE_BLOCK_SELECTOR } from "../lib/editor-dom-contract";
import {
    renderMermaidDiagram,
    type MermaidEditorTheme,
} from "../lib/mermaid-renderer";

interface EditorMermaidPreviewLayerProps {
    editorRoot: HTMLElement | null;
    markdown: string;
    onVisibilityChange?: () => void;
}

interface RenderState {
    code: string;
    error: string | null;
    svg: string | null;
}

const RENDER_DEBOUNCE_MS = 300;

export function EditorMermaidPreviewLayer({
    editorRoot,
    markdown,
    onVisibilityChange,
}: EditorMermaidPreviewLayerProps) {
    const layerId = useSanitizedLayerId();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editorDomRevision, setEditorDomRevision] = useState(0);
    const [themeRevision, setThemeRevision] = useState(0);
    const generationRef = useRef(0);
    const renderStatesRef = useRef(new Map<string, RenderState>());

    useEffect(() => {
        if (!editorRoot) {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            if (mutations.some(isEditorContentMutation)) {
                setEditorDomRevision((revision) => revision + 1);
            }
        });
        observer.observe(editorRoot, {
            childList: true,
            subtree: true,
        });

        return () => observer.disconnect();
    }, [editorRoot]);

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
        if (!editorRoot) {
            return;
        }

        const generation = generationRef.current + 1;
        generationRef.current = generation;
        let cancelled = false;
        const fences = findMermaidCodeFences(markdown);
        const mappings = mapMermaidFencesToPreElements(editorRoot, fences);
        cleanupStalePreviewNodes(editorRoot, mappings);
        if (restoreUnmappedSourceVisibility(editorRoot, mappings)) {
            onVisibilityChange?.();
        }

        const timers = mappings.map((mapping) => {
            const preview = ensurePreviewNode(mapping.pre, mapping.stableId);
            const cachedState = renderStatesRef.current.get(mapping.stableId);
            const state =
                cachedState?.code === mapping.fence.code
                    ? cachedState
                    : {
                          code: mapping.fence.code,
                          error: null,
                          svg: null,
                      };
            const isEditing = editingId === mapping.stableId;
            const hasError = Boolean(state.error);

            const changed = applyManagedMermaidSourceVisibility(
                mapping.pre,
                hasError ? "error" : isEditing ? "editing" : "preview",
            );
            if (changed) {
                onVisibilityChange?.();
            }
            if (isEditing && !hasError) {
                focusMermaidSource(mapping.pre);
            }
            renderPreviewNode(preview, state, hasError, () =>
                setEditingId(mapping.stableId),
            );

            const timer = window.setTimeout(() => {
                const theme = currentMermaidTheme();
                void renderMermaidDiagram({
                    code: mapping.fence.code,
                    id: `mdx-${layerId}-${mapping.stableId}`,
                    theme,
                }).then((result) => {
                    if (
                        cancelled ||
                        generationRef.current !== generation ||
                        !editorRoot.contains(mapping.pre) ||
                        mapping.pre.nextElementSibling !== preview
                    ) {
                        return;
                    }

                    renderStatesRef.current.set(
                        mapping.stableId,
                        result.ok
                            ? {
                                  code: mapping.fence.code,
                                  error: null,
                                  svg: result.svg,
                              }
                            : {
                                  code: mapping.fence.code,
                                  error: result.error,
                                  svg: null,
                              },
                    );
                    const nextState = renderStatesRef.current.get(
                        mapping.stableId,
                    );
                    if (!nextState) {
                        return;
                    }
                    const changed = applyManagedMermaidSourceVisibility(
                        mapping.pre,
                        nextState.error
                            ? "error"
                            : editingId === mapping.stableId
                              ? "editing"
                              : "preview",
                    );
                    if (changed) {
                        onVisibilityChange?.();
                    }
                    if (editingId === mapping.stableId && !nextState.error) {
                        focusMermaidSource(mapping.pre);
                    }
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
            const editingMapping = mappings.find(
                (mapping) => mapping.stableId === editingId,
            );

            if (
                editingId &&
                event.target instanceof Node &&
                editingMapping &&
                isInsideMermaidEditingBlock(editingMapping, event.target) &&
                (!relatedTarget ||
                    (relatedTarget instanceof Node &&
                        !isInsideMermaidEditingBlock(
                            editingMapping,
                            relatedTarget,
                        )))
            ) {
                setEditingId(null);
            }
        };

        editorRoot.addEventListener("keydown", handleKeyDown, true);
        editorRoot.addEventListener("focusout", handleFocusOut, true);

        return () => {
            cancelled = true;
            for (const timer of timers) {
                window.clearTimeout(timer);
            }
            editorRoot.removeEventListener("keydown", handleKeyDown, true);
            editorRoot.removeEventListener("focusout", handleFocusOut, true);
        };
    }, [
        editingId,
        editorDomRevision,
        editorRoot,
        layerId,
        markdown,
        onVisibilityChange,
        themeRevision,
    ]);

    return null;
}

function useSanitizedLayerId(): string {
    return `layer-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function isEditorContentMutation(mutation: MutationRecord): boolean {
    const changedNodes = [
        ...Array.from(mutation.addedNodes),
        ...Array.from(mutation.removedNodes),
    ];

    if (
        changedNodes.length > 0 &&
        changedNodes.every(isMermaidPreviewNode)
    ) {
        return false;
    }

    return !isMermaidPreviewNode(mutation.target);
}

function isMermaidPreviewNode(node: Node): boolean {
    return (
        node instanceof HTMLElement &&
        (node.dataset.mdxMermaidPreview !== undefined ||
            Boolean(node.closest("[data-mdx-mermaid-preview]")))
    );
}

function currentMermaidTheme(): MermaidEditorTheme {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyManagedMermaidSourceVisibility(
    pre: HTMLPreElement,
    mode: Parameters<typeof applyMermaidSourceVisibility>[1],
): boolean {
    const before = sourceVisibilitySnapshot(pre);
    pre.dataset.mdxMermaidSource = "true";
    applyMermaidSourceVisibility(pre, mode);
    return before !== sourceVisibilitySnapshot(pre);
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

function isInsideMermaidEditingBlock(
    mapping: MermaidPreMapping,
    target: Node,
): boolean {
    const preview = mapping.pre.nextElementSibling;
    return (
        mapping.pre.contains(target) ||
        Boolean(
            preview instanceof HTMLElement &&
                preview.dataset.mdxMermaidPreview === mapping.stableId &&
                preview.contains(target),
        )
    );
}

function focusMermaidSource(pre: HTMLPreElement): void {
    if (pre.contains(document.activeElement)) {
        return;
    }

    if (!pre.hasAttribute("tabindex")) {
        pre.tabIndex = -1;
        pre.dataset.mdxMermaidManagedTabIndex = "true";
    }
    pre.focus({ preventScroll: true });
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
    mappings: MermaidPreMapping[],
): void {
    for (const node of Array.from(
        editorRoot.querySelectorAll<HTMLElement>("[data-mdx-mermaid-preview]"),
    )) {
        const id = node.dataset.mdxMermaidPreview;
        const mapping = mappings.find(
            (currentMapping) => currentMapping.stableId === id,
        );
        const expectedPreview = mapping?.pre.nextElementSibling;

        if (!id || !mapping || node !== expectedPreview) {
            node.remove();
        }
    }
}

function restoreUnmappedSourceVisibility(
    editorRoot: HTMLElement,
    mappings: MermaidPreMapping[],
): boolean {
    const mappedSources = new Set(mappings.map((mapping) => mapping.pre));
    let changed = false;

    for (const pre of Array.from(
        editorRoot.querySelectorAll<HTMLPreElement>(MDX_CODE_BLOCK_SELECTOR),
    )) {
        if (mappedSources.has(pre) || !isManagedMermaidSource(pre)) {
            continue;
        }

        pre.hidden = false;
        pre.removeAttribute("aria-hidden");
        if (
            pre.dataset.mdxMermaidManagedTabIndex === "true" &&
            pre.getAttribute("tabindex") === "-1"
        ) {
            pre.removeAttribute("tabindex");
        }
        delete pre.dataset.mdxMermaidSource;
        delete pre.dataset.mdxMermaidManagedTabIndex;
        pre.classList.remove(
            "mdx-mermaid-source-hidden",
            "mdx-mermaid-source-editing",
            "mdx-mermaid-source-error",
        );
        changed = true;
    }

    return changed;
}

function isManagedMermaidSource(pre: HTMLPreElement): boolean {
    return (
        pre.dataset.mdxMermaidSource === "true" ||
        pre.classList.contains("mdx-mermaid-source-hidden") ||
        pre.classList.contains("mdx-mermaid-source-editing") ||
        pre.classList.contains("mdx-mermaid-source-error")
    );
}

function sourceVisibilitySnapshot(pre: HTMLPreElement): string {
    return JSON.stringify({
        ariaHidden: pre.getAttribute("aria-hidden"),
        editing: pre.classList.contains("mdx-mermaid-source-editing"),
        error: pre.classList.contains("mdx-mermaid-source-error"),
        hidden: pre.hidden,
        hiddenClass: pre.classList.contains("mdx-mermaid-source-hidden"),
        owned: pre.dataset.mdxMermaidSource,
    });
}
