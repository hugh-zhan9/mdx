import { tauriCore } from "@/common/lib/tauri";
import type {
  InboxRecord,
  InboxReviewRequest,
  InboxReviewResult,
  InitializeMemoryResult,
  MemoryListFilter,
  MemoryPromoteRequest,
  MemoryPromoteResult,
  MemorySummary,
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

export function getWorkingMemory(rootPath: string): Promise<string> {
  return invokeCommand("memory_working_get", { rootPath });
}

export function setWorkingMemory(
  rootPath: string,
  markdown: string,
): Promise<string> {
  return invokeCommand("memory_working_set", { rootPath, markdown });
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

export function listMemoryThreads(
  rootPath: string,
  filter: ThreadListFilter = {},
): Promise<ThreadListItem[]> {
  return invokeCommand("memory_thread_list", { rootPath, filter });
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

export function promoteMemory(
  rootPath: string,
  request: MemoryPromoteRequest,
): Promise<MemoryPromoteResult> {
  return invokeCommand("memory_promote", { rootPath, request });
}
