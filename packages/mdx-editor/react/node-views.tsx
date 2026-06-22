import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { NodeSelection } from "prosemirror-state";
import type {
    EditorView,
    NodeView,
    NodeViewConstructor,
} from "prosemirror-view";
import { CalloutNodeView } from "./callout-node-view";
import { FootnoteNodeView } from "./footnote-node-view";
import { HtmlBlockNodeView } from "./html-block-node-view";
import { InlineHtmlNodeView } from "./inline-html-node-view";
import { MathNodeView } from "./math-node-view";
import { MermaidNodeView } from "./mermaid-node-view";
import { parseInlineMarkdown } from "../parser/inline-markdown";
import { SourceFallbackNodeView } from "./source-fallback-node-view";
import { TableNodeView } from "./table-node-view";
import { TaskListNodeView } from "./task-list-node-view";

const RESOLVED_SOURCE_ATTRIBUTE = "data-mdx-resolved-src";

type ImageLoader = ((src: string) => Promise<string>) & {
    isAvailable?: () => boolean;
};

export interface NodeViewProps {
    editingRequest?: number;
    node: ProseMirrorNode;
    updateAttrs: (attrs: Record<string, unknown>) => void;
    selected?: boolean;
    getPos?: () => number;
}

export interface MdxNodeViewOptions {
    imageLoader?: (src: string) => Promise<string>;
}

export function createMdxNodeViews(
    options: MdxNodeViewOptions = {},
): Record<string, NodeViewConstructor> {
    return {
        callout: createReactNodeView(CalloutNodeView, {
            contentDOMTag: "div",
            domTag: "aside",
        }),
        code_block: createCodeBlockNodeView,
        footnote_definition: createReactNodeView(FootnoteNodeView, {
            contentDOMTag: "div",
            domTag: "section",
        }),
        html_block: createHtmlBlockNodeView,
        image: createImageNodeView(options.imageLoader),
        inline_html: createReactNodeView(InlineHtmlNodeView, {
            className: "mdx-inline-html-node",
            domTag: "span",
            inline: true,
        }),
        math_block: createReactNodeView(MathNodeView, {
            textBacked: true,
        }),
        math_inline: createReactNodeView(MathNodeView, {
            className: "mdx-math-node mdx-math-inline",
            domTag: "span",
            inline: true,
        }),
        mermaid_block: createReactNodeView(MermaidNodeView, {
            textBacked: true,
        }),
        source_fallback: createSourceFallbackNodeView,
        table: createReactNodeView(TableNodeView, {
            className: "mdx-table-wrapper",
            contentDOMTag: "tbody",
            domTag: "div",
            tableControls: true,
        }),
        task_item: createReactNodeView(TaskListNodeView, {
            contentDOMTag: "div",
            domTag: "li",
        }),
    };
}

function createCodeBlockNodeView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
): NodeView {
    const dom = document.createElement("pre");
    const toolbar = document.createElement("div");
    const languageInput = document.createElement("input");
    const contentDOM = document.createElement("code");
    let currentNode = node;

    toolbar.dataset.mdxCodeBlockToolbar = "true";
    toolbar.contentEditable = "false";

    languageInput.type = "text";
    languageInput.autocapitalize = "off";
    languageInput.autocomplete = "off";
    languageInput.spellcheck = false;
    languageInput.setAttribute("aria-label", "Code block language");
    languageInput.placeholder = "language";
    languageInput.dataset.mdxCodeBlockLanguageInput = "true";

    toolbar.append(languageInput);
    dom.append(toolbar, contentDOM);

    const updateAttrs = () => {
        const pos = getPos();
        if (pos === undefined) {
            return;
        }

        const info = languageInput.value.trim();
        view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                info,
                language: firstInfoToken(info),
            }),
        );
    };

    languageInput.addEventListener("change", updateAttrs);
    languageInput.addEventListener("input", () => {
        syncCodeBlockLanguageInputSize(languageInput);
    });
    languageInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            updateAttrs();
            languageInput.blur();
        }
    });
    languageInput.addEventListener("mousedown", (event) => {
        event.stopPropagation();
    });

    const render = () => {
        syncNodeViewAttributes(dom, currentNode);
        dom.setAttribute("data-mdx-code-block", "");
        languageInput.value = codeBlockInfo(currentNode);
        syncCodeBlockLanguageInputSize(languageInput);
    };

    render();

    return {
        contentDOM,
        dom,
        update(nextNode) {
            if (nextNode.type !== currentNode.type) {
                return false;
            }

            currentNode = nextNode;
            render();

            return true;
        },
        ignoreMutation(mutation) {
            return (
                mutation.target === languageInput ||
                toolbar.contains(mutation.target)
            );
        },
        stopEvent(event) {
            return event.target === languageInput;
        },
    };
}

