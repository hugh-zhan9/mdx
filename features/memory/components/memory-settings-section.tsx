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
                className="h-4 w-4 border border-base-300 bg-base-100"
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

        <div className="space-y-2 border-t border-base-300 pt-3">
          <div className="text-xs text-base-content/70">Provider</div>
          <div className="grid grid-cols-2 gap-1 bg-base-200 p-1 sm:grid-cols-4">
            {PROVIDER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={[
                  "h-8 text-xs disabled:cursor-not-allowed disabled:text-base-content/40",
                  selectedProvider === option.value
                    ? "bg-base-100 text-base-content shadow-sm"
                    : "text-base-content/70 hover:bg-base-100 hover:text-base-content",
                ].join(" ")}
                disabled={disabled}
                onClick={() => onProviderChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 border-t border-base-300 pt-3">
          <div className="text-xs text-base-content/70">存储与迁移</div>
          <div
            role="group"
            aria-label="Memory storage backend"
            className="grid grid-cols-2 gap-1 bg-base-200 p-1"
          >
            <button
              type="button"
              className={[
                "h-8 text-xs disabled:cursor-not-allowed disabled:text-base-content/40",
                selectedStorage === "sqlite"
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/70 hover:bg-base-100 hover:text-base-content",
              ].join(" ")}
              disabled={disabled}
              onClick={() => onStorageBackendChange("sqlite")}
            >
              SQLite
            </button>
            <button
              type="button"
              className={[
                "h-8 text-xs disabled:cursor-not-allowed disabled:text-base-content/40",
                selectedStorage === "postgresql"
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/70 hover:bg-base-100 hover:text-base-content",
              ].join(" ")}
              disabled={disabled}
              onClick={() => onStorageBackendChange("postgresql")}
            >
              PostgreSQL
            </button>
          </div>
          {selectedStorage === "postgresql" ? (
            <label className="block space-y-1.5 text-xs text-base-content/70">
              <span>PostgreSQL URL</span>
              <input
                className="h-8 w-full border border-base-300 bg-base-100 px-2 text-xs text-base-content outline-none placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
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
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              className="h-8 border border-base-300 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content disabled:cursor-not-allowed disabled:text-base-content/40"
              disabled={
                disabled || selectedStorage !== "postgresql" || migrationBusy
              }
              onClick={onMigrationDryRun}
            >
              {checkingMigration ? "预检中" : "迁移预检"}
            </button>
            <button
              type="button"
              className="h-8 border border-base-300 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content disabled:cursor-not-allowed disabled:text-base-content/40"
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
            <div className="space-y-1 border border-base-300 bg-base-200 p-2 text-xs text-base-content/70">
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
