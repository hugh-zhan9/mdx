import type { LlmWikiMode } from "./types";

export interface LlmWikiQueryEligibility {
    isReady: boolean;
    mode: LlmWikiMode;
    question: string;
}

export function canRunLlmWikiQuery({
    isReady,
    mode,
    question,
}: LlmWikiQueryEligibility) {
    return isReady && mode === "llmWiki" && question.trim().length > 0;
}

export interface LlmWikiQueryRequestSnapshot {
    activeRootPath: string;
    requestRootPath: string;
    activeGeneration: number;
    requestGeneration: number;
}

export function isCurrentLlmWikiQueryRequest({
    activeRootPath,
    requestRootPath,
    activeGeneration,
    requestGeneration,
}: LlmWikiQueryRequestSnapshot) {
    return (
        activeRootPath === requestRootPath &&
        activeGeneration === requestGeneration
    );
}
