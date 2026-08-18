/**
 * The only place the memory commands are named.
 *
 * Every function here is one command and nothing else — no retries, no
 * defaulting, no shaping of the answer. When a command fails the error reaches
 * the panel intact, because what the backend says went wrong is usually the
 * only useful thing on the screen.
 */

import { tauriCore } from "@/common/lib/tauri";
import type {
  AdoptedConclusion,
  Brief,
  BundleExport,
  BundleImport,
  ContextPack,
  DistilledConclusion,
  GateReport,
  GlobalMemoryConfig,
  IngestOutcome,
  LegacyImportPreflight,
  LegacyImportReport,
  ListFilter,
  MemoryAgentSetupRequest,
  MemoryAgentSetupResult,
  MemoryDiagnostics,
  MemoryDoctorReport,
  MemoryIntegrationStatus,
  MemoryStatus,
  ModelStatus,
  ProjectSummary,
  RecallResult,
  ReindexReport,
  RetireReasonType,
  RetiredConclusion,
  SearchHit,
  StoredItem,
  WorkspaceMemoryConfig,
  WrittenEvidence,
} from "./types";

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await tauriCore();
  return invoke<T>(command, args);
}

export function getMemoryStatus(rootPath: string): Promise<MemoryStatus> {
  return invokeCommand("memory_status", { rootPath });
}

export function setMemoryEnabled(
  rootPath: string,
  enabled: boolean,
): Promise<MemoryStatus> {
  return invokeCommand("memory_enable", { rootPath, enabled });
}

export function getWorkspaceConfig(
  rootPath: string,
): Promise<WorkspaceMemoryConfig> {
  return invokeCommand("memory_config_get", { rootPath });
}

export function setWorkspaceConfig(
  rootPath: string,
  config: WorkspaceMemoryConfig,
): Promise<WorkspaceMemoryConfig> {
  return invokeCommand("memory_config_set", { rootPath, config });
}

export function getGlobalConfig(): Promise<GlobalMemoryConfig> {
  return invokeCommand("memory_global_config_get");
}

export function setGlobalConfig(
  config: GlobalMemoryConfig,
): Promise<GlobalMemoryConfig> {
  return invokeCommand("memory_global_config_set", { config });
}

export function getDiagnostics(): Promise<MemoryDiagnostics> {
  return invokeCommand("memory_diagnostics");
}

export function listProjects(): Promise<ProjectSummary[]> {
  return invokeCommand("memory_projects");
}

export function rebindProject(
  wing: string,
  rootPath: string,
): Promise<void> {
  return invokeCommand("memory_rebind_project", { wing, rootPath });
}

export function getModelStatus(): Promise<ModelStatus> {
  return invokeCommand("memory_model_status");
}

export function downloadModel(): Promise<ModelStatus> {
  return invokeCommand("memory_model_download");
}

export function rebuildIndex(): Promise<ReindexReport> {
  return invokeCommand("memory_reindex");
}

export function searchMemory(
  query: string,
  topK?: number,
): Promise<SearchHit[]> {
  return invokeCommand("memory_search", { request: { query, topK } });
}

export function loadContext(
  rootPath: string,
  query: string,
): Promise<ContextPack> {
  return invokeCommand("memory_context", { rootPath, query: { query } });
}

export function loadBrief(rootPath: string, query: string): Promise<Brief> {
  return invokeCommand("memory_brief", { rootPath, query: { query } });
}

export function recall(
  rootPath: string,
  query: string,
): Promise<RecallResult> {
  return invokeCommand("memory_recall", { rootPath, query: { query } });
}

export function addMaterial(
  rootPath: string,
  body: string,
  source?: string,
): Promise<WrittenEvidence> {
  return invokeCommand("memory_add", { rootPath, request: { body, source } });
}

export function importPath(
  rootPath: string,
  path: string,
): Promise<IngestOutcome> {
  return invokeCommand("memory_import_path", { rootPath, path });
}

export function listStored(
  rootPath: string,
  filter: ListFilter,
): Promise<StoredItem[]> {
  return invokeCommand("memory_list", { rootPath, filter });
}

export function showStored(drawerId: string): Promise<StoredItem> {
  return invokeCommand("memory_show", { drawerId });
}

export function deleteStored(drawerId: string): Promise<boolean> {
  return invokeCommand("memory_delete", { drawerId });
}

export function purgeDeleted(before?: string): Promise<number> {
  return invokeCommand("memory_purge", { before });
}

export function distillConclusion(
  rootPath: string,
  request: {
    statement: string;
    body: string;
    tier?: string;
    supportingRefs: string[];
  },
): Promise<DistilledConclusion> {
  return invokeCommand("memory_distill", { rootPath, request });
}

export function checkGate(drawerId: string): Promise<GateReport> {
  return invokeCommand("memory_gate", { drawerId });
}

export function adoptConclusion(
  rootPath: string,
  drawerId: string,
  note?: string,
): Promise<AdoptedConclusion> {
  return invokeCommand("memory_adopt", {
    rootPath,
    request: { drawerId, note },
  });
}

export function retireConclusion(request: {
  drawerId: string;
  reasonType: RetireReasonType;
  reason: string;
  evidenceRefs: string[];
  retire: boolean;
}): Promise<RetiredConclusion> {
  return invokeCommand("memory_demote", { request });
}

export function addCounterexample(
  rootPath: string,
  drawerId: string,
  body: string,
): Promise<GateReport> {
  return invokeCommand("memory_counterexample_add", {
    rootPath,
    request: { drawerId, body },
  });
}

export function legacyImportPreflight(
  rootPath: string,
): Promise<LegacyImportPreflight> {
  return invokeCommand("memory_legacy_preflight", { rootPath });
}

export function legacyImport(rootPath: string): Promise<LegacyImportReport> {
  return invokeCommand("memory_legacy_import", { rootPath });
}

export function exportBundle(
  rootPath: string,
  outputPath: string,
): Promise<BundleExport> {
  return invokeCommand("memory_export_bundle", { rootPath, outputPath });
}

export function importBundle(inputPath: string): Promise<BundleImport> {
  return invokeCommand("memory_import_bundle", { inputPath });
}

export function getMemoryIntegrationStatus(
  rootPath: string,
): Promise<MemoryIntegrationStatus[]> {
  return invokeCommand("memory_integration_status", { rootPath });
}

export function repairMemoryIntegration(
  rootPath: string,
  agent: string,
): Promise<MemoryDoctorReport> {
  return invokeCommand("memory_integration_repair", { rootPath, agent });
}

export function setupMemoryAgents(
  rootPath: string,
  request: MemoryAgentSetupRequest,
): Promise<MemoryAgentSetupResult> {
  return invokeCommand("memory_agent_setup", { rootPath, request });
}
