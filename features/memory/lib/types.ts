/**
 * The shapes the memory commands speak.
 *
 * These mirror the Rust DTOs one for one. The product words are "material" and
 * "conclusion"; the storage layer's own vocabulary — wings, drawers, tiers —
 * stops at this boundary, except where an identifier has to travel back to the
 * backend unchanged.
 */

export interface LibraryStatus {
  path: string;
  exists: boolean;
  schemaVersion: number | null;
  supportedSchemaVersion: number;
  writable: boolean;
  drawerCount: number | null;
  embeddingDim: number | null;
  error: string | null;
}

export interface MemoryStatus {
  enabled: boolean;
  /** The project this workspace is bound to, or null when it has none yet. */
  wing: string | null;
  library: LibraryStatus;
  modelReady: boolean;
  model: string;
}

export interface ModelStatus {
  model: string;
  ready: boolean;
  dir: string;
  missing: string[];
}

export interface ModelDiagnostics {
  model: string;
  ready: boolean;
  dir: string;
  missing: string[];
}

export interface MemoryDiagnostics {
  library: LibraryStatus;
  model: ModelDiagnostics;
  projects: number;
  warnings: string[];
}

export interface ProjectSummary {
  wing: string;
  path: string | null;
  lastActivity: string;
  total: number;
  evidence: number;
  knowledge: number;
}

/** `material` or `conclusion`. */
export type StoredItemKind = "material" | "conclusion";

export type ConclusionStatus =
  | "candidate"
  | "promoted"
  | "canonical"
  | "demoted"
  | "retired";

export interface StoredItem {
  drawerId: string;
  kind: StoredItemKind;
  room: string;
  sourceFile: string | null;
  addedAt: string;
  importance: number;
  /** Conclusions only: the claim itself. */
  statement: string | null;
  status: ConclusionStatus | null;
  /** An excerpt in lists; the whole text when fetched on its own. */
  excerpt: string;
  /** Conclusions only: the material this stands on. Ids; fetch to read them. */
  supportingRefs: string[];
  /** Conclusions only: what was checked before adoption. */
  verificationRefs: string[];
  /** Conclusions only: what stands against it, and blocks promotion. */
  counterexampleRefs: string[];
}

export interface ListFilter {
  kind?: StoredItemKind;
  status?: ConclusionStatus;
  limit?: number;
  /** Read every project in the library rather than this workspace's own. */
  allProjects?: boolean;
}

export interface WrittenEvidence {
  drawerId: string;
  created: boolean;
  lockWaitMs: number;
}

export interface IngestOutcome {
  files: number;
  chunks: number;
  skipped: number;
  room: string;
}

export interface SearchHit {
  drawerId: string;
  sourceFile: string;
  snippet: string;
  score: number;
  wing: string;
  room: string | null;
  /** `evidence` or `knowledge`. */
  kind: string;
  tier: string | null;
}

export interface EvidenceRef {
  drawerId: string;
  /** `supporting`, `verification`, `counterexample`, or `teaching`. */
  role: string;
  sourceFile: string;
}

export interface ContextItem {
  /** Assembly group, not a label to show: the panel has its own words. */
  section: string;
  drawerId: string;
  sourceFile: string;
  text: string;
  tier: string | null;
  status: string | null;
  anchorKind: string;
  anchorId: string;
  evidenceRefs: EvidenceRef[];
}

export interface ContextAnchor {
  anchorKind: string;
  anchorId: string;
}

export interface ContextPack {
  query: string;
  anchors: ContextAnchor[];
  items: ContextItem[];
}

export interface BriefFact {
  text: string;
  drawerId: string;
  sourceFile: string;
}

export interface Uncertainty {
  kind: string;
  message: string;
}

export interface Brief {
  query: string;
  summary: string;
  keyFacts: BriefFact[];
  evidence: BriefFact[];
  uncertainties: Uncertainty[];
  nextActions: string[];
}

export interface RecallResult {
  brief: Brief;
  context: ContextPack;
  hits: SearchHit[];
  truncated: boolean;
}

/** What the promotion gate requires, and what this conclusion has. */
/**
 * The gate's own report, in the field names it actually arrives with.
 *
 * Snake case, unlike everything else across this boundary: the report is
 * upstream's type, serialized as upstream named it, and the commands hand it
 * through untouched. Written as camel case here it type-checked, matched a test
 * factory that had invented the same shape, and crashed the panel the first time a
 * real conclusion rendered — the counts were simply not there.
 */