function syncCodeBlockLanguageInputSize(input: HTMLInputElement) {
    const visibleLength = input.value.length || input.placeholder.length;
    input.size = Math.min(Math.max(visibleLength + 1, 5), 18);
}

function createImageNodeView(
    imageLoader?: ImageLoader,
): NodeViewConstructor {
    return (
        node: ProseMirrorNode,
        view: EditorView,
        getPos: () => number | undefined,
    ): NodeView => {
        const dom = document.createElement("span");
        const image = document.createElement("img");
        const fallback = document.createElement("span");
        const sourceInput = document.createElement("textarea");
        let currentNode = node;
        let loadToken = 0;
        let selected = false;

        dom.dataset.mdxNodeType = "image";
        dom.dataset.mdxImageNode = "true";
        dom.contentEditable = "false";

        image.dataset.mdxNodeType = "image";
        image.draggable = false;
        fallback.dataset.mdxImageFallback = "true";
        sourceInput.autocapitalize = "off";
        sourceInput.autocomplete = "off";
        sourceInput.rows = 1;
        sourceInput.spellcheck = false;
        sourceInput.setAttribute("aria-label", "Markdown image source");
        sourceInput.dataset.mdxImageSourceInput = "true";

        image.addEventListener("load", () => {
            dom.dataset.mdxImageError = "false";
        });
        image.addEventListener("error", () => {
            dom.dataset.mdxImageError = "true";
        });
        sourceInput.addEventListener("mousedown", (event) => {
            event.stopPropagation();
        });
        sourceInput.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitImageSourceEdit(currentNode, view, getPos, sourceInput.value);
                sourceInput.blur();
            }

            if (event.key === "Escape") {
                event.preventDefault();
                sourceInput.value = imageMarkdownSource(currentNode);
                sourceInput.blur();
            }
        });
        sourceInput.addEventListener("blur", () => {
            commitImageSourceEdit(currentNode, view, getPos, sourceInput.value);
        });
        sourceInput.addEventListener("input", () => {
            resizeImageSourceInput(sourceInput);
        });
        dom.addEventListener("mousedown", (event) => {
            const pos = getPos();
            if (
                pos === undefined ||
                event.button !== 0 ||
                event.target === sourceInput
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            clearNativeSelection(dom);
            view.dispatch(
                view.state.tr.setSelection(
                    NodeSelection.create(view.state.doc, pos),
                ),
            );
            (view as EditorView & { focus?: () => void }).focus?.();
            clearNativeSelection(dom);
        });

        const render = () => {
            loadToken += 1;
            dom.dataset.mdxImageSelected = selected ? "true" : "false";
            renderImageNode(currentNode, image, fallback, sourceInput, dom);
            void resolveImageNodeSource(
                currentNode,
                image,
                dom,
                imageLoader,
                loadToken,
                () => loadToken,
            );
        };

        dom.append(image, fallback, sourceInput);
        render();

        return {
            dom,
            update(nextNode) {
                if (nextNode.type !== currentNode.type) {
                    return false;
                }

                currentNode = nextNode;
                render();

                return true;
            },
            selectNode() {
                selected = true;
                dom.dataset.mdxImageSelected = "true";
                sourceInput.hidden = false;
                sourceInput.value = imageMarkdownSource(currentNode);
                resizeImageSourceInput(sourceInput);
                sourceInput.ownerDocument.defaultView?.setTimeout(() => {
                    sourceInput.focus();
                    sourceInput.setSelectionRange(
                        0,
                        sourceInput.value.length,
                    );
                }, 0);
            },
            deselectNode() {
                selected = false;
                dom.dataset.mdxImageSelected = "false";
                sourceInput.blur();
                sourceInput.hidden = true;
            },
            ignoreMutation() {
                return true;
            },
            stopEvent(event) {
                return (
                    event.type === "mousedown" ||
                    event.target === sourceInput
                );
            },
        };
    };
}

