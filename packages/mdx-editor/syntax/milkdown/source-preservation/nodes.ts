/**
 * ProseMirror node names for preserved source.
 *
 * `mdx_html_source` holds raw HTML — a block of it as editable text, an inline
 * run of it as an atom, because ProseMirror inline nodes cannot hold content.
 * `mdx_source_fallback` holds everything else the editor cannot represent.
 */
export const HTML_SOURCE_NODE = "mdx_html_source";
export const HTML_SOURCE_INLINE_NODE = "mdx_html_source_inline";
export const SOURCE_FALLBACK_NODE = "mdx_source_fallback";
export const SOURCE_FALLBACK_INLINE_NODE = "mdx_source_fallback_inline";
