/**
 * Identity for preserved-source nodes and for metadata this product produced.
 *
 * Two different jobs share this module because both are about provenance: a
 * per-node id that stays put while the node lives, and a per-process token that
 * distinguishes clipboard metadata this editor wrote from clipboard metadata an
 * attacker wrote to look like it.
 */

/** Marks the structured node an element stands for. */
export const NODE_TYPE_ATTR = "data-mdx-node-type";
/** Stable per-node identity. */
export const SOURCE_ID_ATTR = "data-mdx-source-id";
/** Syntax family a preserved slice came from. */
export const SOURCE_KIND_ATTR = "data-mdx-source-kind";
/** Raw source carried by an inline node, which has no text content of its own. */
export const SOURCE_VALUE_ATTR = "data-mdx-source-value";
/** Proof that this process wrote the metadata on the element. */
export const SOURCE_TOKEN_ATTR = "data-mdx-source-token";
/** The element holding the editable raw source. */
export const SOURCE_ELEMENT_ATTR = "data-mdx-source";
/**
 * Marks chrome that is rendered from the node but is not part of it: never
 * serialized, never part of the node's text content. Find/replace and any other
 * document-wide text pass must exclude subtrees carrying this attribute.
 */
export const PREVIEW_ATTR = "data-mdx-preview";
/** Marks the in-place report that a preview could not be built. */
export const PREVIEW_ERROR_ATTR = "data-mdx-preview-error";

/**
 * Prefix of every attribute a schema rule may read to rebuild a structured
 * node — this layer's and every other syntax family's alike. The clipboard
 * guard strips the whole family from elements it cannot attribute to this
 * process, so a rule that trusts `data-callout` or `data-mdx-wikilink` is
 * covered without either of them knowing about the guard.
 */
export const DATA_ATTRIBUTE_PREFIX = "data-";

function createSessionToken(): string {
    const source = globalThis.crypto;
    // No fallback: without a real entropy source the token would be guessable,
    // and a guessable token is the same as no token at all.
    if (!source || typeof source.getRandomValues !== "function") {
        throw new Error(
            "source preservation requires crypto.getRandomValues to mark product metadata",
        );
    }
    const bytes = source.getRandomValues(new Uint8Array(16));
    let token = "";
    for (const byte of bytes) token += byte.toString(16).padStart(2, "0");
    return token;
}

/**
 * Secret for one process. Clipboard HTML that carries it was written by this
 * editor in this session; anything else is treated as foreign content, however
 * closely its attributes resemble the product's own.
 */
export const SESSION_TOKEN: string = createSessionToken();

export function isProductMetadata(token: string | null | undefined): boolean {
    return token === SESSION_TOKEN;
}

let sourceCounter = 0;

/**
 * Identity for one preserved slice. Unique within the process, so two nodes
 * holding identical bytes stay distinguishable and never merge.
 */
export function nextSourceId(): string {
    sourceCounter += 1;
    return `mdx-src-${sourceCounter}`;
}
