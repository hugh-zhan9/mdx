import { tauriCore } from "@/common/lib/tauri";
import type {
  InitializeLlmWikiResult,
  LlmWikiKnowledgeConfig,
  LlmWikiLintResult,
  LlmWikiQueryResponse,
  LlmWikiWorkspaceStatus,
  LlmProviderConfigForm,
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

export function saveLlmConfig(
  config: LlmProviderConfigForm,
): Promise<PublicLlmProviderConfig> {
  return invokeCommand("llm_config_update", {
    config: {
      baseUrl: config.baseUrl,
      model: config.model,
      apiMode: config.apiMode,
      apiKey: config.apiKey.trim() ? config.apiKey : null,
      preserveApiKey: config.preserveApiKey,
    },
  });
}

export function rescanRaw(
  rootPath: string,
  excludedPendingPaths: string[] = [],
): Promise<RawScanResult> {
  return invokeCommand("llm_wiki_rescan_raw", {
    rootPath,
    excludedPendingPaths,
  });
}

export function ingestRawFile(
  rootPath: string,
  rawRelativePath: string,
): Promise<void> {
  return invokeCommand("llm_wiki_ingest_raw_file", {
    rootPath,
    rawRelativePath,
  });
}

export function refreshKnowledgeGraph(rootPath: string): Promise<string> {
  return invokeCommand("llm_wiki_refresh_graph", { rootPath });
}

export async function runLint(rootPath: string): Promise<LlmWikiLintResult> {
  const report = await invokeCommand<string>("llm_wiki_lint", { rootPath });
  return { report };
}

export function getLlmWikiConfig(
  rootPath: string,
): Promise<LlmWikiKnowledgeConfig> {
  return invokeCommand("llm_wiki_get_config", { rootPath });
}

export function updateLlmWikiConfig(
  rootPath: string,
  config: LlmWikiKnowledgeConfig,
): Promise<LlmWikiKnowledgeConfig> {
  return invokeCommand("llm_wiki_update_config", {
    rootPath,
    paused: config.paused,
    skipPaths: config.skipPaths,
  });
}

export function getLlmWikiLog(rootPath: string): Promise<string> {
  return invokeCommand("llm_wiki_get_log", { rootPath });
}

export function searchWiki(
  rootPath: string,
  query: string,
): Promise<WikiSearchResult[]> {
  return invokeCommand("llm_wiki_search", { rootPath, query });
}

export function queryWiki(
  rootPath: string,
  question: string,
): Promise<LlmWikiQueryResponse> {
  return invokeCommand("llm_wiki_query", { rootPath, question });
}

export async function createDigest(
  rootPath: string,
  title: string,
  prompt: string,
): Promise<string> {
  return invokeCommand("llm_wiki_digest", {
    rootPath,
    title,
    prompt,
  });
}
