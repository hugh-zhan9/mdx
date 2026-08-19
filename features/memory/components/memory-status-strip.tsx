"use client";

import { PanelStrip, StatList } from "@/common/components/ui-controls";
import type { MemoryStatus, ProjectSummary, StoredItem } from "../lib/types";

interface MemoryStatusStripProps {
  status: MemoryStatus;
  projects: ProjectSummary[];
  material: StoredItem[];
  conclusions: StoredItem[];
  /** Whether the counts and lists cover the whole library. */
  allProjects: boolean;
  onScopeChange: (allProjects: boolean) => void;
}

/**
 * What is true about this library, on every tab.
 *
 * These four facts decided whether anything else on screen makes sense — which
 * project you are in, how much is stored, whether a conclusion has been adopted,
 * whether the model that writing needs is present — and they used to live two
 * tabs away in "overview". A user reading an empty conclusions list could not
 * tell an empty project from an unbound one from a missing model.
 *
 * Counts come from the project summary where there is one, because it counts the
 * whole library rather than the page that happens to be loaded.
 */
export function MemoryStatusStrip({
  status,
  projects,
  material,
  conclusions,
  allProjects,
  onScopeChange,
}: MemoryStatusStripProps) {
  const project = projects.find((candidate) => candidate.wing === status.wing);
  /*
   * Counted over whatever the scope is. Scoped counts beside whole-library lists
   * said "素材 2" over a graph drawing eight hundred of them: the strip is supposed
   * to be the sentence that makes the rest of the screen make sense.
   */
  const scoped = allProjects ? projects : project ? [project] : [];
  const summed = scoped.reduce(
    (total, candidate) => ({
      evidence: total.evidence + candidate.evidence,
      knowledge: total.knowledge + candidate.knowledge,
    }),
    { evidence: 0, knowledge: 0 },
  );
  const materialCount = scoped.length > 0 ? summed.evidence : material.length;
  const conclusionCount = scoped.length > 0 ? summed.knowledge : conclusions.length;
  const adopted = conclusions.filter(
    (item) => item.status === "promoted" || item.status === "canonical",
  ).length;
  const candidates = conclusions.filter(
    (item) => item.status === "candidate",
  ).length;

  return (
    <PanelStrip>
      <StatList
        items={[
          {
            label: "项目",
            value: allProjects
              ? `全部 ${projects.length}`
              : (status.wing ?? "尚未绑定"),
            title: allProjects
              ? projects.map((candidate) => candidate.wing).join("\n")
              : (status.wing ?? undefined),
            tone: allProjects || status.wing ? "normal" : "warning",
          },
          { label: "素材", value: materialCount },
          {
            label: "结论",
            value:
              conclusionCount > 0
                ? `${conclusionCount}（候选 ${candidates} · 已采纳 ${adopted}）`
                : conclusionCount,
          },
          {
            label: "模型",
            value: status.modelReady ? "就绪" : "未下载",
            tone: status.modelReady ? "normal" : "warning",
          },
          ...(status.enabled
            ? []
            : [{ label: "记忆", value: "未启用", tone: "warning" as const }]),
          ...(status.library.error
            ? [
                {
                  label: "记忆库",
                  value: "打不开",
                  tone: "error" as const,
                  title: status.library.error,
                },
              ]
            : []),
        ]}
      />
      {/*
       * Scope belongs on this line: everything to its left is a count, and this is
       * what the counts are of. It used to be a segmented control in the content
       * area, directly under the tab bar and styled like it, where it read as a
       * second row of tabs.
       */}
      <button
        type="button"
        className="shrink-0 rounded-full bg-base-content/6 px-2.5 py-1 text-[11.5px] text-base-content/60 transition-colors hover:bg-base-content/12 hover:text-base-content"
        onClick={() => onScopeChange(!allProjects)}
        title={
          allProjects
            ? "正在读整个记忆库。点一下只看这个项目。"
            : "正在只读这个项目。点一下读整个记忆库。"
        }
      >
        {allProjects ? "全部项目 ↔" : "本项目 ↔"}
      </button>
    </PanelStrip>
  );
}
