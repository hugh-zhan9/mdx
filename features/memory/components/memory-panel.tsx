"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SegmentedControl,
  TextControlButton,
  PANEL_GUTTER,
  PanelScroll,
  PanelViewport,
} from "@/common/components/ui-controls";
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
  rebindProject,
  rebuildIndex,
  repairMemoryIntegration,
  retireConclusion,
  searchMemory,
  setMemoryEnabled,
  showStored,
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
import { MemoryContextTab } from "./memory-context-tab";
import { MemoryEntryDialog } from "./memory-entry-dialog";
import { MemoryGraphView } from "./memory-graph-view";
import { MemorySetupTab } from "./memory-setup-tab";
import { MemoryStatusStrip } from "./memory-status-strip";
import { MemoryWorkbench } from "./memory-workbench";

/** How much material one page asks for. */
const MATERIAL_PAGE = 50;
/**
 * How much material the graph asks for.
 *
 * A list is read a page at a time; a map is not. And at the document grain a file
 * costs one dot however many chunks it holds, so a window this wide is a few
 * hundred dots at most — where the same window in the list would be unreadable.
 */
const GRAPH_WINDOW = 800;

interface MemoryPanelProps {
  rootPath: string;
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
  const [activeTab, setActiveTab] = useState<MemoryPanelTabId>("workbench");
  /**
   * How much material has been asked for. It grows; it never pages backwards, so
   * a selection made higher up survives asking for more.
   */
  const [materialLimit, setMaterialLimit] = useState(MATERIAL_PAGE);
  /**
   * Whether reads cover the whole library or this workspace's project.
   *
   * One library serves every workspace and the split by project is this layer's,
   * not the store's — so "everything I have ever stored" is a question the panel
   * can answer. Scoped by default: a workspace asking about its own memory is the
   * common case, and reading across projects is a decision.
   */
  const [allProjects, setAllProjects] = useState(false);
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
  /** One entry, opened in full from a graph node or an evidence link. */
  const [opened, setOpened] = useState<StoredItem | null>(null);
  const [diagnostics, setDiagnostics] = useState<MemoryDiagnostics | null>(null);
  const [integrations, setIntegrations] = useState<MemoryIntegrationStatus[]>(
    [],
  );

  const enabled = memory.status?.enabled === true;
  const effectiveTab =
    memory.tabs.find((tab) => tab.id === activeTab)?.disabled === true
      ? "setup"
      : activeTab;

  /**
   * How much material this tab needs. The graph's picture should not depend on how
   * far someone scrolled a different tab.
   */
  const materialWindow =
    effectiveTab === "graph" ? Math.max(materialLimit, GRAPH_WINDOW) : materialLimit;

  /**
   * A line of text for every entry this panel has loaded, by id.
   *
   * So a citation can be shown as what it says rather than as its id. Ids that are
   * outside the loaded window simply keep their id, which is honest: the panel does
   * not have that row and will not invent a label for it.
   */
  const entryLabels = useMemo(() => {
    const named: Record<string, string> = {};

    for (const item of [...material, ...conclusions]) {
      const text = (item.statement ?? item.excerpt).replace(/\s+/g, " ").trim();
      named[item.drawerId] = text.length > 90 ? `${text.slice(0, 90)}…` : text;
    }

    return named;
  }, [material, conclusions]);

