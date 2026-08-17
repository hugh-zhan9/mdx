/**
 * The full-window views the workspace can show.
 *
 * Each replaces the editor rather than sharing space with it. LLM Wiki used to
 * live in the right sidebar beside the outline, where it had about seven hundred
 * pixels for three modes that each carry a form and its results — the query box,
 * the digest form and the status readout were all being folded into a column
 * meant for a list of headings. It is a workspace-level tool, like memory, so it
 * gets the window like memory does.
 *
 * With it moved out, the right panel holds only the outline, and the switch that
 * used to pick between them is gone: a tab bar with one tab names nothing.
 */
export type WorkspaceView = "editor" | "memory" | "llmWiki";

export interface WorkspaceViewToggle {
    view: Exclude<WorkspaceView, "editor">;
    /** Label shown when the view is not active — the invitation to open it. */
    openLabel: string;
    /** Label shown while it is active — the way back. */
    closeLabel: string;
}

/**
 * The toolbar's view toggles, in the order they appear.
 *
 * Each is its own button rather than one cycling control, so the toolbar says
 * what is available instead of requiring the user to click through to find out.
 */
export function buildWorkspaceViewToggles(): WorkspaceViewToggle[] {
    return [
        { view: "memory", openLabel: "记忆", closeLabel: "返回编辑器" },
        { view: "llmWiki", openLabel: "LLM Wiki", closeLabel: "返回编辑器" },
    ];
}
