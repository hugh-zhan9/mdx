import type { NotePageRequest, NotePageResult } from "./note-index";

/**
 * Asks the backend for one page of the workspace's notes.
 *
 * The backend walks the workspace, times every note — which is what ordering by
 * recency and counting the groups both need — and reads the beginning of only
 * the notes on this page. A workspace of tens of thousands of notes therefore
 * costs one stat each and a few dozen reads, not tens of thousands of reads.
 */
export async function loadNotePage(
    request: NotePageRequest,
): Promise<NotePageResult> {
    const { invoke } = await import("@tauri-apps/api/core");

    return invoke<NotePageResult>("workspace_note_page", {
        rootPath: request.rootPath,
        group: request.group,
        query: request.query,
        focusPath: request.focusPath,
        offset: request.offset,
        limit: request.limit,
    });
}
