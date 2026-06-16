interface MemorySettingsSectionProps {
  disabled: boolean;
  sectionRef?: (node: HTMLElement | null) => void;
  onToggle: (key: string, enabled: boolean) => void;
}

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
  onToggle,
}: MemorySettingsSectionProps) {
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
            {["复用 LLM", "OpenAI", "Anthropic", "OpenRouter"].map((label) => (
              <button
                key={label}
                type="button"
                className="h-8 text-xs text-base-content/70 hover:bg-base-100 hover:text-base-content disabled:cursor-not-allowed disabled:text-base-content/40"
                disabled={disabled}
              >
                {label}
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
              className="h-8 bg-base-100 text-xs text-base-content shadow-sm disabled:cursor-not-allowed disabled:text-base-content/40"
              disabled={disabled}
            >
              SQLite
            </button>
            <button
              type="button"
              className="h-8 text-xs text-base-content/70 hover:bg-base-100 hover:text-base-content disabled:cursor-not-allowed disabled:text-base-content/40"
              disabled={disabled}
            >
              PostgreSQL
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              className="h-8 border border-base-300 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content disabled:cursor-not-allowed disabled:text-base-content/40"
              disabled={disabled}
            >
              迁移预检
            </button>
            <button
              type="button"
              className="h-8 border border-base-300 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content disabled:cursor-not-allowed disabled:text-base-content/40"
              disabled={disabled}
            >
              开始迁移
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