function clearNativeSelection(element: HTMLElement) {
    const selection = element.ownerDocument.defaultView?.getSelection?.();

    selection?.removeAllRanges();
    element.ownerDocument.defaultView?.setTimeout(() => {
        selection?.removeAllRanges();
    }, 0);
}

function renderImageNode(
    node: ProseMirrorNode,
    image: HTMLImageElement,
    fallback: HTMLSpanElement,
    sourceInput: HTMLTextAreaElement,
    dom: HTMLElement,
) {
    const src = String(node.attrs.src ?? "");
    const alt = String(node.attrs.alt ?? "");
    const title =
        typeof node.attrs.title === "string" ? node.attrs.title : undefined;

    const resolvedSource = image.getAttribute(RESOLVED_SOURCE_ATTRIBUTE);
    if (resolvedSource && resolvedSource !== src) {
        image.removeAttribute(RESOLVED_SOURCE_ATTRIBUTE);
    }

    image.src = src;
    image.alt = alt;
    image.title = title ?? "";
    const markdown = imageMarkdownSource(node);
    fallback.textContent = markdown;
    if (sourceInput.ownerDocument.activeElement !== sourceInput) {
        sourceInput.value = markdown;
        resizeImageSourceInput(sourceInput);
    }
    sourceInput.hidden = dom.dataset.mdxImageSelected !== "true";
    dom.dataset.mdxImageMarkdown = markdown;
    dom.dataset.mdxImageError = src ? "false" : "true";
}

function imageMarkdownSource(node: ProseMirrorNode) {
    const src = String(node.attrs.src ?? "");
    const alt = String(node.attrs.alt ?? "") || src;
    const title =
        typeof node.attrs.title === "string" && node.attrs.title.length > 0
            ? ` "${String(node.attrs.title).replaceAll('"', '\\"')}"`
            : "";

    return `![${alt}](${src}${title})`;
}

function commitImageSourceEdit(
    currentNode: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    markdown: string,
) {
    const nextImage = parseMarkdownImageSource(markdown.trim());
    const pos = getPos();

    if (!nextImage || pos === undefined) {
        return;
    }

    if (
        nextImage.attrs.src === currentNode.attrs.src &&
        nextImage.attrs.alt === currentNode.attrs.alt &&
        nextImage.attrs.title === currentNode.attrs.title
    ) {
        return;
    }

    view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            ...nextImage.attrs,
        }),
    );
}

function parseMarkdownImageSource(markdown: string) {
    const nodes = parseInlineMarkdown(markdown);
    if (nodes.length !== 1 || nodes[0].type.name !== "image") {
        return null;
    }

    return nodes[0];
}

function resizeImageSourceInput(input: HTMLTextAreaElement) {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
}

async function resolveImageNodeSource(
    node: ProseMirrorNode,
    image: HTMLImageElement,
    dom: HTMLElement,
    imageLoader: ImageLoader | undefined,
    token: number,
    currentToken: () => number,
) {
    const src = String(node.attrs.src ?? "");
    if (!src || !imageLoader || imageLoader.isAvailable?.() === false) {
        return;
    }

    try {
        const resolved = await imageLoader(src);
        if (token !== currentToken()) {
            return;
        }

        image.src = resolved;
        image.setAttribute(RESOLVED_SOURCE_ATTRIBUTE, src);
        dom.dataset.mdxImageError = "false";
    } catch {
        if (token === currentToken()) {
            image.setAttribute(RESOLVED_SOURCE_ATTRIBUTE, src);
            dom.dataset.mdxImageError = "true";
        }
    }
}

function codeBlockInfo(node: ProseMirrorNode) {
    const info = node.attrs.info;
    const language = node.attrs.language;

    if (typeof info === "string" && info.length > 0) {
        return info;
    }

    return typeof language === "string" ? language : "";
}

function firstInfoToken(info: string) {
    return info.trim().split(/\s+/, 1)[0] ?? "";
}

