import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { getSharedMarkdownAnalyzer } from "../milkdown/markdown-analyzer";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";
import {
    createSourceEditorHost,
    type SourceEditorHost,
} from "../source/source-host";
import { editorServicePlugins } from "./editor-services";
import type {
    DocumentSelectionRange,
    EditorAdapterDiagnostic,
    EditorFindRequest,
    EditorImageInsertion,
    EditorSurfaceMode,
    EditorSurfaceServiceReader,
    EditorLinkActivation,
    EditorLinkLabels,
    EditorWikilinkActivation,
} from "./types";

/**
 * What the adapter needs from whichever surface is mounted.
 *
 * WYSIWYG and source are two views of one document session. They are mutually
 * exclusive — only one is ever mounted — and both speak the same coordinate
 * space, Markdown UTF-16 source offsets, so the adapter drives them
 * identically and never learns which is active except to report it.
 */
export interface EditingSurface {
    readonly mode: EditorSurfaceMode;
    getMarkdown(): string;
    getSelection(): DocumentSelectionRange | null;
    setSelection(range: DocumentSelectionRange): boolean;
    /**
     * Places the selection *and* brings it into view, reporting whether the
     * range resolved.
     *
     * Distinct from `setSelection` because the two are asked for by different
     * things. A selection restored with a tab, or moved as part of an edit,
     * should disturb the viewport as little as possible. A range the user
     * asked to be taken to — an outline heading, a CLI focus — should land
     * somewhere they can read it, which means scrolling further than "just
     * barely visible".
     */
    revealRange(range: DocumentSelectionRange): boolean;
    /**
     * Paints the find matches so every one of them is visible, marking one as
     * current.
     *
     * Decoration only: the highlights never enter the document, the Markdown or
     * the clipboard, and a document with them serializes identically to the same
     * document without them. An empty list clears them.
     */
    setFindHighlights(
        ranges: DocumentSelectionRange[],
        activeIndex: number | null,
    ): void;
    replaceMarkdown(markdown: string): boolean;
    setEditable(editable: boolean): void;
    focus(): void;
    replaceSourceRange(range: DocumentSelectionRange, text: string): boolean;
    /**
     * Puts an image in a source range, reporting whether it applied.
     *
     * The surface is told what to insert, not how to write it: the visual
     * surface builds an image node, the source surface writes the Markdown that
     * parses into one. Neither is a special case of the other, and neither
     * decides by inspecting a string it was handed.
     */
    insertImage(
        range: DocumentSelectionRange,
        image: EditorImageInsertion,
    ): boolean;
    /**
     * Every match for `request` in the document this surface holds, in document
     * order, as Markdown source ranges.
     */
    findMatches(request: EditorFindRequest): DocumentSelectionRange[];
    /**
     * Maps a range pinned when the document held `baseMarkdown` onto the
     * document as it stands now, or null when no faithful mapping exists.
     */
    mapPinnedRange(
        baseMarkdown: string,
        range: DocumentSelectionRange,
    ): DocumentSelectionRange | null;
    flush(): void;
    destroy(): Promise<void>;
}

export interface EditingSurfaceOptions {
    root: HTMLElement;
    markdown: string;
    editable: boolean;
    onMarkdownChange(markdown: string): void;
    onSelectionChange(): void;
    onDiagnostic?(diagnostic: EditorAdapterDiagnostic): void;
    /**
     * Fires when the user activates a wikilink. Only the visual surface renders
     * them; in source mode a wikilink is text the user is editing.
     */
    onOpenWikilink?(activation: EditorWikilinkActivation): void;
    /**
     * Fires when the user activates an ordinary link. Only the visual surface
     * renders one; in source mode a link is text the user is editing.
     */
    onOpenLink?(activation: EditorLinkActivation): void;
    /**
     * What the link editor the visual surface offers while the caret is inside a
     * link calls its parts, in the product's language.
     */
    linkEditorLabels?: EditorLinkLabels;
    /**
     * Reads the product capabilities the visual surface renders with. The
     * source surface is Markdown text and needs none of them.
     */
    readServices?: EditorSurfaceServiceReader;
    scheduleChangeEmission?: (emit: () => void) => void;
}

/**
 * Markdown that produces one image.
 *
 * Used only by the source surface, where the document *is* Markdown, so writing
 * the image means writing these characters. The visual surface never sees this:
 * it inserts a node.
 */
