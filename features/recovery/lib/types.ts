export interface DraftRecord {
    draftId: string;
    realPath: string;
    displayPath?: string | null;
    mode: "workspace" | "document" | string;
    baseFingerprint?: string | null;
    updatedAt: string;
    markdown: string;
}

export interface DraftSummary extends Omit<DraftRecord, "markdown"> {
    fileExists: boolean;
}

export interface DraftGetResult {
    draft: DraftRecord | null;
    fileExists: boolean;
    currentFingerprint?: string | null;
}

export interface DraftPrompt {
    kind: "draft";
    draft: DraftRecord;
    fileExists: boolean;
    priority: "normal" | "high";
}

export interface ExternalConflictPrompt {
    kind: "externalConflict";
    path: string;
    currentMarkdown: string;
    diskMarkdown: string;
    priority: "high";
}

export interface DeletedFilePrompt {
    kind: "deletedFile";
    path: string;
    dirty: boolean;
    priority: "normal" | "high";
}

export type RecoveryPrompt =
    | DraftPrompt
    | ExternalConflictPrompt
    | DeletedFilePrompt;

export interface DiffLine {
    kind: "equal" | "added" | "removed";
    leftLine: number | null;
    rightLine: number | null;
    text: string;
}