export interface GateRequirements {
  min_supporting_refs: number;
  min_verification_refs: number;
  min_teaching_refs: number;
  reviewer_required: boolean;
  counterexamples_block: boolean;
}

export interface GateEvidenceCounts {
  supporting: number;
  counterexample: number;
  teaching: number;
  verification: number;
}

export interface GateReport {
  drawer_id: string;
  tier: string;
  status: string;
  target_status: string;
  allowed: boolean;
  /** Why not, in the backend's own words. Shown verbatim. */
  reasons: string[];
  requirements: GateRequirements;
  evidence_counts: GateEvidenceCounts;
}

export interface DistilledConclusion {
  drawerId: string;
  created: boolean;
}

export interface AdoptedConclusion {
  drawerId: string;
  status: string;
  confirmationDrawerId: string;
}

export interface RetiredConclusion {
  drawerId: string;
  status: string;
}

export type ConclusionTier = "concrete" | "pattern";

export type RetireReasonType =
  | "contradicted"
  | "obsolete"
  | "superseded"
  | "out_of_scope"
  | "unsafe";

export interface WorkspaceMemoryConfig {
  version: number;
  enabled: boolean;
  capture: { enabled: boolean; sources: string[] };
  agents: {
    claude: { enabled: boolean };
    codex: { enabled: boolean };
    cursor: { enabled: boolean };
  };
}

export interface GlobalMemoryConfig {
  version: number;
  embedding: { model: string; localDir: string | null };
  retrieval: {
    topK: number;
    contextMaxItems: number;
    daoTianLimit: number;
    includeCards: boolean;
  };
}

export interface ReindexReport {
  reembedded: number;
  dimensions: number;
}

export interface LegacyImportPreflight {
  memories: number;
  threads: number;
  notImported: { inbox: number; working: boolean; reason: string };
  estimatedBytes: number;
  note: string;
}

export interface LegacyImportReport {
  filesScanned: number;
  filesImported: number;
  filesUnchanged: number;
  entriesCreated: number;
  entriesAlreadyPresent: number;
  failures: Array<{ path: string; message: string }>;
  reportPath: string;
  note: string;
}

export interface BundleExport {
  outputPath: string;
  evidence: number;
  knowledge: number;
  files: number;
}

export interface BundleImport {
  sourcePath: string;
  evidence: number;
  knowledge: number;
  skipped: number;
}

/** Snake_case because the agent integration commands were not part of this
 *  migration and still speak the older serialization. */
export interface MemoryIntegrationStatus {
  agent_source: string;
  installed: boolean;
  enabled: boolean;
  authorized: boolean;
  hook_version: string | null;
  last_event_at: string | null;
  last_error: string | null;
  doctor_status: string;
}

/**
 * What the doctor found, and what `memory_integration_repair` answers with.
 *
 * The repair command installs and then runs the doctor, so its reply is this — not
 * the setup result. It was declared here as `{ ok: boolean; [key: string]: unknown }`,
 * an index signature that types nothing: the statuses it carries were fetched a
 * second time over the wire because nobody could see they were already in hand.
 */
export interface MemoryDoctorReport {
  ok: boolean;
  statuses: MemoryIntegrationStatus[];
  errors: string[];
  warnings: string[];
}

/**
 * What `memory_agent_setup` actually takes.
 *
 * One flag per agent, in the command's own snake_case — like `GateReport`, this
 * struct is deserialized by name on the Rust side. It used to be declared here as
 * `{ agents?: string[] }`, which is not a shape the command has ever accepted: the
 * panel type-checked, and pressing 配置智能体 failed at the boundary with "missing
 * field `codex`". A type that describes nothing real cannot catch anything.
 */
export interface MemoryAgentSetupRequest {
  codex: boolean;
  claude: boolean;
  cursor: boolean;
  /** Also install the capture hook, not just the skill and MCP entry. */
  hooks?: boolean;
  /** Report what would change without writing it. */
  dry_run?: boolean;
}

export interface MemoryAgentSetupResult {
  dry_run: boolean;
  changed_paths: string[];
  summary: string;
}
