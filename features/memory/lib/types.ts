export type MemoryMode = "ordinary" | "memory";

export interface MemoryWorkspaceStatus {
  mode: MemoryMode;
  has_memory: boolean;
  can_initialize: boolean;
  missing_paths: string[];
}

export interface InitializeMemoryResult {
  created_paths: string[];
  preserved_paths: string[];
  status: MemoryWorkspaceStatus;
}

export interface MemoryRepairRequest {
  rebuild_index: boolean;
}

export interface MemoryRepairResult {
  repaired_paths: string[];
  warnings: string[];
}

export interface MemoryIndexStatus {
  index_status: string;
  document_count: number;
  dirty: boolean;
}

export interface RecallRequest {
  query: string;
  limit?: number | null;
  byte_budget?: number | null;
  include_working?: boolean;
  include_threads?: boolean;
  thread_ids?: string[];
  include_wiki_refs?: boolean;
  include_wiki_snippets?: boolean;
  tag?: string | null;
  since?: string | null;
}

export interface RecallMemoryItem {
  memory_id: string;
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
  wiki_refs: MemorySummary[];
  truncated: boolean;
  byte_count: number;
  index_degraded: boolean;
  warnings: string[];
}

export interface MemoryListFilter {
  tag?: string | null;
  since?: string | null;
  include_archived?: boolean;
}

export interface MemorySummary {
  path: string;
  memory_id: string;
  title: string;
  status: string;
  created_at: string;
  tags: string[];
}

export interface ThreadListFilter {
  source?: string | null;
  since?: string | null;
}

export interface ThreadListItem {
  path: string;
  thread_id: string;
  source: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  message_count: number | null;
  archived: boolean;
}

export interface MemoryThreadFrontmatter {
  schema_version: number;
  kind: string;
  thread_id: string;
  source: string;
  title: string;
  content_hash: string;
  started_at: string | null;
  ended_at: string | null;
  message_count: number | null;
  model: string | null;
  workspace_root: string | null;
  tags: string[];
  distilled: boolean;
  promoted_to_wiki: boolean;
  archived: boolean;
}

export interface MemoryThreadRecord {
  path: string;
  frontmatter: MemoryThreadFrontmatter;
  body: string;
}

export interface MemoryFrontmatter {
  schema_version: number;
  kind: string;
  memory_id: string;
  title: string;
  status: string;
  created_at: string;
  source_thread: string | null;
  source_message_refs: string[];
  importance: number | null;
  confidence: number | null;
  tags: string[];
  evolves_from: string | null;
}

export interface MemoryRecord {
  path: string;
  frontmatter: MemoryFrontmatter;
  body: string;
}

export interface InboxFrontmatter {
  schema_version: number;
  kind: string;
  inbox_id: string;
  title: string;
  status: string;
  created_at: string;
  source_thread: string | null;
  source_message_refs: string[];
  importance: number | null;
  confidence: number | null;
  tags: string[];
  distill_run_id: string | null;
  accepted_memory_id: string | null;
}

export interface InboxRecord {
  path: string;
  frontmatter: InboxFrontmatter;
  body: string;
}

export interface InboxReviewRequest {
  inbox_id: string;
  title?: string | null;
  body?: string | null;
  tags?: string[] | null;
}

export interface InboxReviewResult {
  inbox_id: string;
  path: string;
  status: string;
  accepted_memory_id: string | null;
  memory: MemoryRecord | null;
}

export interface MemoryPromoteRequest {
  target: string;
  ingest: boolean;
  title?: string | null;
}

export interface MemoryPromoteResult {
  thread_path: string;
  promoted_path: string;
  ingested: boolean;
}
