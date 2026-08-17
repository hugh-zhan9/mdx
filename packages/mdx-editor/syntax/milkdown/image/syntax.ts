/**
 * ProseMirror node name for an inline image.
 *
 * The node itself belongs to the CommonMark preset — parser, schema and
 * serializer are all upstream. This family contributes nothing but the view
 * that draws it.
 */
export const IMAGE_NODE_NAME = "image";

/** Marks an `<img>` this package's NodeView drew. */
export const IMAGE_DOM_MARKER = "data-mdx-image";

/**
 * Records which document source the displayed URL was resolved from.
 *
 * A blob URL says nothing about the path the author wrote, so the picture that
 * is on screen cannot otherwise be traced back to the reference it came from.
 * It is presentation only: the attribute lives on the rendered element, never
 * on the node, so nothing it holds can reach the serializer.
 */
export const IMAGE_RESOLVED_SOURCE_MARKER = "data-mdx-resolved-src";
