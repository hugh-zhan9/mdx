import {
  Card,
  PrimaryTextControlButton,
} from "../../../common/components/ui-controls";
import type { MemoryBackendStatus } from "../lib/types";

interface MemoryOverviewTabProps {
  status: MemoryBackendStatus | null;
  hasMemory: boolean;
  canInitialize: boolean;
  initializing: boolean;
  onInitialize: () => Promise<void>;
}

export function MemoryOverviewTab({
  status,
  hasMemory,
  canInitialize,
  initializing,
  onInitialize,
}: MemoryOverviewTabProps) {
  return (
    <div className="space-y-4">
      {!hasMemory ? (
        <Card className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="font-medium text-base-content">
              记忆后端未初始化
            </div>
            <div className="text-base-content/70">
              初始化后会创建本地记忆工作区，并作为 Codex、Claude、Cursor
              的外挂记忆后端使用。
            </div>
          </div>
          <PrimaryTextControlButton
            className="shrink-0"
            disabled={!canInitialize || initializing}
            onClick={() => void onInitialize()}
          >
            {initializing ? "初始化中" : "初始化记忆后端"}
          </PrimaryTextControlButton>
        </Card>
      ) : null}

      {/*
       * Six facts, so six equal tiles that reflow with the window rather than a
       * fixed pair of columns. At full width the old two-column grid gave each
       * tile a thousand pixels to hold three short lines; these stop growing
       * once they are wide enough to read.
       */}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
        <StatusCard
          label="后端进程"
          value={formatBackendHealth(status?.daemon.status)}
          detail={status?.daemon.last_error ?? "本地后端状态"}
        />
        <StatusCard
          label="存储"
          value={
            status ? `${status.storage.backend} · ${status.storage.status}` : "—"
          }
          detail="运行时数据库"
        />
        <StatusCard
          label="队列"
          value={status ? String(status.queue.depth) : "—"}
          unit={status ? "个任务" : undefined}
          detail="待处理后台任务"
        />
        <StatusCard
          label="投影"
          value={status ? formatProjectionStatus(status.projection.status) : "—"}
          detail={
            status
              ? `${status.projection.dirty_count} 个待更新`
              : "Markdown 可读投影"
          }
        />
        <StatusCard
          label="今日捕获"
          value={String(status?.today.captured_events ?? 0)}
          unit="个事件"
          detail="来自 agent hook 的原始事件"
        />
        <StatusCard
          label="待确认"
          value={String(status?.today.pending_candidates ?? 0)}
          unit="个候选"
          detail="等待人工确认的记忆候选"
        />
      </div>
    </div>
  );
}

/**
 * One fact, with the fact itself as the largest thing in the tile.
 *
 * The label and the explanation were previously the same size and weight as the
 * value, so a tile had no centre and the eye had to read all three lines to
 * find the number it came for.
 */
function StatusCard({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  /** Follows the value in smaller type, so "0" does not read as unitless. */
  unit?: string;
  detail: string;
}) {
  return (
    <Card className="min-w-0">
      <div className="truncate text-[11px] text-base-content/50" title={label}>
        {label}
      </div>
      <div className="mt-1.5 flex min-w-0 items-baseline gap-1">
        <span
          className="truncate text-lg font-medium leading-none text-base-content"
          title={value}
        >
          {value}
        </span>
        {unit ? (
          <span className="shrink-0 text-[11px] text-base-content/50">
            {unit}
          </span>
        ) : null}
      </div>
      <div
        className="mt-2 truncate text-[11px] text-base-content/50"
        title={detail}
      >
        {detail}
      </div>
    </Card>
  );
}

function formatBackendHealth(status: string | undefined) {
  if (status === "running") {
    return "运行中";
  }
  if (status === "degraded") {
    return "降级";
  }
  if (status === "disabled") {
    return "已关闭";
  }
  if (status === "stopped") {
    return "未启动";
  }
  return status ?? "加载中";
}

function formatProjectionStatus(status: string) {
  if (status === "ready") {
    return "就绪";
  }
  if (status === "dirty") {
    return "待更新";
  }
  if (status === "disabled") {
    return "已关闭";
  }
  if (status === "stopped") {
    return "未启动";
  }
  return status;
}
