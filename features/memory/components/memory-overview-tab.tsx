import { TextControlButton } from "../../../common/components/ui-controls";
import type { MemoryBackendStatus } from "../lib/types";

interface MemoryOverviewTabProps {
  status: MemoryBackendStatus | null;
  loading: boolean;
  hasMemory: boolean;
  canInitialize: boolean;
  initializing: boolean;
  onInitialize: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function MemoryOverviewTab({
  status,
  loading,
  hasMemory,
  canInitialize,
  initializing,
  onInitialize,
  onRefresh,
}: MemoryOverviewTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-1">
        <TextControlButton onClick={() => void onRefresh()} disabled={loading}>
          刷新
        </TextControlButton>
      </div>

      {!hasMemory ? (
        <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
          <div className="font-medium text-base-content">记忆后端未初始化</div>
          <div className="text-base-content/70">
            初始化后会创建本地记忆工作区，并作为 Codex、Claude、Cursor 的外挂记忆后端使用。
          </div>
          <TextControlButton
            className="justify-center border-base-content bg-base-content text-base-100 hover:bg-base-content/85 hover:text-base-100"
            disabled={!canInitialize || initializing}
            onClick={() => void onInitialize()}
          >
            {initializing ? "初始化中" : "初始化记忆后端"}
          </TextControlButton>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <StatusCard
          label="Daemon"
          value={formatBackendHealth(status?.daemon.status)}
          detail={status?.daemon.last_error ?? "本地后端状态"}
        />
        <StatusCard
          label="Storage"
          value={status ? `${status.storage.backend} · ${status.storage.status}` : "加载中"}
          detail="运行时数据库"
        />
        <StatusCard
          label="Queue"
          value={status ? `${status.queue.depth} 个任务` : "加载中"}
          detail="待处理后台任务"
        />
        <StatusCard
          label="Projection"
          value={status ? formatProjectionStatus(status.projection.status) : "加载中"}
          detail={
            status
              ? `${status.projection.dirty_count} 个待投影更新`
              : "Markdown 可读投影"
          }
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <StatusCard
          label="今日捕获"
          value={String(status?.today.captured_events ?? 0)}
          detail="来自 agent hook 的原始事件"
        />
        <StatusCard
          label="待确认"
          value={String(status?.today.pending_candidates ?? 0)}
          detail="等待人工确认的记忆候选"
        />
      </div>
    </div>
  );
}

function StatusCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 border border-base-300 bg-base-200/60 p-2">
      <div className="text-base-content/60">{label}</div>
      <div className="mt-1 truncate font-medium text-base-content" title={value}>
        {value}
      </div>
      <div className="mt-1 truncate text-base-content/60" title={detail}>
        {detail}
      </div>
    </div>
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
