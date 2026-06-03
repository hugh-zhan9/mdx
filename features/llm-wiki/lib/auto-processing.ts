import type { LlmWikiOperation } from "./operation-state";
import type { LlmWikiMode } from "./types";

interface AutoProcessingInput {
    isReady: boolean;
    mode: LlmWikiMode;
    hasApiKey: boolean;
    activeOperation: LlmWikiOperation | null;
    canAutoProcess: boolean;
    rootPath: string;
}

export function shouldStartAutoProcessing({
    isReady,
    mode,
    hasApiKey,
    activeOperation,
    canAutoProcess,
    rootPath,
}: AutoProcessingInput) {
    return (
        isReady &&
        mode === "llmWiki" &&
        hasApiKey &&
        activeOperation === null &&
        canAutoProcess &&
        rootPath.trim().length > 0
    );
}

export function createAutoProcessingTracker() {
    const claimedRootPaths = new Set<string>();

    return {
        claim(rootPath: string) {
            if (!rootPath) {
                return false;
            }

            if (claimedRootPaths.has(rootPath)) {
                return false;
            }

            claimedRootPaths.add(rootPath);
            return true;
        },
    };
}
