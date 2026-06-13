export type MemoryMode = "ordinary" | "memory";

export interface MemoryWorkspaceStatus {
  mode: MemoryMode;
  hasMemory: boolean;
  canInitialize: boolean;
  missingPaths: string[];
}

export interface InitializeMemoryResult {
  createdPaths: string[];
  preservedPaths: string[];
  status: MemoryWorkspaceStatus;
}

export interface RecallRequest {
  query: string;
  limit?: number | null;
  byteBudget?: number | null;
  includeWorking?: boolean;
  includeThreads?: boolean;
  threadIds?: string[];
  includeWikiRefs?: boolean;
  includeWikiSnippets?: boolean;
  tag?: string | null;
  since?: string | null;
}

export interface RecallMemoryItem {
  memoryId: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
  importance: number;
}

export interface RecallResult {
  working: string | null;
  memories: RecallMemoryItem[];
  threads: MemorySummary[];
  wikiRefs: MemorySummary[];
  truncated: boolean;
  byteCount: number;
  indexDegraded: boolean;
  warnings: string[];
}

export interface MemoryListFilter {
  tag?: string | null;
  since?: string | null;
  includeArchived?: boolean;
}

export interface MemorySummary {
  path: string;
  memoryId: string;
  title: string;
  status: string;
  createdAt: string;
  tags: string[];
}

export interface ThreadListFilter {
  source?: string | null;
  since?: string | null;
}

export interface ThreadListItem {
  path: string;
  threadId: string;
  source: string;
  title: string;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number | null;
  archived: boolean;
}

export interface MemoryFrontmatter {
  schemaVersion: number;
  kind: string;
  memoryId: string;
  title: string;
  status: string;
  createdAt: string;
  sourceThread: string | null;
  sourceMessageRefs: string[];
  importance: number | null;
  confidence: number | null;
  tags: string[];
  evolvesFrom: string | null;
}

export interface MemoryRecord {
  path: string;
  frontmatter: MemoryFrontmatter;
  body: string;
}

export interface InboxFrontmatter {
  schemaVersion: number;
  kind: string;
  inboxId: string;
  title: string;
  status: string;
  createdAt: string;
  sourceThread: string | null;
  sourceMessageRefs: string[];
  importance: number | null;
  confidence: number | null;
  tags: string[];
  distillRunId: string | null;
  acceptedMemoryId: string | null;
}

export interface InboxRecord {
  path: string;
  frontmatter: InboxFrontmatter;
  body: string;
}

export interface InboxReviewRequest {
  inboxId: string;
  title?: string | null;
  body?: string | null;
  tags?: string[] | null;
}

export interface InboxReviewResult {
  inboxId: string;
  path: string;
  status: string;
  acceptedMemoryId: string | null;
  memory: MemoryRecord | null;
}

export interface MemoryPromoteRequest {
  target: string;
  ingest: boolean;
  title?: string | null;
}

export interface MemoryPromoteResult {
  threadPath: string;
  promotedPath: string;
  ingested: boolean;
}
