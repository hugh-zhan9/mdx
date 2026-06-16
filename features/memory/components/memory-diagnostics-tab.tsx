import { TextControlButton } from "../../../common/components/ui-controls";
import type {
  MemoryBackendStatus,
  MemoryDoctorReport,
  MemoryIndexStatus,
  MemoryRepairResult,
} from "../lib/types";

interface MemoryDiagnosticsTabProps {
  backendStatus: MemoryBackendStatus | null;
  diagnostics: MemoryDoctorReport | null;
  indexStatus: MemoryIndexStatus | null;
  repairResult: MemoryRepairResult | null;
  loading: boolean;
  actionLoading: boolean;
  onRefresh: () => Promise<void>;
  onRepairWorkspace: () => Promise<void>;
  onRebuildIndex: () => Promise<void>;
}

export function MemoryDiagnosticsTab({
  backendStatus,
  diagnostics,
  indexStatus,
  repairResult,
  loading,
  actionLoading,
  onRefresh,
  onRepairWorkspace,
  onRebuildIndex,
}: MemoryDiagnosticsTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-1">
        <TextControlButton onClick={() => void onRefresh()} disabled={loading}>
          刷新
        </TextControlButton>
        <TextControlButton
          disabled={actionLoading}
          onClick={() => void onRepairWorkspace()}
        >
          {actionLoading ? "处理中" : "修复工作区"}
        </TextControlButton>
        <TextControlButton
          disabled={actionLoading}
          onClick={() => void onRebuildIndex()}
        >
          重建索引
        </TextControlButton>
      </div>

      <div className="space-y-1 border border-base-300 bg-base-200/60 p-2 text-base-content/75">
        <StatusLine
          label="后端"
          value={backendStatus ? backendStatus.daemon.status : "加载中"}
        />
        <StatusLine
          label="存储"
          value={
            backendStatus
              ? `${backendStatus.storage.backend} · ${backendStatus.storage.status}`
              : "加载中"
          }
        />
        <StatusLine
          label="队列"
          value={backendStatus ? `${backendStatus.queue.depth} 个任务` : "加载中"}
        />
        <StatusLine
          label="投影"
          value={
            backendStatus
              ? `${backendStatus.projection.status} · ${backendStatus.projection.dirty_count}`
              : "加载中"
          }
        />
        {indexStatus ? (
          <>
            <StatusLine label="索引" value={indexStatus.index_status} />
            <StatusLine
              label="索引文档"
              value={String(indexStatus.document_count)}
            />
          </>
        ) : null}
      </div>

      {diagnostics ? (
        <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
          <div className="font-medium text-base-content">
            集成诊断：{diagnostics.ok ? "通过" : "需要处理"}
          </div>
          {diagnostics.statuses.map((status) => (
            <StatusLine
              key={status.agent_source}
              label={status.agent_source}
              value={status.doctor_status}
            />
          ))}
          {diagnostics.errors.map((error) => (
            <div key={error} className="break-words text-error">
              {error}
            </div>
          ))}
          {diagnostics.warnings.map((warning) => (
            <div key={warning} className="break-words text-warning">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {repairResult ? (
        <div className="space-y-1 border border-base-300 bg-base-200/60 p-2 text-base-content/70">
          <div>已修复路径：{repairResult.repaired_paths.length}</div>
          {repairResult.warnings.map((warning) => (
            <div key={warning} className="break-words">
              {warning}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="shrink-0 text-base-content/60">{label}</span>
      <span className="min-w-0 truncate text-base-content">{value}</span>
    </div>
  );
}