type ContentRef = (element: HTMLElement | null) => void;

interface InternalNodeViewProps extends NodeViewProps {
    contentRef?: ContentRef;
    inline?: boolean;
    onAddColumn?: () => void;
    onAddRow?: () => void;
    onDeleteColumn?: () => void;
    onDeleteRow?: () => void;
    updateText?: (text: string) => void;
}

interface ReactNodeViewOptions {
    className?: string;
    contentDOMTag?: keyof HTMLElementTagNameMap;
    domTag?: keyof HTMLElementTagNameMap;
    inline?: boolean;
    tableControls?: boolean;
    textBacked?: boolean;
}

function createReactNodeView(
    Component: ComponentType<InternalNodeViewProps>,
    options: ReactNodeViewOptions = {},
): NodeViewConstructor {
    return (
        node: ProseMirrorNode,
        view: EditorView,
        getPos: () => number | undefined,
    ) => {
        const dom = document.createElement(options.domTag ?? "div");
        const contentDOM = options.contentDOMTag
            ? document.createElement(options.contentDOMTag)
            : undefined;
        const root = createRoot(dom);
        let currentNode = node;
        let selected = false;

        const updateAttrs = (attrs: Record<string, unknown>) => {
            const pos = getPos();
            if (pos === undefined) {
                return;
            }

            view.dispatch(
                view.state.tr.setNodeMarkup(pos, undefined, {
                    ...currentNode.attrs,
                    ...attrs,
                }),
            );
        };

        const updateText = options.textBacked
            ? (text: string) => {
                  replaceNodeWithTextContent(currentNode, view, getPos, text);
              }
            : undefined;

        const contentRef: ContentRef | undefined = contentDOM
            ? (element) => {
                  if (!element || contentDOM.parentElement === element) {
                      return;
                  }

                  element.append(contentDOM);
              }
            : undefined;

        const render = () => {
            syncNodeViewAttributes(dom, currentNode);
            if (options.className) {
                dom.className = options.className;
            }
            flushSync(() => {
                root.render(
                    <Component
                        node={currentNode}
                        updateAttrs={updateAttrs}
                        selected={selected}
                        getPos={getPosForProps(getPos)}
                        contentRef={contentRef}
                        inline={options.inline}
                        updateText={updateText}
                        onAddColumn={
                            options.tableControls
                                ? () => addTableColumn(currentNode, view, getPos)
                                : undefined
                        }
                        onAddRow={
                            options.tableControls
                                ? () => addTableRow(currentNode, view, getPos)
                                : undefined
                        }
                        onDeleteColumn={
                            options.tableControls
                                ? () => deleteTableColumn(currentNode, view, getPos)
                                : undefined
                        }
                        onDeleteRow={
                            options.tableControls
                                ? () => deleteTableRow(currentNode, view, getPos)
                                : undefined
                        }
                    />,
                );
            });
        };

        render();

        return {
            dom,
            contentDOM,
            update(nextNode) {
                if (nextNode.type !== currentNode.type) {
                    return false;
                }

                currentNode = nextNode;
                render();

                return true;
            },
            selectNode() {
                selected = true;
                render();
            },
            deselectNode() {
                selected = false;
                render();
            },
            stopEvent(event) {
                const target = event.target;

                return (
                    target instanceof Node &&
                    (!contentDOM || !contentDOM.contains(target))
                );
            },
            ignoreMutation(mutation) {
                return !contentDOM || !contentDOM.contains(mutation.target);
            },
            destroy() {
                root.unmount();
            },
        };
    };
}

