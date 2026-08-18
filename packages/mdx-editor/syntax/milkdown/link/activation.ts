import { $ctx } from "@milkdown/kit/utils";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";

/** A link the user activated, as it was written in the document. */
export interface LinkActivation {
    /** The link's target, exactly as the Markdown spells it. */
    href: string;
}

export type LinkClickHandler = (activation: LinkActivation) => void;

/**
 * Where the product's link handler lives while the editor is running.
 *
 * Defaults to doing nothing, so a composition built for a test or a preflight
 * needs no handler and a click there simply does not travel.
 */
export const linkClickCtx = $ctx<LinkClickHandler, "mdxLinkClick">(
    () => {},
    "mdxLinkClick",
);

/**
 * Installs the handler {@link linkClickCtx} carries.
 *
 * Separate from the context slice for the same reason the wikilink's is: the
 * slice has to exist before anything can be written into it.
 */
export function linkClickHandlerPlugin(
    handler: LinkClickHandler,
): MilkdownPlugin {
    return (ctx: Ctx) => () => {
        ctx.set(linkClickCtx.key, handler);
    };
}
