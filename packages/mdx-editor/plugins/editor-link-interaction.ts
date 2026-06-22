import { Fragment, type Schema } from "prosemirror-model";
import {
    Plugin,
    PluginKey,
    TextSelection,
    type EditorState,
} from "prosemirror-state";
import {
    Decoration,
    DecorationSet,
    type EditorView,
} from "prosemirror-view";
import { parseInlineMarkdown } from "../parser/inline-markdown";
import { mdxEditorSchema } from "../schema/schema";

const EDITABLE_LINK_SELECTOR =
    'a[data-mdx-node-type="link"],a[data-mdx-node-type="wikilink"]';

type ActiveLink = {
    from: number;
    to: number;
};

type EditableLinkMeta = {
    active: ActiveLink | null;
    skip?: boolean;
};

type LinkRange = {
    from: number;
    href: string;
    title: string | null;
    to: number;
};

const editableLinkPluginKey = new PluginKey<ActiveLink | null>(
    "editableLink",
);

export function createEditableLinkPlugin(schema: Schema = mdxEditorSchema) {
    return new Plugin<ActiveLink | null>({
        key: editableLinkPluginKey,
        state: {
            init() {
                return null;
            },
            apply(transaction, previous) {
                const meta = transaction.getMeta(editableLinkPluginKey) as
                    | EditableLinkMeta
                    | undefined;
                if (meta) {
                    return meta.active;
                }

                if (!previous || !transaction.docChanged) {
                    return previous;
                }

                return {
                    from: transaction.mapping.map(previous.from, -1),
                    to: transaction.mapping.map(previous.to, 1),
                };
            },
        },
        appendTransaction(transactions, _oldState, newState) {
            if (
                transactions.some(
                    (transaction) =>
                        (
                            transaction.getMeta(
                                editableLinkPluginKey,
                            ) as EditableLinkMeta | undefined
                        )?.skip,
                )
            ) {
                return null;
            }

            const active = editableLinkPluginKey.getState(newState);
            if (active) {
                if (selectionInsideActiveLink(newState, active)) {
                    return null;
                }

                return finishMarkdownLinkEdit(newState, active, schema);
            }

            const link = findActiveLink(newState);
            if (!link) {
                return null;
            }

            return startMarkdownLinkEdit(newState, link);
        },
        props: {
            decorations(state) {
                const active = editableLinkPluginKey.getState(state);
                if (!active) {
                    return DecorationSet.empty;
                }

                return DecorationSet.create(state.doc, [
                    Decoration.inline(active.from, active.to, {
                        "data-mdx-editing-link": "true",
                    }),
                ]);
            },
            handleDOMEvents: {
                click: handleEditableLinkClick,
                auxclick: handleEditableLinkClick,
                blur: handleEditorBlur,
                keydown: handleEditorKeyDown,
            },
        },
    });
}

function startMarkdownLinkEdit(state: EditorState, link: LinkRange) {
    const label = state.doc.textBetween(link.from, link.to, "", "");
    const markdown = markdownLink(label, link.href, link.title);
    const labelOffset = state.selection.from - link.from;
    const selectionPosition = link.from + 1 + Math.max(0, labelOffset);
    const transaction = state.tr.replaceWith(
        link.from,
        link.to,
        state.schema.text(markdown),
    );
    const active = {
        from: link.from,
        to: link.from + markdown.length,
    };

    transaction.setSelection(
        TextSelection.create(
            transaction.doc,
            Math.min(selectionPosition, active.to),
        ),
    );
    transaction.setStoredMarks([]);
    transaction.setMeta(editableLinkPluginKey, {
        active,
        skip: true,
    } satisfies EditableLinkMeta);

    return transaction;
}

function finishMarkdownLinkEdit(
    state: EditorState,
    active: ActiveLink,
    schema: Schema,
) {
    const from = Math.max(0, Math.min(active.from, state.doc.content.size));
    const to = Math.max(from, Math.min(active.to, state.doc.content.size));
    const markdown = state.doc.textBetween(from, to, "\n", "\n");
    const nodes = parseInlineMarkdown(markdown, schema);
    const transaction = state.tr;

    if (nodes.some(hasLinkMark)) {
        transaction.replaceWith(from, to, Fragment.fromArray(nodes));
    }

    transaction.setMeta(editableLinkPluginKey, {
        active: null,
        skip: true,
    } satisfies EditableLinkMeta);

    return transaction;
}

