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

const CODE_BLOCK_SELECTOR = MDX_CODE_BLOCK_SELECTOR;
const EDITOR_ROOT_SELECTOR = MDX_EDITOR_ROOT_SELECTOR;

export function isSelectAllShortcut(event: KeyboardShortcutState) {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.code === "KeyA" || event.key.toLowerCase() === "a")
    );
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

    const codeBlock = selectionAnchor?.closest(CODE_BLOCK_SELECTOR);
    if (codeBlock && editorRoot.contains(codeBlock as TContainsTarget)) {
        return codeBlock;
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
