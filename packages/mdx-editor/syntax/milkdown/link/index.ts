import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";

import { linkClickCtx } from "./activation";

import {
    linkEditorLabelsCtx,
    linkEditorProsePlugin,
} from "./link-editor";

export {
    linkClickCtx,
    linkClickHandlerPlugin,
    type LinkActivation,
    type LinkClickHandler,
} from "./activation";

export {
    linkAtCaret,
    linkEditorLabelsCtx,
    linkEditorLabelsPlugin,
    linkEditorProsePlugin,
    type LinkAtCaret,
    type LinkEditorLabels,
} from "./link-editor";

/**
 * Marks the editor while the key that turns a click into an activation is held.
 *
 * A cursor cannot be chosen by CSS on a modifier, so the modifier is written
 * onto the element and the stylesheet reads it from there. Window listeners
 * rather than the editor's own, because the key can go down before the pointer
 * arrives and up after it has left.
 */
const LINK_MODIFIER_ATTR = "data-mdx-link-open-modifier";

/**
 * Reports a click on a link instead of letting it do nothing.
 *
 * A link is a mark rather than a node, so there is no node view to hang this on
 * and it has to be a view-level handler. Inside a contenteditable the browser
 * does not follow an anchor, so without this a link is text that happens to be
 * blue.
 *
 * It takes the platform's modifier — ⌘ — for the same reason every other editor
 * asks for it: a plain click has to stay available for putting the caret inside
 * a link's own label, which is text someone is going to want to fix. The
 * modifier also decides when the pointer changes shape, so the invitation
 * appears exactly when the click would act on it.
 *
 * What "activating" means is the product's business: this reports the href as
 * written, including a relative one, and never decides what to open.
 */
export const linkClickProsePlugin = $prose(
    (ctx: Ctx) =>
        new Plugin({
            props: {
                handleDOMEvents: {
                    click: (_view, event) => {
                        // Left button with ⌘ held. Not `ctrlKey`: on macOS a
                        // control-click is a right-click, and answering it here
                        // would open the link and the context menu at once.
                        if (event.button !== 0 || !event.metaKey) {
                            return false;
                        }

                        const target = event.target;

                        if (!(target instanceof Element)) {
                            return false;
                        }

                        // `closest`, because the click lands on whatever the
                        // label is made of — a word, an emphasis, an image.
                        const anchor = target.closest("a[href]");
                        const href = anchor?.getAttribute("href") ?? "";

                        if (href.length === 0) {
                            return false;
                        }

                        event.preventDefault();
                        ctx.get(linkClickCtx.key)({ href });

                        return true;
                    },
                },
            },
        }),
);

/**
 * Keeps {@link LINK_MODIFIER_ATTR} on the editor while ⌘ is held.
 *
 * Also cleared when the window loses focus: a key released somewhere else is
 * still released, and a pointer left as a hand over text that no longer opens
 * anything is a lie about what a click will do.
 */
export const linkModifierProsePlugin = $prose(
    () =>
        new Plugin({
            view: (view) => {
                const setHeld = (held: boolean) => {
                    if (held) {
                        view.dom.setAttribute(LINK_MODIFIER_ATTR, "");
                    } else {
                        view.dom.removeAttribute(LINK_MODIFIER_ATTR);
                    }
                };
                const onKey = (event: KeyboardEvent) => {
                    setHeld(event.metaKey);
                };
                const onBlur = () => setHeld(false);

                window.addEventListener("keydown", onKey);
                window.addEventListener("keyup", onKey);
                window.addEventListener("blur", onBlur);

                return {
                    destroy: () => {
                        window.removeEventListener("keydown", onKey);
                        window.removeEventListener("keyup", onKey);
                        window.removeEventListener("blur", onBlur);
                    },
                };
            },
        }),
);

export function linkPlugins(): MilkdownPlugin[] {
    return [
        linkClickCtx,
        linkClickProsePlugin,
        linkModifierProsePlugin,
        linkEditorLabelsCtx,
        linkEditorProsePlugin,
    ];
}
