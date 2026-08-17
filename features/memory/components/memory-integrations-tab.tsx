import {
  Card,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { MemoryIntegrationStatus } from "../lib/types";

interface AgentSetupOptions {
  codex: boolean;
  claude: boolean;
  cursor: boolean;
  hooks: boolean;
}

interface MemoryIntegrationsTabProps {
  statuses: MemoryIntegrationStatus[];
  loading: boolean;
  actionLoading: boolean;
  agentSetupOptions: AgentSetupOptions;
  onAgentSetupOptionsChange: (options: AgentSetupOptions) => void;
  onRefresh: () => Promise<void>;
  onSetupAgents: () => Promise<void>;
  onRepair: (agent: string) => Promise<void>;
}

export function MemoryIntegrationsTab({
  statuses,
  loading,
  actionLoading,
  agentSetupOptions,
  onAgentSetupOptionsChange,
  onRefresh,
  onSetupAgents,
  onRepair,
}: MemoryIntegrationsTabProps) {
  const selectedAgentCount = [
    agentSetupOptions.codex,
    agentSetupOptions.claude,
    agentSetupOptions.cursor,
  ].filter(Boolean).length;
  const setupDisabled = actionLoading || selectedAgentCount === 0;
  const setAgentOption = (key: keyof AgentSetupOptions, value: boolean) => {
    onAgentSetupOptionsChange({ ...agentSetupOptions, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-1">
        <TextControlButton onClick={() => void onRefresh()} disabled={loading}>
          刷新
        </TextControlButton>
      </div>

      <div className="grid gap-2">
        {(statuses.length > 0 ? statuses : fallbackStatuses()).map((status) => (
          <div
            key={status.agent_source}
            className="space-y-2 rounded-[var(--mdx-control-radius)] bg-[var(--mdx-card-bg)] p-2.5"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-base-content">
                  {formatAgentName(status.agent_source)}
                </div>
                <div className="mt-1 text-base-content/60">
                  {formatIntegrationSummary(status)}
                </div>
              </div>
              <TextControlButton
                disabled={actionLoading}
                onClick={() => void onRepair(status.agent_source)}
              >
                修复
              </TextControlButton>
            </div>
            {status.last_error ? (
              <div className="break-words text-error">{status.last_error}</div>
            ) : null}
          </div>
        ))}
      </div>

      <Card className="space-y-2">
        <div className="font-medium text-base-content">配置 Agent 集成</div>
        <div className="grid grid-cols-2 gap-2">
          <CheckboxControl
            label="Codex"
            checked={agentSetupOptions.codex}
            disabled={actionLoading}
            onChange={(checked) => setAgentOption("codex", checked)}
          />
          <CheckboxControl
            label="Claude"
            checked={agentSetupOptions.claude}
            disabled={actionLoading}
            onChange={(checked) => setAgentOption("claude", checked)}
          />
          <CheckboxControl
            label="Cursor"
            checked={agentSetupOptions.cursor}
            disabled={actionLoading}
            onChange={(checked) => setAgentOption("cursor", checked)}
          />
          <CheckboxControl
            label="Hook"
            checked={agentSetupOptions.hooks}
            disabled={actionLoading}
            onChange={(checked) => setAgentOption("hooks", checked)}
          />
        </div>
        <TextControlButton
          className="w-full justify-center"
          disabled={setupDisabled}
          onClick={() => void onSetupAgents()}
        >
          {actionLoading ? "配置中" : "配置智能体"}
        </TextControlButton>
      </Card>
    </div>
  );
}

function fallbackStatuses(): MemoryIntegrationStatus[] {
  return ["codex", "claude", "cursor"].map((agent) => ({
    agent_source: agent as "codex" | "claude" | "cursor",
    installed: false,
    enabled: false,
    authorized: false,
    hook_version: null,
    last_event_at: null,
    last_error: null,
    doctor_status: "not_checked",
  }));
}

function formatAgentName(agent: string) {
  if (agent === "codex") {
    return "Codex";
  }
  if (agent === "claude") {
    return "Claude";
  }
  if (agent === "cursor") {
    return "Cursor";
  }
  return agent;
}

function formatIntegrationSummary(status: MemoryIntegrationStatus) {
  const installed = status.installed ? "已安装" : "未安装";
  const enabled = status.enabled ? "已启用" : "未启用";
  const authorized = status.authorized ? "已授权" : "未授权";
  const version = status.hook_version ? `v${status.hook_version}` : "无版本";
  return `${installed} · ${enabled} · ${authorized} · ${version} · ${status.doctor_status}`;
}

function CheckboxControl({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-base-content/75">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
