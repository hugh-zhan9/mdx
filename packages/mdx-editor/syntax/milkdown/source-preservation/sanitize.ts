/**
 * Allowlist sanitizer for every piece of untrusted HTML this layer touches:
 * the preview rendered beside a preserved HTML source block, and HTML arriving
 * on the clipboard.
 *
 * The sanitizer never edits the parsed tree in place and never adopts a node
 * the parser produced. It walks the parse result and *rebuilds* an equivalent
 * tree out of freshly created HTML elements, copying across only tags and
 * attributes that appear in the allowlists below. A construct nobody listed
 * therefore cannot survive by being overlooked: it has to be written down to
 * exist at all. That also rules out namespace-confusion (mXSS) payloads, since
 * every element in the output is created with `createElement` in the HTML
 * namespace regardless of what the input claimed.
 */

import {
    DATA_ATTRIBUTE_PREFIX,
    SOURCE_TOKEN_ATTR,
    isProductMetadata,
} from "./session";

/** Raised when input cannot be sanitized rather than sanitized incorrectly. */
export class SanitizeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SanitizeError";
    }
}

/**
 * Elements that may appear in sanitized output. Text-level and layout markup
 * only: nothing that can run code, fetch a subresource that is not an image,
 * open a browsing context, submit anything, or carry a stylesheet.
 */
const ALLOWED_TAGS = new Set([
    "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo",
    "blockquote", "br", "caption", "cite", "code", "col", "colgroup", "dd",
    "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
    "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
    "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre",
    "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "span",
    "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
    "thead", "time", "tr", "u", "ul", "var", "wbr",
]);

/**
 * Elements removed together with everything inside them.
 *
 * An element outside both this set and `ALLOWED_TAGS` is unwrapped instead —
 * its sanitized children survive — because an unknown tag is usually a custom
 * element wrapping ordinary prose. The tags here are the ones whose *content*
 * is itself the payload (script bodies, stylesheets, iframe documents) or whose
 * content is meaningless without the element (form controls).
 */
const DROPPED_WITH_CONTENT = new Set([
    "script", "style", "iframe", "object", "embed", "base", "meta", "link",
    "noscript", "template", "title", "head", "html", "body", "frame",
    "frameset", "applet", "param", "form", "input", "button", "select",
    "option", "optgroup", "textarea", "label", "fieldset", "legend",
    "datalist", "output", "progress", "meter", "canvas", "audio", "video",
    "source", "track", "map", "area", "svg", "math", "marquee", "portal",
    "dialog", "slot", "xmp", "plaintext", "listing", "keygen", "menu",
    "menuitem", "picture",
]);

/** Attributes allowed on any element in the output. */
const GLOBAL_ATTRIBUTES = new Set(["class", "title", "lang", "dir"]);

/**
 * Attributes allowed on specific elements.
 *
 * `style` is absent on purpose: CSS is an execution surface in its own right
 * (`expression()`, `-moz-binding`, `behavior`, `url(javascript:…)`) and the
 * preview has no requirement to carry author styling. `id` and `name` are
 * absent because they let markup clobber DOM properties of the host page.
 */
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
    a: new Set(["href"]),
    blockquote: new Set(["cite"]),
    col: new Set(["span"]),
    colgroup: new Set(["span"]),
    del: new Set(["cite", "datetime"]),
    details: new Set(["open"]),
    img: new Set(["src", "alt", "width", "height"]),
    ins: new Set(["cite", "datetime"]),
    ol: new Set(["start", "reversed"]),
    q: new Set(["cite"]),
    td: new Set(["colspan", "rowspan", "headers"]),
    th: new Set(["colspan", "rowspan", "headers", "scope"]),
    time: new Set(["datetime"]),
};

/** Allowed attributes whose value is a URL and needs a scheme check. */
const URL_ATTRIBUTES = new Set(["href", "src", "cite"]);

/**
 * Schemes a URL attribute may use. Anything else — `javascript:`, `vbscript:`,
 * `data:`, `blob:`, `file:`, `about:` — is dropped along with its attribute.
 */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Structural budgets. Input past either limit is rejected rather than
 * sanitized: a preview is not worth unbounded recursion or unbounded DOM, and
 * the caller has a defined behavior for rejection.
 */
