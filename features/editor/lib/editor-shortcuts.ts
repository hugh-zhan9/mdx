/**
 * The editor's find, replace and surface-mode key bindings.
 *
 * They live apart from any one editing surface because both surfaces have to
 * answer to the same keystrokes: a user who has learned ⌘F does not relearn it
 * because the product mounted a different editor underneath. One definition is
 * what makes "the same binding" a fact rather than a coincidence.
 */

export interface EditorShortcutLike {
    altKey: boolean;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}

export function isEditorFindShortcut(event: EditorShortcutLike): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.code === "KeyF"
    );
}

export function isEditorReplaceShortcut(event: EditorShortcutLike): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.code === "KeyR"
    );
}

/**
 * Toggles between the WYSIWYG surface and the global CodeMirror source mode.
 *
 * The binding is the only way a user reaches source mode: the product has no
 * toolbar and the mode is deliberately not persisted, so without a keystroke
 * the source surface exists but nobody outside a test can open it.
 *
 * ⌘⇧M rather than the more obvious ⌘/, because the surface it opens already
 * binds ⌘/ — CodeMirror's default keymap toggles a `<!-- -->` comment with it,
 * and Markdown source is a language where that works. A switch key has to mean
 * the same thing on both surfaces to bring the user back, so taking ⌘/ here
 * would mean taking it away there.
 */
export function isEditorSourceModeShortcut(event: EditorShortcutLike): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.shiftKey &&
        event.code === "KeyM"
    );
}
