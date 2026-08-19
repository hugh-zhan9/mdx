"use client";

import { RefreshCw } from "lucide-react";
import {
  IconButton,
  PanelSection,
  PanelText,
} from "@/common/components/ui-controls";
import type {
  MemoryDiagnostics,
  MemoryIntegrationStatus,
  MemoryStatus,
  ProjectSummary,
} from "../lib/types";
import { MemoryDiagnosticsTab } from "./memory-diagnostics-tab";
import { MemoryIntegrationsTab } from "./memory-integrations-tab";
import { MemoryOverviewTab } from "./memory-overview-tab";

/**
 * Re-read what a section shows, as the same control everywhere.
 *
 * It was a text button here, a text button with an icon there, and an icon button
 * in two other panels. Refreshing is never a decision — it re-reads what is already
 * on screen — so it gets the quietest control there is, and the same one each time.
 */
function RefreshAction({
  label,
  busy,
  onRefresh,
}: {
  label: string;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <IconButton
      label={label}
      icon={<RefreshCw className={busy ? "animate-spin" : undefined} />}
      disabled={busy}
      onClick={onRefresh}
    />
  );
}

interface MemorySetupTabProps {
  status: MemoryStatus;
  projects: ProjectSummary[];
  diagnostics: MemoryDiagnostics | null;
  integrations: MemoryIntegrationStatus[];
  integrationsLoading: boolean;
  busy: string | null;
  onToggleEnabled: (enabled: boolean) => void;
  onDownloadModel: () => void;
  onRebuildIndex: () => void;
  onRebind: (wing: string) => void;
  onRefreshIntegrations: () => Promise<void>;
  onInstallAgent: (agent: string) => Promise<void>;
  onRefreshDiagnostics: () => void;
  onPurge: () => void;
  onExport: () => void;
  onLegacyImport: () => void;
}

/**
 * Everything you do once, or do when something is broken.
 *
 * Three tabs used to hold this: turning memory on and the model it needs;
 * installing the agent side; backups, repairs and what is wrong. They are one
 * page because they belong to one occasion — the day you set this up, and the day
 * it stops working — and because giving them three sixths of the tab bar said
 * they were three sixths of the work.
 *
 * Laid out in two columns on a wide window, grouped by who the work is for: the
 * left is this workspace and this machine, the right is the agents that read the
 * library. Stacked in one column, the agent install — the longest thing here and
 * the reason most people open this page — sat below a screenful of paths and
 * counts.
 *
 * The one irreversible act on the page has a group of its own at the bottom. It
 * used to be the fourth button in a row of four, beside 刷新.
 */
export function MemorySetupTab({
  status,
  projects,
  diagnostics,
  integrations,
  integrationsLoading,
  busy,
  onToggleEnabled,
  onDownloadModel,
  onRebuildIndex,
  onRebind,
  onRefreshIntegrations,
  onInstallAgent,
  onRefreshDiagnostics,
  onPurge,
  onExport,
  onLegacyImport,
}: MemorySetupTabProps) {
  return (
    <div
      className="grid min-w-0 grid-cols-1 items-start xl:grid-cols-2"
      data-testid="memory-setup"
    >
      <div className="min-w-0 xl:border-r xl:border-[var(--mdx-separator)]">
        <PanelSection
          title="这个工作区"
          hint="记忆是按工作区启用的，写入和语义检索都要嵌入模型。"
        >
          <MemoryOverviewTab
            status={status}
            projects={projects}
            busy={busy}
            onToggleEnabled={onToggleEnabled}
            onDownloadModel={onDownloadModel}
            onRebuildIndex={onRebuildIndex}
            onRebind={onRebind}
          />
        </PanelSection>

        {/*
         * On its own, at the end, with what it destroys written out. It cannot be
         * undone and there is no automatic backup behind it, so it does not belong
         * in a row of buttons where the neighbouring one merely refreshes a list.
         */}
        <PanelSection
          className="border-t border-[var(--mdx-separator)]"
          title="彻底清除"
          hint="删除过的条目在库里还留着墓碑，占空间但不会被检索到。清掉它们不可撤销。"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <button
              type="button"
              className="h-8 shrink-0 rounded-md px-3 text-xs font-medium text-error shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-error)_35%,transparent)] transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:text-error/40"
              disabled={busy !== null}
              onClick={onPurge}
            >
              {busy === "purge" ? "清除中" : "彻底清除已删除"}
            </button>
            <PanelText tone="meta" className="min-w-0">
              清除后会顺便压实库文件。
            </PanelText>
          </div>
        </PanelSection>
      </div>

      <div className="min-w-0 border-t border-[var(--mdx-separator)] xl:border-t-0">
        <PanelSection
          title="Agent 集成"
          hint="给 Claude Code / Codex / Cursor 装技能、hook 与 MCP。不装，agent 读不到这个库；你自己在这里照常用。"
          actions={
            <RefreshAction
              label="刷新集成状态"
              busy={integrationsLoading}
              onRefresh={() => void onRefreshIntegrations()}
            />
          }
        >
          <MemoryIntegrationsTab
            statuses={integrations}
            loading={integrationsLoading}
            actionLoading={busy !== null}
            onInstall={onInstallAgent}
          />
        </PanelSection>

        <PanelSection
          className="border-t border-[var(--mdx-separator)]"
          title="备份与诊断"
          hint="全局单库没有自动备份，导出的 Markdown 包是唯一的一份。"
          actions={
            <RefreshAction
              label="刷新诊断"
              busy={busy === "diagnostics"}
              onRefresh={onRefreshDiagnostics}
            />
          }
        >
          <MemoryDiagnosticsTab
            diagnostics={diagnostics}
            busy={busy}
            onExport={onExport}
            onLegacyImport={onLegacyImport}
          />
        </PanelSection>
      </div>
    </div>
  );
}
