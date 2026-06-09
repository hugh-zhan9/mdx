import type {
    DeletedFilePrompt,
    DraftPrompt,
    DraftRecord,
    ExternalConflictPrompt,
} from "./types";

export function createDraftPrompt(
    draft: DraftRecord,
    fileExists: boolean,
): DraftPrompt {
    return {
        kind: "draft",
        draft,
        fileExists,
        priority: fileExists ? "normal" : "high",
    };
}

export function createExternalConflictPrompt(input: {
    path: string;
    currentMarkdown: string;
    diskMarkdown: string;
}): ExternalConflictPrompt {
    return {
        kind: "externalConflict",
        path: input.path,
        currentMarkdown: input.currentMarkdown,
        diskMarkdown: input.diskMarkdown,
        priority: "high",
    };
}

export function createDeletedFilePrompt(
    path: string,
    dirty: boolean,
): DeletedFilePrompt {
    return {
        kind: "deletedFile",
        path,
        dirty,
        priority: dirty ? "high" : "normal",
    };
}
