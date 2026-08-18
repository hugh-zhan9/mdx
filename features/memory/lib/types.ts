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
}

export interface ListFilter {
  kind?: StoredItemKind;
  status?: ConclusionStatus;
  limit?: number;
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
export interface GateRequirements {
  minSupportingRefs: number;
  minVerificationRefs: number;
  minTeachingRefs: number;
  reviewerRequired: boolean;
  counterexamplesBlock: boolean;
}

export interface GateEvidenceCounts {
  supporting: number;
  counterexample: number;
  teaching: number;
  verification: number;
}

export interface GateReport {
  drawerId: string;
  tier: string;
  status: string;
  targetStatus: string;
  allowed: boolean;
  /** Why not, in the backend's own words. Shown verbatim. */
  reasons: string[];
  requirements: GateRequirements;
  evidenceCounts: GateEvidenceCounts;
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

export interface MemoryDoctorReport {
  ok: boolean;
  [key: string]: unknown;
}

export interface MemoryAgentSetupRequest {
  agents?: string[];
  dryRun?: boolean;
}

export interface MemoryAgentSetupResult {
  [key: string]: unknown;
}