function createSourceFallbackNodeView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
): NodeView {
    const dom = document.createElement("div");
    const root = createRoot(dom);
    let currentNode = node;
    let editingRequest = 0;
    let selected = false;

    const updateAttrs = (attrs: Record<string, unknown>) => {
        const pos = getPos();
        if (pos === undefined) {
            return;
        }

        const nextAttrs = {
            ...currentNode.attrs,
            ...attrs,
        };
        const markdown = String(nextAttrs.markdown ?? "");
        const content =
            markdown.length > 0 ? currentNode.type.schema.text(markdown) : null;

        view.dispatch(
            view.state.tr.replaceWith(
                pos,
                pos + currentNode.nodeSize,
                currentNode.type.create(nextAttrs, content),
            ),
        );
    };

    const render = () => {
        root.render(
            <SourceFallbackNodeView
                editingRequest={editingRequest}
                node={currentNode}
                updateAttrs={updateAttrs}
                selected={selected}
                getPos={getPosForProps(getPos)}
            />,
        );
    };

    const requestEditing = () => {
        editingRequest += 1;
        render();
    };

    const handlePreviewMouseDown = (event: MouseEvent) => {
        if (
            isInteractiveSourceFallbackTarget(event.target, dom) ||
            !isInsideSourceFallbackPreview(event.target, dom)
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        requestEditing();
    };

    const handlePreviewClick = (event: MouseEvent) => {
        if (
            isInteractiveSourceFallbackTarget(event.target, dom) ||
            !isInsideSourceFallbackPreview(event.target, dom)
        ) {
            return;
        }

        requestEditing();
    };

    dom.addEventListener("mousedown", handlePreviewMouseDown, true);
    dom.addEventListener("click", handlePreviewClick, true);

    render();

    return {
        dom,
        update(nextNode) {
            if (nextNode.type.name !== "source_fallback") {
                return false;
            }

            currentNode = nextNode;
            render();

            return true;
        },
        selectNode() {
            selected = true;
            render();
        },
        deselectNode() {
            selected = false;
            render();
        },
        stopEvent(event) {
            if (!(event.target instanceof Node) || !dom.contains(event.target)) {
                return false;
            }

            return (
                event.type === "mousedown" ||
                event.target instanceof HTMLTextAreaElement
            );
        },
        ignoreMutation() {
            return true;
        },
        destroy() {
            dom.removeEventListener("mousedown", handlePreviewMouseDown, true);
            dom.removeEventListener("click", handlePreviewClick, true);
            root.unmount();
        },
    };
}

function createHtmlBlockNodeView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
): NodeView {
    const dom = document.createElement("div");
    const root = createRoot(dom);
    let currentNode = node;
    let editingRequest = 0;
    let selected = false;

    const updateAttrs = (attrs: Record<string, unknown>) => {
        const pos = getPos();
        if (pos === undefined) {
            return;
        }

        const nextAttrs = {
            ...currentNode.attrs,
            ...attrs,
        };
        const html = String(nextAttrs.html ?? "");
        const content = html.length > 0 ? currentNode.type.schema.text(html) : null;

        view.dispatch(
            view.state.tr.replaceWith(
                pos,
                pos + currentNode.nodeSize,
                currentNode.type.create(nextAttrs, content),
            ),
        );
    };

    const render = () => {
        syncNodeViewAttributes(dom, currentNode);
        dom.className = "mdx-html-block-wrapper";
        flushSync(() => {
            root.render(
                <HtmlBlockNodeView
                    editingRequest={editingRequest}
                    node={currentNode}
                    updateAttrs={updateAttrs}
                    selected={selected}
                    getPos={getPosForProps(getPos)}
                />,
            );
        });
    };

    const requestEditing = () => {
        editingRequest += 1;
        render();
    };

    const handlePreviewMouseDown = (event: MouseEvent) => {
        if (
            isInteractiveHtmlBlockTarget(event.target, dom) ||
            !isInsideHtmlBlockPreview(event.target, dom)
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        requestEditing();
    };

    const handlePreviewClick = (event: MouseEvent) => {
        if (
            isInteractiveHtmlBlockTarget(event.target, dom) ||
            !isInsideHtmlBlockPreview(event.target, dom)
        ) {
            return;
        }

        requestEditing();
    };

    const handlePreviewDoubleClick = (event: MouseEvent) => {
        if (
            !isInsideHtmlBlockPreview(event.target, dom) ||
            !isHtmlBlockSummaryTarget(event.target, dom)
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        requestEditing();
    };

    dom.addEventListener("mousedown", handlePreviewMouseDown, true);
    dom.addEventListener("click", handlePreviewClick, true);
    dom.addEventListener("dblclick", handlePreviewDoubleClick, true);
    render();

    return {
        dom,
        update(nextNode) {
            if (nextNode.type.name !== "html_block") {
                return false;
            }

            currentNode = nextNode;
            render();

            return true;
        },
        selectNode() {
            selected = true;
            render();
        },
        deselectNode() {
            selected = false;
            render();
        },
        stopEvent(event) {
            if (!(event.target instanceof Node) || !dom.contains(event.target)) {
                return false;
            }

            return (
                event.type === "mousedown" ||
                event.type === "dblclick" ||
                event.target instanceof HTMLTextAreaElement
            );
        },
        ignoreMutation() {
            return true;
        },
        destroy() {
            dom.removeEventListener("mousedown", handlePreviewMouseDown, true);
            dom.removeEventListener("click", handlePreviewClick, true);
            dom.removeEventListener("dblclick", handlePreviewDoubleClick, true);
            root.unmount();
        },
    };
}

function isInsideHtmlBlockPreview(target: EventTarget | null, root: HTMLElement) {
    const element = eventTargetElement(target, root);

    return Boolean(element?.closest(".mdx-html-block-preview"));
}

function isInteractiveHtmlBlockTarget(
    target: EventTarget | null,
    root: HTMLElement,
) {
    const element = eventTargetElement(target, root);
    if (!element) {
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

function isHtmlBlockSummaryTarget(target: EventTarget | null, root: HTMLElement) {
    return Boolean(eventTargetElement(target, root)?.closest("summary"));
}

function isInsideSourceFallbackPreview(target: EventTarget | null, root: HTMLElement) {
    const element = eventTargetElement(target, root);

    return Boolean(element?.closest(".mdx-source-fallback-preview"));
}

function isInteractiveSourceFallbackTarget(
    target: EventTarget | null,
    root: HTMLElement,
) {
    const element = eventTargetElement(target, root);
    if (!element) {
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

function eventTargetElement(target: EventTarget | null, root: HTMLElement) {
    if (target instanceof Element) {
        return target;
    }

    if (target instanceof Node && root.contains(target)) {
        return target.parentElement;
    }

    return null;
}

function replaceNodeWithTextContent(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    text: string,
) {
    const pos = getPos();
    if (pos === undefined) {
        return;
    }

    view.dispatch(
        view.state.tr.replaceWith(
            pos,
            pos + node.nodeSize,
            node.type.create(
                node.attrs,
                text.length > 0 ? node.type.schema.text(text) : null,
            ),
        ),
    );
}

function addTableRow(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
) {
    if (node.type.name !== "table") {
        return;
    }

    const rows = childrenOf(node);
    const columnCount = Math.max(1, rows[0]?.childCount ?? 1);
    const row = node.type.schema.nodes.table_row.create(
        null,
        Array.from({ length: columnCount }, () =>
            node.type.schema.nodes.table_cell.create(),
        ),
    );

    replaceTableNode(node, view, getPos, [...rows, row]);
}

function addTableColumn(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
) {
    if (node.type.name !== "table") {
        return;
    }

    const rows = childrenOf(node).map((row, rowIndex) => {
        const cells = childrenOf(row);
        const useHeader =
            rowIndex === 0 && cells.every((cell) => cell.type.name === "table_header");
        const cellType = useHeader
            ? node.type.schema.nodes.table_header
            : node.type.schema.nodes.table_cell;

        return row.type.create(row.attrs, [...cells, cellType.create()]);
    });

    replaceTableNode(node, view, getPos, rows);
}

function deleteTableRow(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
) {
    if (node.type.name !== "table" || node.childCount <= 1) {
        return;
    }

    replaceTableNode(node, view, getPos, childrenOf(node).slice(0, -1));
}

function deleteTableColumn(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
) {
    if (node.type.name !== "table") {
        return;
    }

    const rows = childrenOf(node);
    const columnCount = rows[0]?.childCount ?? 0;
    if (columnCount <= 1) {
        return;
    }

    replaceTableNode(
        node,
        view,
        getPos,
        rows.map((row) => row.type.create(row.attrs, childrenOf(row).slice(0, -1))),
        {
            ...node.attrs,
            alignments: trimLastAlignment(node.attrs.alignments),
        },
    );
}

function replaceTableNode(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    rows: ProseMirrorNode[],
    attrs: Record<string, unknown> = node.attrs,
) {
    const pos = getPos();
    if (pos === undefined) {
        return;
    }

    view.dispatch(
        view.state.tr.replaceWith(
            pos,
            pos + node.nodeSize,
            node.type.create(attrs, rows),
        ),
    );
}

function trimLastAlignment(alignments: unknown) {
    return Array.isArray(alignments) ? alignments.slice(0, -1) : alignments;
}

function childrenOf(node: ProseMirrorNode) {
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(child));
    return children;
}

function syncNodeViewAttributes(dom: HTMLElement, node: ProseMirrorNode) {
    clearMdxAttributes(dom);
    dom.setAttribute("data-mdx-node-type", node.type.name);

    const sourceId = node.attrs.sourceId;
    if (typeof sourceId === "string" && sourceId.length > 0) {
        dom.setAttribute("data-mdx-source-id", sourceId);
    }

    switch (node.type.name) {
        case "callout":
            dom.setAttribute("data-mdx-callout-kind", String(node.attrs.kind));
            if (node.attrs.title) {
                dom.setAttribute("data-mdx-title", String(node.attrs.title));
            }
            break;
        case "code_block":
            dom.setAttribute("data-mdx-code-block", "");
            if (node.attrs.language) {
                dom.setAttribute("data-mdx-language", String(node.attrs.language));
            }
            if (node.attrs.info) {
                dom.setAttribute("data-mdx-info", String(node.attrs.info));
            }
            break;
        case "footnote_definition":
            dom.setAttribute("data-mdx-label", String(node.attrs.label));
            break;
        case "inline_html":
            dom.setAttribute("data-mdx-html", String(node.attrs.html ?? ""));
            if (node.attrs.tag) {
                dom.setAttribute("data-mdx-tag", String(node.attrs.tag));
            }
            break;
        case "math_block":
            dom.setAttribute("data-mdx-syntax", "math");
            break;
        case "math_inline":
            dom.setAttribute("data-mdx-latex", String(node.attrs.latex ?? ""));
            break;
        case "mermaid_block":
            dom.setAttribute("data-mdx-code-block", "");
            dom.setAttribute("data-mdx-language", "mermaid");
            if (node.attrs.info) {
                dom.setAttribute("data-mdx-info", String(node.attrs.info));
            }
            break;
        case "table": {
            const alignments = node.attrs.alignments;
            if (Array.isArray(alignments) && alignments.length > 0) {
                dom.setAttribute("data-mdx-alignments", alignments.join(","));
            }
            break;
        }
        case "task_item":
            dom.setAttribute("data-mdx-task-item", "");
            dom.setAttribute(
                "data-mdx-checked",
                node.attrs.checked ? "true" : "false",
            );
            break;
    }
}

function clearMdxAttributes(dom: HTMLElement) {
    Array.from(dom.attributes).forEach((attribute) => {
        if (attribute.name.startsWith("data-mdx-")) {
            dom.removeAttribute(attribute.name);
        }
    });
}

function getPosForProps(getPos: () => number | undefined) {
    return () => getPos() ?? 0;
}

export async function hydrateRenderedImages(
    root: ParentNode,
    imageLoader?: ImageLoader,
) {
    if (!imageLoader || imageLoader.isAvailable?.() === false) {
        return;
    }

    const images = root.querySelectorAll<HTMLImageElement>(
        "img[data-mdx-node-type='image']",
    );

    await Promise.all(
        Array.from(images).map(async (image) => {
            const source =
                image.getAttribute(RESOLVED_SOURCE_ATTRIBUTE) ??
                image.getAttribute("src");
            const currentSource = image.getAttribute("src");

            if (
                !source ||
                (currentSource === source &&
                    image.getAttribute(RESOLVED_SOURCE_ATTRIBUTE) === source)
            ) {
                return;
            }

            try {
                const resolved = await imageLoader(source);
                image.src = resolved;
                image.setAttribute(RESOLVED_SOURCE_ATTRIBUTE, source);
            } catch {
                image.setAttribute(RESOLVED_SOURCE_ATTRIBUTE, source);
            }
        }),
    );
}

export function nodeViewPlaceholder() {
    return null;
}
