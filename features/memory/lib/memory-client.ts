import { tauriCore } from "@/common/lib/tauri";
import type {
  MemoryAddRequest,
  InboxRecord,
  InboxReviewRequest,
  InboxReviewResult,
  InitializeMemoryResult,
  MemoryAgentSetupRequest,
  MemoryAgentSetupResult,
  MemoryBackendStatus,
  MemoryConfig,
  MemoryConfigSetRequest,
  MemoryConfigUpdateRequest,
  MemoryDoctorReport,
  MemoryIndexStatus,
  MemoryIntegrationStatus,
  MemoryListFilter,
  MemoryPromoteRequest,
  MemoryPromoteResult,
  MemoryRecord,
  MemoryRepairRequest,
  MemoryRepairResult,
  MemoryStorageMigrateRequest,
  MemoryStorageMigrationReport,
  MemorySummary,
  MemoryThreadRecord,
  MemoryWorkspaceStatus,
  RecallRequest,
  RecallResult,
  ThreadListFilter,
  ThreadListItem,
} from "./types";

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await tauriCore();
  return invoke<T>(command, args);
}

export function detectMemoryWorkspace(
  rootPath: string,
): Promise<MemoryWorkspaceStatus> {
  return invokeCommand("memory_detect_workspace", { rootPath });
}

export function initializeMemoryWorkspace(
  rootPath: string,
): Promise<InitializeMemoryResult> {
  return invokeCommand("memory_initialize_workspace", { rootPath });
}

export function repairMemoryWorkspace(
  rootPath: string,
  request: MemoryRepairRequest,
): Promise<MemoryRepairResult> {
  return invokeCommand("memory_repair_workspace", { rootPath, request });
}

export function setupMemoryAgents(
  rootPath: string,
  request: MemoryAgentSetupRequest,
): Promise<MemoryAgentSetupResult> {
  return invokeCommand("memory_agent_setup", { rootPath, request });
}

export function getMemoryBackendStatus(
  rootPath: string,
): Promise<MemoryBackendStatus> {
  return invokeCommand("memory_backend_status", { rootPath });
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

export function setMemoryConfig(
  rootPath: string,
  request: MemoryConfigSetRequest,
): Promise<MemoryConfig> {
  return invokeCommand("memory_config_set", { rootPath, request });
}

export function updateMemoryConfig(
  rootPath: string,
  request: MemoryConfigUpdateRequest,
): Promise<MemoryConfig> {
  return invokeCommand("memory_config_update", { rootPath, request });
}

export function dryRunMemoryStorageMigration(
  rootPath: string,
  request: MemoryStorageMigrateRequest,
): Promise<MemoryStorageMigrationReport> {
  return invokeCommand("memory_storage_migrate_dry_run", {
    rootPath,
    request,
  });
}

export function runMemoryStorageMigration(
  rootPath: string,
  request: MemoryStorageMigrateRequest,
): Promise<MemoryStorageMigrationReport> {
  return invokeCommand("memory_storage_migrate", {
    rootPath,
    request,
  });
}

export function rebuildMemoryIndex(rootPath: string): Promise<MemoryIndexStatus> {
  return invokeCommand("memory_index_rebuild", { rootPath });
}

export function getWorkingMemory(rootPath: string): Promise<string> {
  return invokeCommand("memory_working_get", { rootPath });
}

export function setWorkingMemory(
  rootPath: string,
  markdown: string,
): Promise<string> {
  return invokeCommand("memory_working_set", { rootPath, markdown });
}

export function appendWorkingMemory(
  rootPath: string,
  section: string,
  text: string,
): Promise<string> {
  return invokeCommand("memory_working_append", { rootPath, section, text });
}

export function recallMemory(
  rootPath: string,
  request: RecallRequest,
): Promise<RecallResult> {
  return invokeCommand("memory_recall", { rootPath, request });
}

export function listMemories(
  rootPath: string,
  filter: MemoryListFilter = {},
): Promise<MemorySummary[]> {
  return invokeCommand("memory_list", { rootPath, filter });
}

export function getMemory(
  rootPath: string,
  target: string,
): Promise<MemoryRecord> {
  return invokeCommand("memory_get", { rootPath, target });
}

export function addMemory(
  rootPath: string,
  request: MemoryAddRequest,
): Promise<MemoryRecord> {
  return invokeCommand("memory_add", { rootPath, request });
}

export function archiveMemory(
  rootPath: string,
  target: string,
): Promise<MemoryRecord> {
  return invokeCommand("memory_archive", { rootPath, target });
}

export function listMemoryThreads(
  rootPath: string,
  filter: ThreadListFilter = {},
): Promise<ThreadListItem[]> {
  return invokeCommand("memory_thread_list", { rootPath, filter });
}

export function getMemoryThread(
  rootPath: string,
  target: string,
): Promise<MemoryThreadRecord> {
  return invokeCommand("memory_thread_get", { rootPath, target });
}

export function listMemoryInbox(
  rootPath: string,
  includeReviewed = false,
): Promise<InboxRecord[]> {
  return invokeCommand("memory_inbox_list", { rootPath, includeReviewed });
}

export function acceptMemoryInbox(
  rootPath: string,
  request: InboxReviewRequest,
): Promise<InboxReviewResult> {
  return invokeCommand("memory_inbox_accept", { rootPath, request });
}

export function rejectMemoryInbox(
  rootPath: string,
  target: string,
): Promise<InboxReviewResult> {
  return invokeCommand("memory_inbox_reject", { rootPath, target });
}

export function promoteMemory(
  rootPath: string,
  request: MemoryPromoteRequest,
): Promise<MemoryPromoteResult> {
  return invokeCommand("memory_promote", { rootPath, request });
}
