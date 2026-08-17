/**
 * The layout document shape read-only publishing speaks.
 *
 * Types only. The normalizers that used to build these from a ProseMirror
 * document went with the interactive editor; publishing receives Markdown and
 * builds its own layout document, so nothing here needs to run.
 */
export type {
    LayoutBlock,
    LayoutBlockStyle,
    LayoutDocument,
    LayoutInlineKind,
    LayoutInlineMark,
    LayoutInlineRun,
    LayoutInlineStyle,
    LayoutNormalizationOptions,
    LayoutNormalizationSource,
    LayoutStyleContext,
    LayoutViewport,
} from "./types";
