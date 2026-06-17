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

export interface MemoryAgentSetupRequest {
  codex: boolean;
  claude: boolean;
  cursor: boolean;
  hooks: boolean;
  dry_run?: boolean;
  mdx_cli?: string | null;
  mdx_mcp?: string | null;
}

export interface MemoryAgentSetupResult {
  dry_run: boolean;
  changed_paths: string[];
  summary: string;
}

export type MemoryBackendHealth =
  | "running"
  | "degraded"
  | "disabled"
  | "stopped";

export interface MemoryBackendStatus {
  ok: boolean;
  daemon: {
    status: MemoryBackendHealth;
    last_error: string | null;
  };
  storage: {
    backend: "sqlite" | "postgresql" | string;
    status: string;
  };
  queue: {
    depth: number;
    oldest_job_age_seconds: number | null;
  };
  projection: {
    status: string;
    dirty_count: number;
  };
  today: {
    captured_events: number;
    pending_candidates: number;
  };
}

export interface MemoryIntegrationStatus {
  agent_source: "codex" | "claude" | "cursor";
  installed: boolean;
  enabled: boolean;
  authorized: boolean;
  hook_version: string | null;
  last_event_at: string | null;
  last_error: string | null;
  doctor_status: string;
}

export interface MemoryDoctorReport {
  ok: boolean;
  statuses: MemoryIntegrationStatus[];
  errors: string[];
  warnings: string[];
}

export interface MemoryConfigSetRequest {
  scope: "workspace";
  key: string;
  enabled: boolean;
}

export interface MemoryConfigUpdateRequest {
  scope: "workspace";
  provider?: {
    mode?: string;
    provider?: string | null;
    model?: string | null;
  };
  storage?: {
    backend?: string;
    postgres_url_ref?: string | null;
  };
}

export interface MemoryConfig {
  version: number;
  memory: { enabled: boolean };
  agent_backend: {
    enabled: boolean;
    capture_enabled: boolean;
    recall_injection_enabled: boolean;
    distill_enabled: boolean;
    auto_accept: boolean;
    context_byte_budget: number;
  };
  projection: { enabled: boolean };
  agents: {
    codex: { enabled: boolean; paused: boolean };
    claude: { enabled: boolean; paused: boolean };
    cursor: { enabled: boolean; paused: boolean };
  };
  storage: {
    backend: string;
    sqlite_path: string | null;
    postgres_url_ref: string | null;
  };
  provider: {
    mode: string;
    provider: string | null;
    model: string | null;
  };
}

export interface MemoryStorageMigrateRequest {
  from: string;
  to: string;
  target: string | null;
  dry_run: boolean;
  resume: boolean;
}

export interface MemoryStorageMigrationReport {
  migration_id: string;
  from: string;
  to: string;
  dry_run: boolean;
  records_seen: Record<string, number>;
  records_copied: Record<string, number>;
  records_skipped: Record<string, number>;
  validation_errors: string[];
  backup_path: string | null;
  config_switched: boolean;
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

export interface MemoryAddRequest {
  title: string;
  body: string;
  tags?: string[] | null;
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
