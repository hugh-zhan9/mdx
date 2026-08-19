import {
  HairlineItem,
  PanelText,
  StateLabel,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { MemoryIntegrationStatus } from "../lib/types";

interface MemoryIntegrationsTabProps {
  statuses: MemoryIntegrationStatus[];
  loading: boolean;
  /** The panel's current action, as `install-<agent>` while one is installing. */
  busy: string | null;
  /** Installs (or reinstalls) skill, MCP entry and capture hook for one agent. */
  onInstall: (agent: string) => Promise<void>;
}

/**
 * Which agents can read this library, and the one act that changes it.
 *
 * There used to be two controls here doing the same thing: a 修复 button on each
 * row, and a group of checkboxes with a 配置智能体 button under them. `修复` calls
 * `memory_integration_repair`, which is `plan_memory_agent_repair`, which is
 * `plan_memory_agent_setup` with `hooks: true` — the same install, scoped to one
 * agent. So the hooks checkbox was honoured on one path and forced on the other,
 * and nothing on screen said which button did what.
 *
 * One button per row now, named for what pressing it does. The hook goes in with
 * it, always: it only captures once capture is switched on in 设置, so installing
 * it is not the same as turning it on.
 */
export function MemoryIntegrationsTab({
  statuses,
  loading,
  busy,
  onInstall,
}: MemoryIntegrationsTabProps) {
  const rows = statuses.length > 0 ? statuses : fallbackStatuses();
  /*
   * Which row is working. Writing files under the home directory and running the
   * doctor over them takes long enough to wonder whether the click registered, and
   * the button used to keep its label and just grey out — along with the other two,
   * so nothing on screen said which one had been pressed or that anything had
   * started at all.
   */
  const installing = busy?.startsWith("install-")
    ? busy.slice("install-".length)
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ul className="flex min-w-0 flex-col">
        {rows.map((status) => (
          <HairlineItem key={status.agent_source}>
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="min-w-0 truncate text-[13.5px] font-medium leading-[1.75] text-base-content">
                    {formatAgentName(status.agent_source)}
                  </span>
                  <StateLabel tone={status.installed ? "success" : "neutral"}>
                    {status.installed ? "已安装" : "未安装"}
                  </StateLabel>
                </div>
                <PanelText tone="meta">
                  {formatIntegrationSummary(status)}
                </PanelText>
                {status.last_error ? (
                  <PanelText tone="meta" className="break-words text-error">
                    {status.last_error}
                  </PanelText>
                ) : null}
              </div>
              <TextControlButton
                outlined
                className="shrink-0"
                disabled={busy !== null || loading}
                onClick={() => void onInstall(status.agent_source)}
              >
                {installing === status.agent_source
                  ? "安装中"
                  : status.installed
                    ? "重新安装"
                    : "安装"}
              </TextControlButton>
            </div>
          </HairlineItem>
        ))}
      </ul>

      <PanelText tone="meta">
        安装会写入技能文件、MCP 条目和捕获 hook。hook 装上不等于开始捕获——捕获在「设置
        · 记忆」里另有开关，默认关闭。
      </PanelText>
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
  const enabled = status.enabled ? "已启用" : "未启用";
  const authorized = status.authorized ? "已授权" : "未授权";
  const version = status.hook_version ? `hook v${status.hook_version}` : "无 hook";
  return `${enabled} · ${authorized} · ${version} · ${status.doctor_status}`;
}
