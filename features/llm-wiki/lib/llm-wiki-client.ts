import { tauriCore } from "@/common/lib/tauri";
import type {
    InitializeLlmWikiResult,
    LlmWikiLintResult,
    LlmWikiWorkspaceStatus,
    PublicLlmProviderConfig,
    RawScanResult,
    WikiSearchResult,
} from "./types";

async function invokeCommand<T>(
    command: string,
    args?: Record<string, unknown>,
): Promise<T> {
    const { invoke } = await tauriCore();
    return invoke<T>(command, args);
}

export function detectLlmWikiWorkspace(
    rootPath: string,
): Promise<LlmWikiWorkspaceStatus> {
    return invokeCommand("llm_wiki_detect_workspace", { rootPath });
}

export function initializeLlmWikiWorkspace(
    rootPath: string,
): Promise<InitializeLlmWikiResult> {
    return invokeCommand("llm_wiki_initialize_workspace", { rootPath });
}

export function getLlmConfig(): Promise<PublicLlmProviderConfig | null> {
    return invokeCommand("llm_config_get");
}

export function rescanRaw(rootPath: string): Promise<RawScanResult> {
    return invokeCommand("llm_wiki_rescan_raw", { rootPath });
}

export function refreshKnowledgeGraph(rootPath: string): Promise<string> {
    return invokeCommand("llm_wiki_refresh_graph", { rootPath });
}

export async function runLint(rootPath: string): Promise<LlmWikiLintResult> {
    const report = await invokeCommand<string>("llm_wiki_lint", { rootPath });
    return { report };
}

export function searchWiki(
    rootPath: string,
    query: string,
): Promise<WikiSearchResult[]> {
    return invokeCommand("llm_wiki_search", { rootPath, query });
}

export async function writeDigestMock(
    rootPath: string,
    title: string,
    content: string,
): Promise<string> {
    return invokeCommand("llm_wiki_digest_mock", {
        rootPath,
        title,
        content,
    });
}

export const runDigestMock = writeDigestMock;
