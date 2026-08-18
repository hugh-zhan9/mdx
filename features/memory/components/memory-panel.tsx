"use client";

import { useCallback, useEffect, useState } from "react";
import { SegmentedControl } from "@/common/components/ui-controls";
import { useMemoryWorkspace } from "../hooks/use-memory-workspace";
import {
  addCounterexample,
  addMaterial,
  adoptConclusion,
  checkGate,
  deleteStored,
  distillConclusion,
  downloadModel,
  exportBundle,
  getDiagnostics,
  getMemoryIntegrationStatus,
  legacyImport,
  listProjects,
  listStored,
  purgeDeleted,
  recall,
  rebuildIndex,
  repairMemoryIntegration,
  retireConclusion,
  searchMemory,
  setMemoryEnabled,
  setupMemoryAgents,
} from "../lib/memory-client";
import { formatMemoryError } from "../lib/memory-error";
import type { MemoryPanelTabId } from "../lib/memory-panel-state";
import type {
  GateReport,
  MemoryDiagnostics,
  MemoryIntegrationStatus,
  ProjectSummary,
  RecallResult,
  StoredItem,
} from "../lib/types";
import { MemoryConclusionsTab } from "./memory-conclusions-tab";
import { MemoryContextTab } from "./memory-context-tab";
import { MemoryDiagnosticsTab } from "./memory-diagnostics-tab";
import { MemoryIntegrationsTab } from "./memory-integrations-tab";
import { MemoryMaterialTab } from "./memory-material-tab";
import { MemoryOverviewTab } from "./memory-overview-tab";

interface MemoryPanelProps {
  rootPath: string;
}

interface AgentSetupOptions {
  codex: boolean;
  claude: boolean;
  cursor: boolean;
  hooks: boolean;
}

/**
 * The memory panel: material on one side, conclusions on the other.
 *
 * Actions are optimistic only where being wrong is cheap. Adoption is not:
 * it can be refused by the promotion gate, and when it is, the panel puts the
 * refusal on screen unchanged and leaves the conclusion exactly where it was.
 */