const MAX_DEPTH = 100;
const MAX_NODES = 20000;

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export interface SanitizeOptions {
    /**
     * Keeps `data-mdx-*` metadata on elements that carry this session's token.
     * Omitted for previews, where metadata has no meaning; supplied for the
     * clipboard, where in-process copies must still rehydrate.
     */
    readonly trustProductMetadata?: boolean;
}

interface Budget {
    nodes: number;
}

/**
 * Decodes the character references a payload might hide a scheme behind, then
 * removes the whitespace and control characters a URL parser ignores.
 *
 * The HTML parser has already decoded one level of references by the time an
 * attribute value is read, so this exists for values that were encoded twice.
 */
/**
 * Decodes a numeric character reference, or returns null when the value is not
 * a code point at all.
 *
 * `String.fromCodePoint` throws a `RangeError` above U+10FFFF. An attacker
 * controls this input, and the throw would escape sanitization entirely — it
 * would blank the preview and, on the clipboard path, discard the whole paste.
 * An out-of-range reference is not a character, so the reference is left as
 * written and the URL check sees it as the literal text it is.
 */
function decodeCodePoint(value: number): string | null {
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return null;
    return String.fromCodePoint(value);
}

function normalizeUrlForCheck(value: string): string {
    let decoded = value;
    for (let pass = 0; pass < 3; pass += 1) {
        const next = decoded
            .replace(/&#x([0-9a-f]+);?/gi, (match, hex: string) =>
                decodeCodePoint(Number.parseInt(hex, 16)) ?? match,
            )
            .replace(
                /&#(\d+);?/g,
                (match, decimal: string) =>
                    decodeCodePoint(Number(decimal)) ?? match,
            )
            .replace(/&colon;?/gi, ":")
            .replace(/&tab;?/gi, "\t")
            .replace(/&newline;?/gi, "\n");
        if (next === decoded) break;
        decoded = next;
    }
    return decoded.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\ufeff]/g, "");
}

/**
 * Attributes the browser fetches on its own, with no user action, as soon as
 * the element is in the document.
 */
function isFetchingAttribute(tag: string, name: string): boolean {
    return tag === "img" && name === "src";
}

/** True when a URL would leave the machine. Relative and same-document do not. */
function isRemoteUrl(value: string): boolean {
    const candidate = normalizeUrlForCheck(value);
    if (candidate.startsWith("//")) return true;
    return /^[a-z][a-z0-9+.-]*:/i.test(candidate);
}

function isSafeUrl(value: string): boolean {
    const candidate = normalizeUrlForCheck(value);
    if (candidate.length === 0) return false;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(candidate);
    // No scheme at all is a same-document or relative reference.
    if (!scheme) return true;
    return SAFE_SCHEMES.has(`${scheme[1].toLowerCase()}:`);
}

function isAllowedAttribute(tag: string, name: string): boolean {
    // Redundant with the allowlists below, and kept anyway: an event handler
    // slipping through would be the single most damaging mistake here.
    if (name.startsWith("on")) return false;
    if (GLOBAL_ATTRIBUTES.has(name)) return true;
    return TAG_ATTRIBUTES[tag]?.has(name) === true;
}