function markdownForImage(image: EditorImageInsertion): string {
    const alt = image.alt ?? "";
    return image.title
        ? `![${alt}](${image.src} "${image.title}")`
        : `![${alt}](${image.src})`;
}

function wrapMilkdown(host: MilkdownEditorHost): EditingSurface {
    return {
        mode: "wysiwyg",
        getMarkdown: () => host.getMarkdown(),
        getSelection: () => host.getSelection(),
        setSelection: (range) => host.setSelection(range),
        revealRange: (range) => host.revealRange(range),
        setFindHighlights: (ranges, activeIndex) =>
            host.setFindHighlights(ranges, activeIndex),
        replaceMarkdown: (markdown) => host.replaceMarkdown(markdown),
        setEditable: (editable) => host.setEditable(editable),
        focus: () => host.focus(),
        replaceSourceRange: (range, text) => host.replaceSourceRange(range, text),
        insertImage: (range, image) => host.insertImage(range, image),
        findMatches: (request) => host.findMatches(request),
        mapPinnedRange: (baseMarkdown, range) =>
            host.mapPinnedRange(baseMarkdown, range),
        flush: () => host.flush(),
        destroy: () => host.destroy(),
    };
}

function wrapSource(host: SourceEditorHost): EditingSurface {
    return {
        mode: "source",
        getMarkdown: () => host.getMarkdown(),
        getSelection: () => host.getSelection(),
        setSelection: (range) => host.setSelection(range),
        revealRange: (range) => host.revealRange(range),
        setFindHighlights: (ranges, activeIndex) =>
            host.setFindHighlights(ranges, activeIndex),
        replaceMarkdown: (markdown) => host.replaceMarkdown(markdown),
        setEditable: (editable) => host.setEditable(editable),
        focus: () => host.focus(),
        replaceSourceRange: (range, text) => host.replaceSourceRange(range, text),
        insertImage: (range, image) =>
            host.replaceSourceRange(range, markdownForImage(image)),
        findMatches: (request) => host.findMatches(request),
        mapPinnedRange: (baseMarkdown, range) =>
            host.mapPinnedRange(baseMarkdown, range),
        flush: () => host.flush(),
        destroy: async () => host.destroy(),
    };
}

/**
 * Builds the surface for `mode`.
 *
 * Constructing the WYSIWYG surface *is* the visual-parse preflight: the same
 * plugins, parser and schema the product uses either build a document or throw.
 * A separate check would be a second implementation that could disagree with
 * the real one, and disagreeing here means either refusing a document that is
 * fine or accepting one that is not.
 */
export async function createEditingSurface(
    mode: EditorSurfaceMode,
    options: EditingSurfaceOptions,
): Promise<EditingSurface> {
    if (mode === "source") {
        // Find searches the document's text on both surfaces, and this one
        // holds Markdown. The analyzer is what reads one into the other, using
        // the same syntax layer the visual surface is built from, so the two
        // cannot answer the same query differently.
        const analyzer = await getSharedMarkdownAnalyzer();
        return wrapSource(createSourceEditorHost({ ...options, analyzer }));
    }
    const { onOpenWikilink, onOpenLink, linkEditorLabels, readServices } =
        options;
    const host = await createMilkdownEditorHost({
        ...options,
        plugins: [
            ...createMdxMilkdownPlugins({
                // Both halves of what the syntax layer parsed cross the
                // boundary. The value is rebuilt here rather than forwarded, so
                // the syntax layer's own activation type stays inside the
                // package even though the two shapes currently coincide.
                onWikilinkActivate: onOpenWikilink
                    ? (activation) =>
                          onOpenWikilink({
                              target: activation.target,
                              alias: activation.alias,
                          })
                    : undefined,
                onLinkActivate: onOpenLink
                    ? (activation) => onOpenLink({ href: activation.href })
                    : undefined,
                // Rebuilt rather than forwarded, for the same reason the
                // activations above are: the syntax layer's own shape stays
                // inside the package even where the two coincide.
                linkEditorLabels: linkEditorLabels
                    ? {
                          address: linkEditorLabels.address,
                          open: linkEditorLabels.open,
                          remove: linkEditorLabels.remove,
                      }
                    : undefined,
            }),
            // Last, so the capabilities are in place for every view the syntax
            // layer composed above. What the product can do is not part of what
            // the document means, which is why it is installed beside the
            // syntax rather than inside it.
            ...editorServicePlugins(readServices ?? (() => ({}))),
        ],
    });
    return wrapMilkdown(host);
}
