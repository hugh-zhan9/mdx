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

export interface PublicLlmProviderConfig {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
}

export interface LlmProviderConfigForm {
    baseUrl: string;
    model: string;
    apiKey: string;
    preserveApiKey: boolean;
}

export interface RawScanResult {
    total: number;
    pending: string[];
    skipped: string[];
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

export interface LlmWikiStatusViewModel {
    title: string;
    primaryAction: string;
    statusLines: string[];
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
