import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
    EditorView,
    NodeView,
    NodeViewConstructor,
} from "prosemirror-view";
import { CalloutNodeView } from "./callout-node-view";
import { FootnoteNodeView } from "./footnote-node-view";
import { MathNodeView } from "./math-node-view";
import { MermaidNodeView } from "./mermaid-node-view";
import { SourceFallbackNodeView } from "./source-fallback-node-view";
import { TableNodeView } from "./table-node-view";
import { TaskListNodeView } from "./task-list-node-view";

const RESOLVED_SOURCE_ATTRIBUTE = "data-mdx-resolved-src";

export interface NodeViewProps {
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
    void options;

    return {
        callout: createReactNodeView(CalloutNodeView, {
            contentDOMTag: "div",
            domTag: "aside",
        }),
        footnote_definition: createReactNodeView(FootnoteNodeView, {
            contentDOMTag: "div",
            domTag: "section",
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

type ContentRef = (element: HTMLElement | null) => void;

interface InternalNodeViewProps extends NodeViewProps {
    contentRef?: ContentRef;
    inline?: boolean;
    onAddColumn?: () => void;
    onAddRow?: () => void;
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
                    target instanceof HTMLElement &&
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
                node={currentNode}
                updateAttrs={updateAttrs}
                selected={selected}
                getPos={getPosForProps(getPos)}
            />,
        );
    };

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
            return event.target instanceof HTMLTextAreaElement;
        },
        ignoreMutation() {
            return true;
        },
        destroy() {
            root.unmount();
        },
    };
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

function replaceTableNode(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    rows: ProseMirrorNode[],
) {
    const pos = getPos();
    if (pos === undefined) {
        return;
    }

    view.dispatch(
        view.state.tr.replaceWith(
            pos,
            pos + node.nodeSize,
            node.type.create(node.attrs, rows),
        ),
    );
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
        case "footnote_definition":
            dom.setAttribute("data-mdx-label", String(node.attrs.label));
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
    imageLoader?: (src: string) => Promise<string>,
) {
    if (!imageLoader) {
        return;
    }

    const images = root.querySelectorAll<HTMLImageElement>(
        "img[data-mdx-node-type='image']",
    );

    await Promise.all(
        Array.from(images).map(async (image) => {
            const source = image.getAttribute("src");
            if (!source || image.getAttribute(RESOLVED_SOURCE_ATTRIBUTE) === source) {
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
