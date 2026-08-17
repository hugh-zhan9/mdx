import { SegmentedControl } from "@/common/components/ui-controls";
import type {
  MemoryConfig,
  MemoryStorageMigrationReport,
} from "../lib/types";

interface MemorySettingsSectionProps {
  disabled: boolean;
  sectionRef?: (node: HTMLElement | null) => void;
  config: MemoryConfig | null;
  postgresTarget: string;
  migrationReport: MemoryStorageMigrationReport | null;
  checkingMigration: boolean;
  applyingMigration: boolean;
  onToggle: (key: string, enabled: boolean) => void;
  onProviderChange: (provider: MemoryProviderOption) => void;
  onStorageBackendChange: (backend: MemoryStorageBackend) => void;
  onPostgresTargetChange: (target: string) => void;
  onPostgresTargetBlur: () => void;
  onMigrationDryRun: () => void;
  onMigrationApply: () => void;
}

export type MemoryProviderOption =
  | "reuse_llm"
  | "openai"
  | "anthropic"
  | "openrouter";

export type MemoryStorageBackend = "sqlite" | "postgresql";

const FEATURE_TOGGLES = [
  { key: "memory.enabled", label: "总开关", defaultChecked: true },
  {
    key: "agent_backend.capture_enabled",
    label: "自动捕获",
    defaultChecked: false,
  },
  {
    key: "agent_backend.recall_injection_enabled",
    label: "Recall 注入",
    defaultChecked: true,
  },
  {
    key: "agent_backend.distill_enabled",
    label: "自动提取",
    defaultChecked: true,
  },
  { key: "projection.enabled", label: "Markdown 投影", defaultChecked: true },
  { key: "agents.codex.enabled", label: "Codex", defaultChecked: false },
  { key: "agents.claude.enabled", label: "Claude", defaultChecked: false },
  { key: "agents.cursor.enabled", label: "Cursor", defaultChecked: false },
];

export function MemorySettingsSection({
  disabled,
  sectionRef,
  config,
  postgresTarget,
  migrationReport,
  checkingMigration,
  applyingMigration,
  onToggle,
  onProviderChange,
  onStorageBackendChange,
  onPostgresTargetChange,
  onPostgresTargetBlur,
  onMigrationDryRun,
  onMigrationApply,
}: MemorySettingsSectionProps) {
  const selectedProvider = selectedMemoryProvider(config);
  const selectedStorage = selectedMemoryStorage(config);
  const migrationBusy = checkingMigration || applyingMigration;

  return (
    <section
      ref={sectionRef}
      data-settings-section="memory"
      className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
    >
      <h3 className="pt-2 text-xs font-medium text-base-content/70">
        Memory
      </h3>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {FEATURE_TOGGLES.map((toggle) => (
            <label
              key={toggle.key}
              className="flex min-w-0 items-center gap-3 text-sm text-base-content"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded-sm border border-base-content/20 bg-base-100"
                defaultChecked={toggle.defaultChecked}
                disabled={disabled}
                onChange={(event) =>
                  onToggle(toggle.key, event.currentTarget.checked)
                }
              />
              <span className="truncate">{toggle.label}</span>
            </label>
          ))}
        </div>

        <div className="space-y-2 border-t border-[var(--mdx-separator)] pt-3">
          <div className="text-xs text-base-content/70">Provider</div>
          <SegmentedControl
            label="Memory provider"
            fill
            value={selectedProvider}
            options={PROVIDER_OPTIONS}
            onChange={onProviderChange}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2 border-t border-[var(--mdx-separator)] pt-3">
          <div className="text-xs text-base-content/70">存储与迁移</div>
          <SegmentedControl
            label="Memory storage backend"
            fill
            value={selectedStorage}
            options={STORAGE_BACKEND_OPTIONS}
            onChange={onStorageBackendChange}
            disabled={disabled}
          />
          {selectedStorage === "postgresql" ? (
            <label className="block space-y-1.5 text-xs text-base-content/70">
              <span>PostgreSQL URL</span>
              <input
                className="h-8 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-xs text-base-content outline-none transition-colors placeholder:text-base-content/45 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                value={postgresTarget}
                onChange={(event) =>
                  onPostgresTargetChange(event.currentTarget.value)
                }
                onBlur={onPostgresTargetBlur}
                placeholder="postgresql://user:password@localhost:5432/mdx"
                disabled={disabled}
              />
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-base-content/12 text-xs text-base-content/75 outline-none transition-colors hover:bg-base-content/6 hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:border-base-content/8 disabled:text-base-content/35 disabled:hover:bg-transparent"
              disabled={
                disabled || selectedStorage !== "postgresql" || migrationBusy
              }
              onClick={onMigrationDryRun}
            >
              {checkingMigration ? "预检中" : "迁移预检"}
            </button>
            <button
              type="button"
              className="h-8 rounded-md border border-base-content/12 text-xs text-base-content/75 outline-none transition-colors hover:bg-base-content/6 hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:border-base-content/8 disabled:text-base-content/35 disabled:hover:bg-transparent"
              disabled={
                disabled ||
                selectedStorage !== "postgresql" ||
                migrationBusy ||
                !migrationReport ||
                migrationReport.validation_errors.length > 0
              }
              onClick={onMigrationApply}
            >
              {applyingMigration ? "迁移中" : "开始迁移"}
            </button>
          </div>
          {migrationReport ? (
            <div className="space-y-1 rounded-md bg-base-200 p-2.5 text-xs text-base-content/70">
              <div>
                预检：{migrationReport.validation_errors.length === 0 ? "通过" : "有问题"}
              </div>
              <div>
                memories：{migrationReport.records_seen.memories ?? 0}，
                threads：{migrationReport.records_seen.threads ?? 0}
              </div>
              {migrationReport.validation_errors.length > 0 ? (
                <div className="break-words text-error">
                  {migrationReport.validation_errors.join("、")}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-xs text-base-content/55">
              请先执行迁移预检，通过后可开始迁移。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const PROVIDER_OPTIONS: Array<{
  value: MemoryProviderOption;
  label: string;
}> = [
  { value: "reuse_llm", label: "复用 LLM" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
];

function selectedMemoryProvider(
  config: MemoryConfig | null,
): MemoryProviderOption {
  if (!config || config.provider.mode === "reuse_llm") {
    return "reuse_llm";
  }

  if (
    config.provider.provider === "openai" ||
    config.provider.provider === "anthropic" ||
    config.provider.provider === "openrouter"
  ) {
    return config.provider.provider;
  }

  return "reuse_llm";
}

function selectedMemoryStorage(
  config: MemoryConfig | null,
): MemoryStorageBackend {
  return config?.storage.backend === "postgresql" ? "postgresql" : "sqlite";
}

const STORAGE_BACKEND_OPTIONS: Array<{
  value: MemoryStorageBackend;
  label: string;
}> = [
  { value: "sqlite", label: "SQLite" },
  { value: "postgresql", label: "PostgreSQL" },
];