function selectionInsideActiveLink(state: EditorState, active: ActiveLink) {
    const { from, to } = state.selection;
    return from >= active.from && to <= active.to;
}

function hasLinkMark(node: Parameters<typeof Fragment.fromArray>[0][number]) {
    if (node.marks.some((mark) => mark.type.name === "link")) {
        return true;
    }

    for (let index = 0; index < node.childCount; index += 1) {
        if (hasLinkMark(node.child(index))) {
            return true;
        }
    }

    return false;
}

function markdownLink(label: string, href: string, title: string | null) {
    const titlePart =
        typeof title === "string" && title.length > 0
            ? ` "${title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
            : "";

    return `[${label.replaceAll("]", "\\]")}](${href.replaceAll(")", "\\)")}${titlePart})`;
}

function handleEditableLinkClick(view: EditorView, event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return false;
    }

    const link = target.closest(EDITABLE_LINK_SELECTOR);
    if (!(link instanceof HTMLAnchorElement) || !view.dom.contains(link)) {
        return false;
    }

    event.preventDefault();

    if (shouldOpenLink(event)) {
        const targetHref = normalizeLinkHref(link.getAttribute("href") ?? "");
        if (targetHref) {
            window.open(targetHref, "_blank", "noopener");
            return true;
        }
    }

    return false;
}

function handleEditorBlur(view: EditorView) {
    const active = editableLinkPluginKey.getState(view.state);
    if (!active) {
        return false;
    }

    view.dispatch(finishMarkdownLinkEdit(view.state, active, view.state.schema));
    return false;
}

function handleEditorKeyDown(view: EditorView, event: KeyboardEvent) {
    if (event.key !== "Enter") {
        return false;
    }

    const active = editableLinkPluginKey.getState(view.state);
    if (!active) {
        return false;
    }

    view.dispatch(finishMarkdownLinkEdit(view.state, active, view.state.schema));
    return false;
}

function shouldOpenLink(event: MouseEvent) {
    return event.metaKey || event.ctrlKey || event.button === 1;
}

function normalizeLinkHref(href: string) {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("mdx-wikilink:")) {
        return null;
    }

    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(trimmed)) {
        return trimmed;
    }

    return `https://${trimmed}`;
}

function findActiveLink(state: EditorState): LinkRange | null {
    const { empty, from } = state.selection;
    if (!empty) {
        return null;
    }

    const linkType = state.schema.marks.link;
    const $from = state.doc.resolve(from);
    const parent = $from.parent;
    const parentStart = from - $from.parentOffset;
    const linkMark =
        $from.marks().find((mark) => mark.type === linkType) ??
        ($from.parentOffset > 0
            ? parent.childAfter($from.parentOffset - 1).node?.marks.find(
                  (mark) => mark.type === linkType,
              )
            : undefined);

    if (!linkMark) {
        return null;
    }

    const href = String(linkMark.attrs.href ?? "");
    if (href.startsWith("mdx-wikilink:")) {
        return null;
    }

    let rangeFrom = from;
    let rangeTo = from;
    let offset = 0;

    parent.forEach((node, nodeOffset) => {
        if (!node.isText || !node.marks.some((mark) => mark.eq(linkMark))) {
            return;
        }

        const nodeFrom = parentStart + nodeOffset;
        const nodeTo = nodeFrom + node.nodeSize;
        if (from < nodeFrom || from > nodeTo) {
            return;
        }

        rangeFrom = nodeFrom;
        rangeTo = nodeTo;
        offset = nodeOffset;
    });

    while (offset > 0) {
        const previous = parent.childBefore(offset);
        if (
            !previous.node?.isText ||
            !previous.node.marks.some((mark) => mark.eq(linkMark))
        ) {
            break;
        }

        offset = previous.offset;
        rangeFrom = parentStart + previous.offset;
    }

    offset = rangeTo - parentStart;
    while (offset < parent.content.size) {
        const next = parent.childAfter(offset);
        if (
            !next.node?.isText ||
            !next.node.marks.some((mark) => mark.eq(linkMark))
        ) {
            break;
        }

        rangeTo = parentStart + next.offset + next.node.nodeSize;
        offset = next.offset + next.node.nodeSize;
    }

    return {
        from: rangeFrom,
        href,
        title: linkMark.attrs.title ?? null,
        to: rangeTo,
    };
}