function copyAttributes(
    source: Element,
    target: Element,
    tag: string,
    options: SanitizeOptions,
): void {
    const trusted =
        options.trustProductMetadata === true &&
        isProductMetadata(source.getAttribute(SOURCE_TOKEN_ATTR));

    for (const attribute of Array.from(source.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;

        if (name.startsWith(DATA_ATTRIBUTE_PREFIX)) {
            // A `data-` attribute is metadata only when this process wrote it.
            // Otherwise it is a string an attacker chose, and it stays out of
            // the document so no schema rule downstream can rehydrate a
            // structured node from it.
            if (trusted) target.setAttribute(name, value);
            continue;
        }

        if (!isAllowedAttribute(tag, name)) continue;
        if (URL_ATTRIBUTES.has(name) && !isSafeUrl(value)) continue;
        if (isFetchingAttribute(tag, name) && isRemoteUrl(value)) {
            // Opening a document must not reach the network. A preview renders
            // as soon as its node view mounts, with no user action, so a remote
            // `src` would let a document's author learn when and where it was
            // opened. The URL is kept as data so the UI can offer to load it.
            target.setAttribute(`data-mdx-blocked-${name}`, value);
            continue;
        }
        target.setAttribute(name, value);
    }
}

function convertNode(
    node: Node,
    doc: Document,
    budget: Budget,
    depth: number,
    options: SanitizeOptions,
): Node[] {
    budget.nodes += 1;
    if (budget.nodes > MAX_NODES) {
        throw new SanitizeError("html is too large to preview safely");
    }
    if (depth > MAX_DEPTH) {
        throw new SanitizeError("html is nested too deeply to preview safely");
    }

    if (node.nodeType === 3 /* TEXT_NODE */) {
        return [doc.createTextNode(node.nodeValue ?? "")];
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) {
        // Comments, processing instructions and CDATA carry no content the
        // preview needs and have historically been mXSS carriers.
        return [];
    }

    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (DROPPED_WITH_CONTENT.has(tag)) return [];
    // Foreign content (SVG, MathML) parses under different rules than HTML and
    // is the classic namespace-confusion vector, so none of it is rebuilt.
    if (element.namespaceURI !== null && element.namespaceURI !== XHTML_NAMESPACE) {
        return [];
    }

    const children: Node[] = [];
    for (const child of Array.from(element.childNodes)) {
        children.push(...convertNode(child, doc, budget, depth + 1, options));
    }

    if (!ALLOWED_TAGS.has(tag)) return children;

    const rebuilt = doc.createElement(tag);
    copyAttributes(element, rebuilt, tag, options);
    for (const child of children) rebuilt.append(child);
    return [rebuilt];
}

function parseUntrustedHtml(html: string): Element {
    const Parser = globalThis.DOMParser;
    if (typeof Parser !== "function") {
        throw new SanitizeError("no HTML parser is available");
    }
    let parsed: Document;
    try {
        parsed = new Parser().parseFromString(html, "text/html");
    } catch (cause) {
        throw new SanitizeError(`html could not be parsed: ${String(cause)}`);
    }
    const body = parsed.body;
    if (!body) throw new SanitizeError("html could not be parsed");
    return body;
}

/**
 * Last line of defence, run over output this module built itself.
 *
 * It cannot make unsafe output safe; it turns a sanitizer bug into a rejected
 * preview instead of a live payload, and it fails loudly enough to be caught
 * by a test rather than by a user.
 */
function assertInert(fragment: DocumentFragment): void {
    const elements = fragment.querySelectorAll("*");
    for (const element of Array.from(elements)) {
        const tag = element.localName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
            throw new SanitizeError(`sanitizer emitted a ${tag} element`);
        }
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith("on")) {
                throw new SanitizeError(`sanitizer emitted ${name}`);
            }
            if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)) {
                throw new SanitizeError(`sanitizer emitted an unsafe ${name}`);
            }
        }
    }
}

/**
 * Rebuilds `html` as an inert fragment owned by `doc`.
 *
 * Throws `SanitizeError` rather than returning a partial result, so a caller
 * always knows whether what it is about to insert was fully checked.
 */
export function sanitizeToFragment(
    html: string,
    doc: Document,
    options: SanitizeOptions = {},
): DocumentFragment {
    const body = parseUntrustedHtml(html);
    const fragment = doc.createDocumentFragment();
    const budget: Budget = { nodes: 0 };
    for (const child of Array.from(body.childNodes)) {
        for (const converted of convertNode(child, doc, budget, 0, options)) {
            fragment.append(converted);
        }
    }
    assertInert(fragment);
    return fragment;
}

/**
 * Sanitizes clipboard HTML back into a string, keeping this session's own
 * metadata so an in-process copy still rehydrates its structured nodes.
 */
export function sanitizeHtmlString(html: string, doc: Document): string {
    const fragment = sanitizeToFragment(html, doc, {
        trustProductMetadata: true,
    });
    const holder = doc.createElement("div");
    holder.append(fragment);
    return holder.innerHTML;
}
