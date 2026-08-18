/**
 * How wide the workspace window's two columns are.
 *
 * The window is the navigator and the editor. The navigator's width is the
 * user's, within limits; the editor takes the rest, because it is what the
 * window is for.
 */

interface WorkspacePanelLayoutInput {
    containerWidth: number;
    navigatorCollapsed: boolean;
    /** The width the user dragged the folder tree to. */
    railWidth: number;
    /** The width the user dragged the note list to. */
    listWidth: number;
}

interface WorkspacePanelLayout {
    /** The two navigator columns as drawn, after the window has its say. */
    railWidth: number;
    listWidth: number;
    /** Their sum: what the navigator occupies. */
    navigatorWidth: number;
    editorWidth: number;
}

/** The rail's width in a workspace nobody has dragged it in yet. */
export const NAVIGATOR_RAIL_WIDTH = 208;

/** How narrow the rail may get before its labels stop fitting. */
export const MIN_RAIL_WIDTH = 150;

/** How wide the rail may get before it is competing with the list. */
export const MAX_RAIL_WIDTH = 360;

/** How narrow the note list may get before it stops being a list. */
export const MIN_NAVIGATOR_LIST_WIDTH = 200;

/** The folder tree's width, within its own limits. */
export function clampRailWidth(railWidth: number) {
    if (!Number.isFinite(railWidth)) {
        return NAVIGATOR_RAIL_WIDTH;
    }

    return Math.round(
        Math.min(Math.max(railWidth, MIN_RAIL_WIDTH), MAX_RAIL_WIDTH),
    );
}

/** The note list's width, within its own limits. */
export function clampListWidth(listWidth: number) {
    if (!Number.isFinite(listWidth)) {
        return DEFAULT_LIST_WIDTH;
    }

    return Math.round(
        Math.min(
            Math.max(listWidth, MIN_NAVIGATOR_LIST_WIDTH),
            MAX_LIST_WIDTH,
        ),
    );
}

/** The note list's width in a workspace nobody has dragged it in yet. */
export const DEFAULT_LIST_WIDTH = 312;

/** How wide the note list may get before it is competing with the editor. */
export const MAX_LIST_WIDTH = 560;

/** The widest either navigator column may be stored as. */
export const MAX_NAVIGATOR_WIDTH = MAX_RAIL_WIDTH + MAX_LIST_WIDTH;

/**
 * What the editor needs before the navigator is asked to give anything up.
 *
 * Not a floor it always gets: a window narrow enough that both cannot be
 * satisfied gives the navigator its own minimum and lets the editor be narrow,
 * because a navigator with no list in it is not a navigator at all.
 */
const MIN_EDITOR_WIDTH = 560;

export function calculateWorkspacePanelLayout({
    containerWidth,
    navigatorCollapsed,
    railWidth,
    listWidth,
}: WorkspacePanelLayoutInput): WorkspacePanelLayout {
    if (navigatorCollapsed) {
        return {
            railWidth: 0,
            listWidth: 0,
            navigatorWidth: 0,
            editorWidth: Math.max(0, containerWidth),
        };
    }

    let rail = clampRailWidth(railWidth);
    let list = clampListWidth(listWidth);
    const roomBesideEditor = Math.max(0, containerWidth - MIN_EDITOR_WIDTH);
    let overflow = rail + list - roomBesideEditor;

    // The list gives room up first: it is the column that was sized for
    // comfort, while the tree was sized to fit the paths in it.
    if (overflow > 0) {
        const given = Math.min(overflow, list - MIN_NAVIGATOR_LIST_WIDTH);
        list -= given;
        overflow -= given;
    }

    if (overflow > 0) {
        rail -= Math.min(overflow, rail - MIN_RAIL_WIDTH);
    }

    const navigatorWidth = rail + list;

    return {
        railWidth: rail,
        listWidth: list,
        navigatorWidth,
        editorWidth: Math.max(0, containerWidth - navigatorWidth),
    };
}