  const Shell =
    memory.tabs.find((tab) => tab.id === effectiveTab)?.shape === "viewport"
      ? PanelViewport
      : PanelScroll;

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
      listStored(rootPath, {
        kind: "material",
        limit: materialWindow,
        allProjects,
      }),
      listStored(rootPath, { kind: "conclusion", allProjects }),
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
  }, [rootPath, materialWindow, allProjects]);

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
    if (effectiveTab !== "setup") {
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
    if (effectiveTab !== "setup") {
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
    // `h-full`, like the LLM wiki panel beside it: the parent is a block with a
    // definite height, so without this the panel grows to fit its content, the
    // `flex-1 overflow-auto` below has nothing to size against, and anything
    // taller than the window is clipped by the grandparent with no way to scroll
    // to it.
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-testid="memory-panel"
    >
      <div className={`flex min-w-0 items-center gap-2 border-b border-[var(--mdx-separator)] py-2.5 ${PANEL_GUTTER}`}>
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

      {memory.status ? (
        <MemoryStatusStrip
          status={memory.status}
          projects={projects}
          material={material}
          conclusions={conclusions}
          allProjects={allProjects}
          onScopeChange={setAllProjects}
        />
      ) : null}

      {/*
       * Said where writing happens, not one tab away in setup. Without the model
       * a write is refused outright, so a person about to type a note has to hear
       * it here — the status strip's "未下载" says the fact and not the cost.
       */}
      {memory.status !== null && enabled && !memory.status.modelReady ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <span className="font-medium">还缺一个嵌入模型</span>
          <span className="min-w-0 text-base-content/70">
            写入与语义检索都要用它，没有它记忆不会退化成关键词模式，而是直接拒绝写入。
          </span>
          <TextControlButton
            disabled={busy !== null}
            onClick={() =>
              void run("model", async () => {
                const next = await downloadModel();
                await memory.refresh();
                return next.ready ? "模型已就绪" : "模型仍不完整";
              })
            }
          >
            {busy === "model" ? "下载中" : "下载模型"}
          </TextControlButton>
        </div>
      ) : null}

      {error ? (
        <div className="min-w-0 break-words border-b border-error/30 bg-error/10 px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {/*
       * The shape comes from the tab's own definition — see `memory-panel-state` —
       * so "does this view scroll or fill the panel" is answered in one place
       * instead of here, and never again in CSS.
       */}
      <Shell>
        {memory.loading ? (
          <p className="p-8 text-center text-xs text-base-content/55">加载中。</p>
        ) : memory.status === null ? (
          <p className="p-8 text-center text-xs text-base-content/55">
            {memory.error ?? "记忆不可用。"}
          </p>
        ) : effectiveTab === "workbench" ? (
          <MemoryWorkbench
            material={material}
            conclusions={conclusions}
            selected={selected}
            gates={gates}
            busy={busy}
            gateFailure={gateFailure}
            projects={projects}
            onRebind={(wing) =>
              void run("rebind", async () => {
                await rebindProject(wing, rootPath);
                await memory.refresh();
                await loadStored();
                return `已绑到 ${wing}`;
              })
            }
            allProjects={allProjects}
            hasMoreMaterial={material.length >= materialLimit}
            onLoadMoreMaterial={() =>
              void run("material", async () => {
                setMaterialLimit((current) => current + MATERIAL_PAGE);
                return null;
              })
            }
            onOpenContext={() => setActiveTab("context")}
            onOpenEntry={(drawerId) =>
              void run("show", async () => {
                const item = await showStored(drawerId);
                setOpened(item);
                return null;
              })
            }
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
                    // A search hit carries no conclusion, so it carries no refs.
                    supportingRefs: [],
                    verificationRefs: [],
                    counterexampleRefs: [],
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
                // No tab switch any more: the candidate appears in the column
                // beside the one it was drawn from, which is the whole reason
                // these two are on one screen.
                return conclusion.created
                  ? "已生成候选结论，采纳后 agent 才会读到"
                  : "这条结论已经存在";
              })
            }
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
        ) : effectiveTab === "graph" ? (
          <MemoryGraphView
            material={material}
            conclusions={conclusions}
            onSelect={(drawerId) =>
              void run("show", async () => {
                setOpened(await showStored(drawerId));
                return null;
              })
            }
            onFindSimilar={async (drawerId) => {
              // Its own text as the query: the store answers "what is close to
              // this" only by way of a search, and this is the entry asked about.
              const source =
                material.find((item) => item.drawerId === drawerId)?.excerpt ??
                "";

              if (source.trim().length === 0) {
                return [];
              }

              const hits = await searchMemory(source.slice(0, 400));

              return hits
                .map((hit) => hit.drawerId)
                .filter((id) => id !== drawerId)
                .slice(0, 5);
            }}
          />
        ) : effectiveTab === "context" ? (
          <MemoryContextTab
            result={recalled}
            busy={busy}
            adoptedCount={
              conclusions.filter(
                (item) =>
                  item.status === "promoted" || item.status === "canonical",
              ).length
            }
            onRun={(query) =>
              void run("recall", async () => {
                setRecalled(await recall(rootPath, query));
                return null;
              })
            }
            onOpenEntry={(drawerId) =>
              void run("show", async () => {
                setOpened(await showStored(drawerId));
                return null;
              })
            }
          />
        ) : (
          <MemorySetupTab
            status={memory.status}
            projects={projects}
            diagnostics={diagnostics}
            integrations={integrations}
            integrationsLoading={busy === "integrations"}
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
            onRebind={(wing) =>
              void run("rebind", async () => {
                await rebindProject(wing, rootPath);
                await memory.refresh();
                await loadStored();
                return `已绑到 ${wing}`;
              })
            }
            onRefreshIntegrations={async () => {
              await run("integrations", async () => {
                setIntegrations(await getMemoryIntegrationStatus(rootPath));
                return null;
              });
            }}
            /*
             * Through `run`, like every other action on this panel. It used to be a
             * bare async callback: no busy state, no message on success, and a
             * rejection became an unhandled promise — which is why pressing it
             * looked like nothing had happened even when it had written files.
             */
            onInstallAgent={async (agent) => {
              await run("install-agent", async () => {
                // Installs, then runs the doctor and hands back what it found —
                // including the statuses, so the list does not need a second read.
                const report = await repairMemoryIntegration(rootPath, agent);
                // The whole list, read again. The doctor was asked about one agent
                // and answers about that one: assigning its list straight in made
                // the other two rows vanish, and merging it into state does nothing
                // at all when the list has not loaded yet and the rows on screen are
                // the placeholder ones. The command no longer blocks the main
                // thread, so the extra read costs nothing that matters.
                setIntegrations(await getMemoryIntegrationStatus(rootPath));

                if (!report.ok) {
                  return report.errors.join("；") || `${agent} 装完仍有问题`;
                }

                return `已给 ${agent} 装好技能、MCP 与 hook`;
              });
            }}
            onRefreshDiagnostics={() =>
              void run("diagnostics", async () => {
                setDiagnostics(await getDiagnostics());
                return null;
              })
            }
            onPurge={() =>
              void run("purge", async () => {
                const purged = await purgeDeleted();
                await memory.refresh();
                return `已彻底清除 ${purged} 条，并回收了磁盘空间`;
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
      </Shell>

      {/*
       * One entry, in a dialog, with what can be done to it — reached from a dot on
       * the graph or a row in a list. It used to be a strip along the bottom that
       * could only show text, so acting on what you had just read meant closing it
       * and finding the same entry again somewhere else.
       */}
      {opened ? (
        <MemoryEntryDialog
          item={opened}
          labels={entryLabels}
          selected={selected.includes(opened.drawerId)}
          busy={busy}
          onClose={() => setOpened(null)}
          onOpenEntry={(drawerId) =>
            void run("show", async () => {
              setOpened(await showStored(drawerId));
              return null;
            })
          }
          onDelete={(drawerId) =>
            void run("delete", async () => {
              await deleteStored(drawerId);
              setOpened(null);
              await loadStored();
              return "已删除";
            })
          }
          onAdopt={(drawerId) => {
            void adopt(drawerId).then(() =>
              // Reopened, so the dialog shows the status it now has rather than the
              // one it was opened with.
              showStored(drawerId)
                .then(setOpened)
                .catch(() => setOpened(null)),
            );
          }}
          onRetire={(drawerId, evidenceRefs) =>
            void run("retire", async () => {
              await retireConclusion({
                drawerId,
                reasonType: "obsolete",
                reason: "在面板上退役",
                evidenceRefs,
                retire: true,
              });
              setOpened(null);
              await loadStored();
              return "已退役";
            })
          }
          onToggleSelected={(drawerId) =>
            setSelected((current) =>
              current.includes(drawerId)
                ? current.filter((id) => id !== drawerId)
                : [...current, drawerId],
            )
          }
          onFindSimilar={(drawerId) =>
            void run("search", async () => {
              const source =
                opened.drawerId === drawerId ? opened.excerpt : "";

              if (source.trim().length === 0) {
                return null;
              }

              const hits = await searchMemory(source.slice(0, 400));
              setMaterial(
                hits
                  .filter((hit) => hit.drawerId !== drawerId)
                  .map((hit) => ({
                    drawerId: hit.drawerId,
                    kind: "material" as const,
                    room: hit.room ?? "",
                    sourceFile: hit.sourceFile,
                    addedAt: "",
                    importance: 0,
                    statement: null,
                    status: null,
                    excerpt: hit.snippet,
                    supportingRefs: [],
                    verificationRefs: [],
                    counterexampleRefs: [],
                  })),
              );
              setOpened(null);
              setActiveTab("workbench");
              return `素材列表换成了 ${hits.length - 1} 条相近的`;
            })
          }
        />
      ) : null}

      {/*
       * On every tab, including setup. It used to skip setup — where the install,
       * the export and the purge all live — so those actions reported into a bar
       * that was not rendered, and pressing them looked like nothing happened.
       */}
      {message ? (
        <div className="min-w-0 break-words border-t border-[var(--mdx-separator)] px-3 py-2 text-xs text-base-content/65">
          {message}
        </div>
      ) : null}
    </div>
  );
}
