import {
    MDX_CODE_BLOCK_SELECTOR,
    MDX_EDITOR_ROOT_SELECTOR,
} from "./editor-dom-contract";

export interface KeyboardShortcutState {
    altKey: boolean;
    code: string;
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
}

interface DomElementLike<TContainsTarget> {
    className: string;
    closest(selector: string): DomElementLike<TContainsTarget> | null;
    contains(target: TContainsTarget): boolean;
    querySelector(selector: string): DomElementLike<TContainsTarget> | null;
}

const EDITOR_ROOT_SELECTOR = MDX_EDITOR_ROOT_SELECTOR;
const SCOPED_SELECT_ALL_SELECTOR = [
    MDX_CODE_BLOCK_SELECTOR,
    "[data-mdx-node-type='blockquote']",
    "[data-mdx-node-type='callout']",
    "[data-mdx-node-type='frontmatter']",
    "[data-mdx-node-type='html_block']",
    "[data-mdx-node-type='math_block']",
    "[data-mdx-node-type='mermaid_block']",
    "[data-mdx-node-type='source_fallback']",
].join(",");
const NATIVE_TEXT_EDITING_SELECTOR = "input,textarea,[role='textbox']";

export function isSelectAllShortcut(event: KeyboardShortcutState) {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.code === "KeyA" || event.key.toLowerCase() === "a")
    );
}

export function shouldUseNativeSelectAllTarget(
    eventTarget: DomElementLike<unknown> | null,
) {
    return Boolean(eventTarget?.closest(NATIVE_TEXT_EDITING_SELECTOR));
}

export function resolveScopedSelectAllTarget<TContainsTarget>(
    eventTarget: DomElementLike<TContainsTarget> | null,
    editorContainer: DomElementLike<TContainsTarget> | null,
    selectionAnchor: DomElementLike<TContainsTarget> | null = eventTarget,
) {
    if (!eventTarget || !editorContainer) {
        return null;
    }

    const editorRoot = editorContainer.querySelector(EDITOR_ROOT_SELECTOR);
    if (!editorRoot || !editorRoot.contains(eventTarget as TContainsTarget)) {
        return null;
    }

    const scopedBlock = selectionAnchor?.closest(SCOPED_SELECT_ALL_SELECTOR);
    if (scopedBlock && editorRoot.contains(scopedBlock as TContainsTarget)) {
        return scopedBlock;
    }

    return editorRoot;
}

export function elementFromNode(node: Node | null) {
    if (node instanceof HTMLElement) {
        return node;
    }

    return node?.parentElement ?? null;
}

export function selectElementContents(element: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) {
        return;
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
}
