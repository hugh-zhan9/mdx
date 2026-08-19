"use client";

import {
  PANEL_GUTTER,
  TextControlButton,
} from "@/common/components/ui-controls";
import type { GateReport, ProjectSummary, StoredItem } from "../lib/types";
import { MemoryConclusionsTab } from "./memory-conclusions-tab";
import { MemoryMaterialTab } from "./memory-material-tab";

interface MemoryWorkbenchProps {
  material: StoredItem[];
  conclusions: StoredItem[];
  selected: string[];
  gates: Record<string, GateReport>;
  busy: string | null;
  gateFailure: { drawerId: string; reasons: string[] } | null;
  hasMoreMaterial: boolean;
  onLoadMoreMaterial: () => void;
  onSearch: (query: string) => void;
  onAdd: (body: string) => void;
  onDelete: (drawerId: string) => void;
  onToggleSelected: (drawerId: string) => void;
  onDistillSelected: () => void;
  onAdopt: (drawerId: string) => void;
  onRetire: (drawerId: string, evidenceRefs: string[]) => void;
  onAddCounterexample: (drawerId: string, body: string) => void;
  onOpenContext: () => void;
  onOpenEntry: (drawerId: string) => void;
  /** Every project in the library, so an empty one can point at a full one. */
  projects: ProjectSummary[];
  onRebind: (wing: string) => void;
  /** Whether the lists cover the whole library or just this project. */
  allProjects: boolean;
}

/**
 * The work, in one screen: material on the left, what was concluded from it on
 * the right.
 *
 * They were two tabs, and the motion they serve is one — select a few pieces of
 * material, draw a conclusion, watch it appear as a candidate, adopt it. Split
 * across tabs, the result of the only button that matters happened somewhere the
 * user could not see, so the way to check it was to switch tabs and look.
 *
 * One column under a narrow window, because two columns of 300px are worse than
 * one of 600px for text this dense.
 */
export function MemoryWorkbench({
  material,
  conclusions,
  selected,
  gates,
  busy,
  gateFailure,
  hasMoreMaterial,
  onLoadMoreMaterial,
  onSearch,
  onAdd,
  onDelete,
  onToggleSelected,
  onDistillSelected,
  onAdopt,
  onRetire,
  onAddCounterexample,
  onOpenContext,
  onOpenEntry,
  projects,
  onRebind,
  allProjects,
}: MemoryWorkbenchProps) {
  /*
   * Memory is one library for every workspace, so "this project has nothing"
   * usually means the material is filed under another one — after a workspace was
   * moved, renamed, or first opened somewhere else. Saying so where the emptiness
   * is, with the button that fixes it, beats leaving a user to conclude the
   * feature is broken. Not said when reading the whole library: then an empty
   * result means the library is empty, and there is nowhere to point.
   */
  const elsewhere =
    !allProjects && material.length === 0 && conclusions.length === 0
      ? projects
          .filter((project) => project.total > 0)
          .sort((left, right) => right.total - left.total)[0]
      : undefined;

  return (
    // `flex-1` because the tab that holds this is now a flex viewport rather than a
    // scroll container: the two columns scroll themselves, which is what their own
    // `overflow-auto` has always said they should do.
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="memory-workbench"
    >
      <Elsewhere project={elsewhere} onRebind={onRebind} />
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
        <section className="flex min-h-0 min-w-0 flex-col overflow-auto lg:border-r lg:border-[var(--mdx-separator)]">
          <ColumnHeading title="素材" hint="发生过的事，原样存着" />
          <MemoryMaterialTab
            items={material}
            selected={selected}
            busy={busy}
            hasMore={hasMoreMaterial}
            onLoadMore={onLoadMoreMaterial}
            onSearch={onSearch}
            onAdd={onAdd}
            onDelete={onDelete}
            onToggleSelected={onToggleSelected}
            onDistillSelected={onDistillSelected}
          />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-auto">
          <ColumnHeading
            title="结论"
            hint="只有被采纳的才会进 agent 的上下文"
          />
          <MemoryConclusionsTab
            items={conclusions}
            gates={gates}
            busy={busy}
            gateFailure={gateFailure}
            materialCount={material.length}
            onAdopt={onAdopt}
            onRetire={onRetire}
            onAddCounterexample={onAddCounterexample}
            onOpenContext={onOpenContext}
            onOpenEntry={onOpenEntry}
          />
        </section>
      </div>
    </div>
  );
}

/**
 * A column's name and what it holds.
 *
 * Sticky, so scrolling a thousand pieces of material never leaves you unsure which
 * side you are reading. Same two sizes as every other heading in the app: 13px for
 * the name, 11px for what qualifies it.
 */
function ColumnHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className={`sticky top-0 z-10 min-w-0 bg-[var(--mdx-content-bg)] pb-3 pt-6 ${PANEL_GUTTER}`}>
      <h2 className="text-[20px] font-[650] leading-[1.3] tracking-[-0.01em] text-base-content">
        {title}
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-base-content/50">
        {hint}
      </p>
    </div>
  );
}

/** Where the material is, when it is not here. */
function Elsewhere({
  project,
  onRebind,
}: {
  project: ProjectSummary | undefined;
  onRebind: (wing: string) => void;
}) {
  if (!project) {
    return null;
  }

  return (
    <div className="mx-[clamp(14px,2.1vw,24px)] mb-1 mt-4 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-l-2 border-primary/50 bg-primary/5 px-3.5 py-2.5 text-[13px] leading-[1.7]">
      <span className="min-w-0">
        这个项目是空的，但本机的{" "}
        <span className="font-medium" title={project.path ?? project.wing}>
          {project.path ?? project.wing}
        </span>{" "}
        有 {project.evidence} 条素材、{project.knowledge} 条结论。
      </span>
      <TextControlButton onClick={() => onRebind(project.wing)}>
        把这个工作区绑过去
      </TextControlButton>
    </div>
  );
}

