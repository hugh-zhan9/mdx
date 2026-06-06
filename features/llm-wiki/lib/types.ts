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
    pending: string[];
    completed: string[];
    skipped: string[];
}

export interface LlmWikiKnowledgeConfig {
    paused: boolean;
    skipPaths: string[];
}

export interface LlmWikiPanelState {
    mode: LlmWikiMode;
    llmConfigured: boolean;
    paused: boolean;
    totalRawFiles: number;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
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
    statusLines: string[];
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
