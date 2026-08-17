import { editorViewOptionsCtx, schemaCtx } from "@milkdown/kit/core";
import { DOMSerializer, type Schema } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { sanitizeHtmlString } from "./sanitize";
import { SESSION_TOKEN, SOURCE_TOKEN_ATTR } from "./session";

/**
 * Sanitizes clipboard HTML before anything can read structure out of it.
 *
 * ProseMirror turns pasted HTML into a document slice by assigning it to
 * `innerHTML` and running the schema's `parseDOM` rules over the result. Both
 * halves of that are dangerous with attacker-controlled markup: the assignment
 * itself starts subresource loads that fire `onerror`, and the parse rules will
 * happily rebuild a structured node out of any attribute that looks the part.
 * Running the allowlist over the string first is what makes both harmless.
 *
 * Returning the empty string on failure is the only failure behavior, and on
 * its own it discards the paste: ProseMirror has already committed to the HTML
 * branch by the time this runs, so an empty string is an empty slice, and no
 * fallback of its own follows. {@link pasteRejectedHtmlAsText} is what makes
 * the paste land anyway.
 */
interface SanitizedPaste {
    html: string;
    /** True when the allowlist could not vouch for the input at all. */
    rejected: boolean;
}

function sanitizePaste(html: string, doc: Document): SanitizedPaste {
    try {
        return { html: sanitizeHtmlString(html, doc), rejected: false };
    } catch {
        return { html: "", rejected: true };
    }
}

export function sanitizePastedHtml(html: string, doc: Document): string {
    return sanitizePaste(html, doc).html;
}

/**
 * Attribute namespaces that make an element rehydratable as structured syntax.
 *
 * Only elements carrying one of these are worth proving the origin of, because
 * only they can reconstruct a node on paste.
 */
const PRODUCT_METADATA_PREFIXES = [
    "data-mdx",
    "data-callout",
    "data-frontmatter",
] as const;

function carriesProductMetadata(element: Element): boolean {
    return element
        .getAttributeNames()
        .some(
            (name) =>
                name !== SOURCE_TOKEN_ATTR &&
                PRODUCT_METADATA_PREFIXES.some((prefix) =>
                    name.startsWith(prefix),
                ),
        );
}

/**
 * Stamps this session's token on the product metadata leaving for the clipboard.
 *
 * Without it the guard could not tell an in-app copy from a forgery, and would
 * have to strip structure from both. The token proves only origin: a pasted
 * node still goes through the schema's own validation, and a preview built from
 * it is still sanitized.
 *
 * Only elements that can actually rehydrate are stamped. Stamping every element
 * put the token on ordinary prose too, so copying a paragraph into any other
 * application disclosed it — and a page that later placed crafted HTML carrying
 * it back on the clipboard would have been trusted for the rest of the session.
 */
function stampProductMetadata(root: DocumentFragment | HTMLElement): void {
    for (const element of Array.from(root.querySelectorAll("*"))) {
        if (carriesProductMetadata(element)) {
            element.setAttribute(SOURCE_TOKEN_ATTR, SESSION_TOKEN);
        }
    }
    if (root instanceof HTMLElement && carriesProductMetadata(root)) {
        root.setAttribute(SOURCE_TOKEN_ATTR, SESSION_TOKEN);
    }
}

function createStampingSerializer(schema: Schema): DOMSerializer {
    const base = DOMSerializer.fromSchema(schema);
    const serializer = new DOMSerializer(base.nodes, base.marks);
    const serializeFragment =
        DOMSerializer.prototype.serializeFragment.bind(serializer);
    let depth = 0;
    serializer.serializeFragment = ((
        fragment: Parameters<DOMSerializer["serializeFragment"]>[0],
        options?: Parameters<DOMSerializer["serializeFragment"]>[1],
        target?: Parameters<DOMSerializer["serializeFragment"]>[2],
    ) => {
        depth += 1;
        try {
            const result = serializeFragment(fragment, options, target);
            // Serialization recurses through this same method, so only the
            // outermost call walks the finished tree.
            if (depth === 1) stampProductMetadata(result);
            return result;
        } finally {
            depth -= 1;
        }
    }) as DOMSerializer["serializeFragment"];
    return serializer;
}

const clipboardGuardKey = new PluginKey("mdx-source-preservation-clipboard");

/**
 * Inserts the clipboard's plain text for a paste whose HTML was rejected.
 *
 * `transformPastedHTML` can only answer with a string, and the empty string it
 * answers with on rejection becomes an empty slice that Milkdown's own
 * `handlePaste` dispatches and reports as handled — so without this the paste
 * is dropped in silence, which is the one outcome a paste may not have. The
 * text is inserted as characters and never re-parsed: nothing from a document
 * the allowlist refused to vouch for may come back as structure.
 *
 * @param rejected whether this paste's HTML failed to sanitize, read and
 * cleared by the caller so a later paste never inherits it
 * @returns whether the paste was handled here
 */
export function pasteRejectedHtmlAsText(
    view: EditorView,
    event: ClipboardEvent,
    rejected: boolean,
): boolean {
    const data = event.clipboardData;
    if (!rejected || !data) return false;
    // A paste carrying no HTML never reached the sanitizer, so a flag left over
    // from some other rejection is not about this paste.
    if (data.getData("text/html").length === 0) return false;

    const text = data.getData("text/plain");
    // Nothing to put in its place, so the event is still consumed: letting it
    // through would replace the selection with the empty slice and delete it.
    if (text.length > 0) view.dispatch(view.state.tr.insertText(text));
    return true;
}

export const clipboardGuard = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    /** Whether the HTML of the paste now in flight failed to sanitize. */
    let rejected = false;

    // `transformPastedHTML` and `handlePaste` are both read off the view's own
    // options before any plugin's copy, so the guard has to be installed there
    // to run at all — and `handlePaste` has to win against the clipboard
    // plugin's, which would otherwise dispatch the empty slice. Previous values
    // are chained rather than replaced.
    ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        transformPastedHTML: (html: string, view: EditorView) => {
            const upstream = prev.transformPastedHTML;
            const incoming = upstream ? upstream(html, view) : html;
            const sanitized = sanitizePaste(
                incoming,
                view.dom.ownerDocument ?? document,
            );
            rejected = sanitized.rejected;
            return sanitized.html;
        },
        handlePaste: (view: EditorView, event: ClipboardEvent, slice) => {
            const failed = rejected;
            rejected = false;
            if (pasteRejectedHtmlAsText(view, event, failed)) return true;
            return prev.handlePaste?.(view, event, slice) ?? false;
        },
    }));

    return new Plugin({
        key: clipboardGuardKey,
        props: { clipboardSerializer: createStampingSerializer(schema) },
    });
});
