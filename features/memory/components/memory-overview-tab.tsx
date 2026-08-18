"use client";

import { useState } from "react";
import {
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
}: MemoryOverviewTabProps) {
  const project = projects.find((candidate) => candidate.wing === status.wing);

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 text-sm">
      <section className="flex min-w-0 items-start justify-between gap-4 rounded-[var(--mdx-panel-radius)] bg-[var(--mdx-card-bg)] p-3">
        <div className="min-w-0">
          <div className="font-medium">
            {status.enabled ? "记忆已启用" : "记忆未启用"}
          </div>
          <p className="mt-1 text-xs text-base-content/65">
            {status.enabled
              ? "这个工作区的素材与结论存在本机的记忆库里。"
              : "启用后，这个工作区的素材与结论会存进本机的记忆库。"}
          </p>
        </div>
        <PrimaryTextControlButton
          disabled={busy !== null}
          onClick={() => onToggleEnabled(!status.enabled)}
        >
          {status.enabled ? "停用" : "启用"}
        </PrimaryTextControlButton>
      </section>

      {!status.modelReady ? (
        <section className="rounded-[var(--mdx-control-radius)] border border-warning/40 bg-warning/10 p-3">
          <div className="text-xs font-medium">还缺一个嵌入模型</div>
          <p className="mt-1 text-xs leading-relaxed text-base-content/70">
            写入与语义检索都要用它，没有它记忆不会退化成关键词模式，而是直接拒绝写入。下载是一次性的，之后完全离线可用。
          </p>
          <div className="mt-2">
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
        <section className="rounded-[var(--mdx-control-radius)] border border-error/40 bg-error/10 p-3">
          <div className="text-xs font-medium">记忆库打不开</div>
          <p className="mt-1 break-words text-xs leading-relaxed text-base-content/70">
            {status.library.error}
          </p>
        </section>
      ) : null}

      {/*
       * The label column is as wide as the labels, so a value starts where the
       * longest label ends. Two equal columns put every value at the halfway
       * mark of whatever width the window happened to be.
       */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-xs">
        <dt className="text-base-content/60">本项目</dt>
        <dd className="min-w-0 truncate" title={status.wing ?? ""}>
          {status.wing ?? "尚未绑定"}
        </dd>
        <dt className="text-base-content/60">条目</dt>
        <dd>
          {project
            ? `${project.total}（素材 ${project.evidence} · 结论 ${project.knowledge}）`
            : (status.library.drawerCount ?? 0)}
        </dd>
        <dt className="text-base-content/60">库文件</dt>
        <dd className="min-w-0 truncate" title={status.library.path}>
          {status.library.path}
        </dd>
        <dt className="text-base-content/60">模型</dt>
        <dd className="min-w-0 truncate">{status.model}</dd>
      </dl>

      {projects.length > 1 ? (
        <section className="min-w-0">
          <div className="text-xs font-medium">这台机器上的其它项目</div>
          <ul className="mt-1 flex flex-col gap-1">
            {projects
              .filter((candidate) => candidate.wing !== status.wing)
              .map((candidate) => (
                <li
                  key={candidate.wing}
                  className="min-w-0 truncate text-xs text-base-content/60"
                  title={candidate.path ?? candidate.wing}
                >
                  {candidate.path ?? candidate.wing} · {candidate.total}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="flex items-center gap-2">
        <TextControlButton disabled={busy !== null} onClick={onRebuildIndex}>
          {busy === "reindex" ? "重建中" : "重建索引"}
        </TextControlButton>
        <span className="text-xs text-base-content/55">
          换过嵌入模型后需要重建一次。
        </span>
      </section>
    </div>
  );
}

/** Small helper so a tab can show a one-line result without a toast system. */
export function useTransientMessage() {
  const [message, setMessage] = useState<string | null>(null);
  return { message, setMessage };
}
