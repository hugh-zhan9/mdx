export type LlmWikiMode = "ordinary" | "llmWiki";

export interface LlmWikiWorkspaceStatus {
    mode: LlmWikiMode;
    hasLlmWiki: boolean;
    canInitialize: boolean;
    missingPaths: string[];
}

export interface InitializeLlmWikiResult {
    createdPaths: string[];
    preservedPaths: string[];
    status: LlmWikiWorkspaceStatus;
}

export type LlmWikiOperationId =
    | "initialize"
    | "rescan"
    | "ingest"
    | "query"
    | "lint"
    | "graph"
    | "digest";

export interface LlmWikiOperationState {
    operationId: string;
    operation: string;
    stage: string;
    cancelled: boolean;
}

export interface PublicLlmProviderConfig {
    baseUrl: string;
    model: string;
    apiMode: LlmProviderApiMode;
    hasApiKey: boolean;
}

export type LlmProviderApiMode = "chat" | "responses";

export interface LlmProviderConfigForm {
    baseUrl: string;
    model: string;
    apiMode: LlmProviderApiMode;
    apiKey: string;
    preserveApiKey: boolean;
}

export interface RawScanResult {
    total: number;
    pendingTotal: number;
    pending: string[];
    completed: string[];
    failed: LlmWikiFailedFile[];
    skipped: string[];
}

export interface LlmWikiFailedFile {
    path: string;
    reason: string;
}

export interface LlmWikiKnowledgeConfig {
    paused: boolean;
    skipPaths: string[];
}

/**
 * What an ingest is doing right now.
 *
 * Fields rather than a rendered paragraph: only `elapsedSeconds` changes on most
 * ticks, so the panel can redraw a number instead of replacing a block — which is
 * what made the area flicker once a second.
 */
export interface LlmWikiProgress {
    /** Which file of the batch, counting from one. */
    index: number;
    total: number;
    file: string;
    elapsedSeconds: number;
    completed: number;
    failed: number;
}

export interface LlmWikiPanelState {
    mode: LlmWikiMode;
    llmConfigured: boolean;
    paused: boolean;
    totalRawFiles: number;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    failed: LlmWikiFailedFile[];
    skippedCount: number;
}

export type LlmWikiPanelModeId = "status" | "ask" | "digest";

export interface LlmWikiPanelModeViewModel {
    id: LlmWikiPanelModeId;
    label: string;
    disabled: boolean;
}

export type LlmWikiSecondaryActionId = "lint" | "graph";

export interface LlmWikiSecondaryActionViewModel {
    id: LlmWikiSecondaryActionId;
    label: string;
    disabled: boolean;
}

export interface LlmWikiEmptyStateViewModel {
    title: string;
    description: string;
    actionLabel: string | null;
}

export interface LlmWikiStatusViewModel {
    title: string;
    primaryAction: string;
    /**
     * The facts about this workspace, as label and value.
     *
     * Pairs rather than the pre-joined strings this used to hold: those forced one
     * fact per line wherever they were rendered, which turned six numbers into six
     * rows of a column that had room for all of them on one.
     */
    statusStats: Array<{ label: string; value: string }>;
    failed: LlmWikiFailedFile[];
    modes: LlmWikiPanelModeViewModel[];
    secondaryActions: LlmWikiSecondaryActionViewModel[];
    emptyState: LlmWikiEmptyStateViewModel | null;
}

export interface WikiSearchResult {
    path: string;
    title: string;
    snippet: string;
}

export interface LlmWikiQueryResponse {
    answer: string;
    references: WikiSearchResult[];
    insufficientContext: boolean;
}

export interface LlmWikiDigestResult {
    path: string;
}

export interface LlmWikiLintResult {
    report: string;
}