export function MemoryPanel({ rootPath }: MemoryPanelProps) {
  const memory = useMemoryWorkspace(rootPath);
  const [activeTab, setActiveTab] = useState<MemoryPanelTabId>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [material, setMaterial] = useState<StoredItem[]>([]);
  const [conclusions, setConclusions] = useState<StoredItem[]>([]);
  const [gates, setGates] = useState<Record<string, GateReport>>({});
  const [gateFailure, setGateFailure] = useState<{
    drawerId: string;
    reasons: string[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [recalled, setRecalled] = useState<RecallResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<MemoryDiagnostics | null>(null);
  const [integrations, setIntegrations] = useState<MemoryIntegrationStatus[]>(
    [],
  );
  const [agentSetupOptions, setAgentSetupOptions] = useState<AgentSetupOptions>({
    codex: false,
    claude: true,
    cursor: false,
    hooks: true,
  });

  const enabled = memory.status?.enabled === true;
  const effectiveTab =
    memory.tabs.find((tab) => tab.id === activeTab)?.disabled === true
      ? "overview"
      : activeTab;

  const run = useCallback(
    async (label: string, action: () => Promise<string | null>) => {
      setBusy(label);
      setError(null);
      try {
        setMessage(await action());
      } catch (actionError) {
        setError(formatMemoryError(actionError));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const loadStored = useCallback(async () => {
    const [nextMaterial, nextConclusions] = await Promise.all([
      listStored(rootPath, { kind: "material" }),
      listStored(rootPath, { kind: "conclusion" }),
    ]);
    setMaterial(nextMaterial);
    setConclusions(nextConclusions);

    const reports = await Promise.all(
      nextConclusions.map(async (item) => {
        try {
          return [item.drawerId, await checkGate(item.drawerId)] as const;
        } catch {
          // A gate that cannot be evaluated is not worth failing the list over;
          // the row simply shows no counts.
          return null;
        }
      }),
    );
    setGates(Object.fromEntries(reports.filter((entry) => entry !== null)));
  }, [rootPath]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const nextProjects = await listProjects();
        if (!cancelled) {
          setProjects(nextProjects);
        }
        await loadStored();
      } catch (loadError) {
        if (!cancelled) {
          setError(formatMemoryError(loadError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, loadStored]);

  useEffect(() => {
    if (effectiveTab !== "diagnostics") {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const report = await getDiagnostics();
        if (!cancelled) {
          setDiagnostics(report);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(formatMemoryError(loadError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveTab]);

  useEffect(() => {
    if (effectiveTab !== "integrations") {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const statuses = await getMemoryIntegrationStatus(rootPath);
        if (!cancelled) {
          setIntegrations(statuses);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(formatMemoryError(loadError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveTab, rootPath]);

  const adopt = (drawerId: string) =>
    run("adopt", async () => {
      setGateFailure(null);
      try {
        const adopted = await adoptConclusion(rootPath, drawerId);
        await loadStored();
        return `已采纳，记录在 ${adopted.confirmationDrawerId}`;
      } catch (adoptError) {
        // The gate refuses with its reasons attached. Showing them verbatim is
        // the difference between "it did not work" and knowing what is missing.
        const report = await checkGate(drawerId).catch(() => null);
        setGateFailure({
          drawerId,
          reasons:
            report && report.reasons.length > 0
              ? report.reasons
              : [formatMemoryError(adoptError)],
        });
        throw adoptError;
      }
    });

  return (
    <div className="flex min-h-0 min-w-0 flex-col" data-testid="memory-panel">
      <div className="flex min-w-0 items-center gap-2 border-b border-[var(--mdx-separator)] px-3 py-2">
        <SegmentedControl
          variant="tabs"
          label="记忆"
          value={effectiveTab}
          options={memory.tabs.map((tab) => ({
            value: tab.id,
            label: tab.label,
            disabled: tab.disabled,
            // These four hold this workspace's own material and conclusions,
            // which do not exist until memory is turned on. Saying so is the
            // difference between a disabled tab and a broken one.
            title: tab.disabled ? "启用记忆后可用" : undefined,
          }))}
          onChange={(next) => setActiveTab(next)}
        />
      </div>

      {error ? (
        <div className="min-w-0 break-words border-b border-error/30 bg-error/10 px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {/*
       * The column, given to whichever tab is mounted. Each tab renders one
       * root element, so constraining the children is the same thing as
       * wrapping them and leaves every tab's own markup alone.
       */}
      <div
        data-mdx-page-column=""
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        {memory.loading ? (
          <p className="p-8 text-center text-xs text-base-content/55">加载中。</p>
        ) : memory.status === null ? (
          <p className="p-8 text-center text-xs text-base-content/55">
            {memory.error ?? "记忆不可用。"}
          </p>
        ) : effectiveTab === "overview" ? (
          <MemoryOverviewTab
            status={memory.status}
            projects={projects}
            busy={busy}
            onToggleEnabled={(next) =>
              void run("enable", async () => {
                await setMemoryEnabled(rootPath, next);
                await memory.refresh();
                return null;
              })
            }
            onDownloadModel={() =>
              void run("model", async () => {
                const status = await downloadModel();
                await memory.refresh();
                return status.ready ? "模型已就绪" : "模型仍不完整";
              })
            }
            onRebuildIndex={() =>
              void run("reindex", async () => {
                const report = await rebuildIndex();
                return `已重嵌 ${report.reembedded} 条`;
              })
            }
          />
        ) : effectiveTab === "material" ? (
          <MemoryMaterialTab
            items={material}
            selected={selected}
            busy={busy}
            onSearch={(query) =>
              void run("search", async () => {
                if (query.trim().length === 0) {
                  await loadStored();
                  return null;
                }
                const hits = await searchMemory(query);
                setMaterial(
                  hits.map((hit) => ({
                    drawerId: hit.drawerId,
                    kind: "material" as const,
                    room: hit.room ?? "",
                    sourceFile: hit.sourceFile,
                    addedAt: "",
                    importance: 0,
                    statement: null,
                    status: null,
                    excerpt: hit.snippet,
                  })),
                );
                return `${hits.length} 条命中`;
              })
            }
            onAdd={(body) =>
              void run("add", async () => {
                const written = await addMaterial(rootPath, body);
                await loadStored();
                return written.created ? "已存为素材" : "这条素材已经在库里";
              })
            }
            onDelete={(drawerId) =>
              void run("delete", async () => {
                await deleteStored(drawerId);
                await loadStored();
                return "已删除";
              })
            }
            onToggleSelected={(drawerId) =>
              setSelected((current) =>
                current.includes(drawerId)
                  ? current.filter((id) => id !== drawerId)
                  : [...current, drawerId],
              )
            }
            onDistillSelected={() =>
              void run("distill", async () => {
                const source = material.filter((item) =>
                  selected.includes(item.drawerId),
                );
                const statement = source[0]?.excerpt.slice(0, 80) ?? "";
                const conclusion = await distillConclusion(rootPath, {
                  statement,
                  body: source.map((item) => item.excerpt).join("\n\n"),
                  supportingRefs: selected,
                });
                setSelected([]);
                await loadStored();
                setActiveTab("conclusions");
                return conclusion.created
                  ? "已生成候选结论，采纳后 agent 才会读到"
                  : "这条结论已经存在";
              })
            }
          />
        ) : effectiveTab === "conclusions" ? (
          <MemoryConclusionsTab
            items={conclusions}
            gates={gates}
            busy={busy}
            gateFailure={gateFailure}
            onAdopt={(drawerId) => void adopt(drawerId)}
            onRetire={(drawerId, evidenceRefs) =>
              void run("retire", async () => {
                await retireConclusion({
                  drawerId,
                  reasonType: "obsolete",
                  reason: "在面板上退役",
                  evidenceRefs,
                  retire: true,
                });
                await loadStored();
                return "已退役";
              })
            }
            onAddCounterexample={(drawerId, body) =>
              void run("counterexample", async () => {
                const report = await addCounterexample(rootPath, drawerId, body);
                await loadStored();
                return report.allowed
                  ? "已记录"
                  : "已记录，这条结论现在提不上去了";
              })
            }
          />
        ) : effectiveTab === "context" ? (
          <MemoryContextTab
            result={recalled}
            busy={busy}
            onRun={(query) =>
              void run("recall", async () => {
                setRecalled(await recall(rootPath, query));
                return null;
              })
            }
          />
        ) : effectiveTab === "integrations" ? (
          <MemoryIntegrationsTab
            statuses={integrations}
            loading={busy === "integrations"}
            actionLoading={busy !== null}
            agentSetupOptions={agentSetupOptions}
            onAgentSetupOptionsChange={setAgentSetupOptions}
            onRefresh={async () => {
              setIntegrations(await getMemoryIntegrationStatus(rootPath));
            }}
            onSetupAgents={async () => {
              await setupMemoryAgents(rootPath, {
                agents: (["codex", "claude", "cursor"] as const).filter(
                  (agent) => agentSetupOptions[agent],
                ),
              });
              setIntegrations(await getMemoryIntegrationStatus(rootPath));
            }}
            onRepair={async (agent) => {
              await repairMemoryIntegration(rootPath, agent);
              setIntegrations(await getMemoryIntegrationStatus(rootPath));
            }}
          />
        ) : (
          <MemoryDiagnosticsTab
            diagnostics={diagnostics}
            busy={busy}
            message={message}
            onRefresh={() =>
              void run("diagnostics", async () => {
                setDiagnostics(await getDiagnostics());
                return null;
              })
            }
            onPurge={() =>
              void run("purge", async () => {
                const purged = await purgeDeleted();
                return `已彻底清除 ${purged} 条`;
              })
            }
            onExport={() =>
              void run("export", async () => {
                const exported = await exportBundle(
                  rootPath,
                  `${rootPath}/memory-backup`,
                );
                return `已导出 ${exported.files} 个文件到 ${exported.outputPath}`;
              })
            }
            onLegacyImport={() =>
              void run("legacy", async () => {
                const report = await legacyImport(rootPath);
                await loadStored();
                return `已导入 ${report.entriesCreated} 条素材，报告见 ${report.reportPath}`;
              })
            }
          />
        )}
      </div>

      {message && effectiveTab !== "diagnostics" ? (
        <div className="min-w-0 break-words border-t border-[var(--mdx-separator)] px-3 py-2 text-xs text-base-content/65">
          {message}
        </div>
      ) : null}
    </div>
  );
}
