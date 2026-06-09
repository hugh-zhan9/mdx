import { tauriCore } from "@/common/lib/tauri";
import type { DraftGetResult, DraftSummary } from "./types";

interface DraftSaveRequest {
    realPath: string;
    displayPath?: string | null;
    markdown: string;
    baseFingerprint?: string | null;
    mode: "workspace" | "document" | string;
}

interface DraftSaveResult {
    draftId: string;
    updatedAt: string;
}

interface DraftListResult {
    drafts: DraftSummary[];
}

interface DraftDeleteResult {
    deleted: boolean;
}

interface DraftCleanupResult {
    deleted: number;
    kept: number;
}

type DraftDeleteInput =
    | { draftId: string; realPath?: string }
    | { draftId?: string; realPath: string };

async function invokeDraftCommand<T>(
    command: string,
    args?: Record<string, unknown>,
): Promise<T> {
    const { invoke } = await tauriCore();
    return invoke<T>(command, args);
}

export function draftSave(request: DraftSaveRequest): Promise<DraftSaveResult> {
    return invokeDraftCommand("draft_save", { request });
}

export function draftGet(realPath: string): Promise<DraftGetResult> {
    return invokeDraftCommand("draft_get", { realPath });
}

export function draftListForWorkspace(
    rootPath: string,
): Promise<DraftListResult> {
    return invokeDraftCommand("draft_list_for_workspace", { rootPath });
}

export function draftDelete(input: DraftDeleteInput): Promise<DraftDeleteResult> {
    return invokeDraftCommand("draft_delete", {
        draftId: input.draftId ?? null,
        realPath: input.realPath ?? null,
    });
}

export function draftCleanupExpired(
    retentionDays: number,
): Promise<DraftCleanupResult> {
    return invokeDraftCommand("draft_cleanup_expired", { retentionDays });
}
