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
