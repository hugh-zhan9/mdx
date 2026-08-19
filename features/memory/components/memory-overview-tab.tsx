"use client";

import {
  FactRows,
  HairlineItem,
  PanelText,
  PrimaryTextControlButton,
  TextControlButton,
} from "@/common/components/ui-controls";
import type { MemoryStatus, ProjectSummary } from "../lib/types";

interface MemoryOverviewTabProps {
  status: MemoryStatus;
  projects: ProjectSummary[];
  busy: string | null;
  onToggleEnabled: (enabled: boolean) => void;
  onDownloadModel: () => void;
  onRebuildIndex: () => void;
  /** Points this workspace at a project that already holds material. */
  onRebind: (wing: string) => void;
}

/**
 * Whether memory works here, and the two things that usually stop it.
 *
 * A workspace has to opt in, and the embedding model has to be on disk. Both
 * are stated plainly rather than hidden behind a failure later: writing without
 * a model is refused, so a user who has not downloaded it needs to hear that
 * before they type a note, not after.
 */
export function MemoryOverviewTab({
  status,
  projects,
  busy,
  onToggleEnabled,
  onDownloadModel,
  onRebuildIndex,
  onRebind,
}: MemoryOverviewTabProps) {
  const project = projects.find((candidate) => candidate.wing === status.wing);
  const elsewhere = projects.filter(
    (candidate) => candidate.wing !== status.wing,
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/*
       * The state as a sentence with its switch beside it, not in a tinted box: it
       * is the first thing on the page, and a box around the first thing draws a
       * border where the page has not started yet.
       */}
      <section className="flex min-w-0 items-start justify-between gap-6">
        <PanelText className="min-w-0">
          {status.enabled
            ? "记忆已启用。这个工作区的素材与结论存在本机的记忆库里。"
            : "记忆未启用。启用后，这个工作区的素材与结论会存进本机的记忆库。"}
        </PanelText>
        <PrimaryTextControlButton
          className="shrink-0"
          disabled={busy !== null}
          onClick={() => onToggleEnabled(!status.enabled)}
        >
          {status.enabled ? "停用" : "启用"}
        </PrimaryTextControlButton>
      </section>

      {/*
       * Tinted, because these two are states rather than content: something the
       * user has to act on before the rest of the page means anything.
       */}
      {!status.modelReady ? (
        <section className="rounded-[var(--mdx-control-radius)] border border-warning/40 bg-warning/10 p-3.5">
          <PanelText>
            还缺一个嵌入模型。写入与语义检索都要用它，没有它记忆不会退化成关键词模式，而是直接拒绝写入。下载是一次性的，之后完全离线可用。
          </PanelText>
          <div className="mt-3">
            <TextControlButton
              disabled={busy !== null}
              onClick={onDownloadModel}
            >
              {busy === "model" ? "下载中" : `下载 ${status.model}`}
            </TextControlButton>
          </div>
        </section>
      ) : null}

      {status.library.error ? (
        <section className="rounded-[var(--mdx-control-radius)] border border-error/40 bg-error/10 p-3.5">
          <PanelText className="break-words">
            记忆库打不开：{status.library.error}
          </PanelText>
        </section>
      ) : null}

      <FactRows
        items={[
          {
            label: "本项目",
            value: status.wing ?? "尚未绑定",
            title: status.wing ?? undefined,
          },
          {
            label: "条目",
            value: project
              ? `${project.total}（素材 ${project.evidence} · 结论 ${project.knowledge}）`
              : (status.library.drawerCount ?? 0),
          },
          {
            label: "库文件",
            value: status.library.path,
            title: status.library.path,
          },
          { label: "模型", value: status.model },
        ]}
      />

      {elsewhere.length > 0 ? (
        <section className="min-w-0">
          {/*
           * With a button, because moving or renaming a workspace makes it a new
           * project as far as the library is concerned, and the only advice on
           * offer was "rebind it manually" — for which there was no control at
           * all. The command existed; nothing called it.
           */}
          <PanelText tone="meta">
            工作区改名或移动之后会变成一个新项目。如果你的素材在下面某一项里，把这个工作区绑过去。
          </PanelText>
          <ul className="mt-2 flex min-w-0 flex-col">
            {elsewhere.map((candidate) => (
              <HairlineItem key={candidate.wing}>
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <span
                    className="min-w-0 truncate text-[13.5px] leading-[1.75] text-base-content/85"
                    title={candidate.path ?? candidate.wing}
                  >
                    {candidate.path ?? candidate.wing}
                    <span className="ml-2 text-[11.5px] text-base-content/45">
                      {candidate.total}
                    </span>
                  </span>
                  <TextControlButton
                    className="shrink-0"
                    disabled={busy !== null}
                    onClick={() => onRebind(candidate.wing)}
                  >
                    绑到这个项目
                  </TextControlButton>
                </div>
              </HairlineItem>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex min-w-0 items-center gap-3">
        <TextControlButton
          outlined
          disabled={busy !== null}
          onClick={onRebuildIndex}
        >
          {busy === "reindex" ? "重建中" : "重建索引"}
        </TextControlButton>
        <PanelText tone="meta" className="min-w-0">
          换过嵌入模型后需要重建一次。
        </PanelText>
      </section>
    </div>
  );
}
