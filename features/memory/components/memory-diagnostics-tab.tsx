"use client";

import { TextControlButton } from "@/common/components/ui-controls";
import type { MemoryDiagnostics } from "../lib/types";

interface MemoryDiagnosticsTabProps {
  diagnostics: MemoryDiagnostics | null;
  busy: string | null;
  onRefresh: () => void;
  onPurge: () => void;
  onExport: () => void;
  onLegacyImport: () => void;
  message: string | null;
}

/**
 * What is wrong, and the three ways out of it.
 *
 * The warnings come from the backend verbatim. Export is here rather than
 * buried in a menu because the library is a single file with no automatic
 * backup: a bundle is the only copy a user can keep.
 */
export function MemoryDiagnosticsTab({
  diagnostics,
  busy,
  onRefresh,
  onPurge,
  onExport,
  onLegacyImport,
  message,
}: MemoryDiagnosticsTabProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <TextControlButton disabled={busy !== null} onClick={onRefresh}>
          刷新
        </TextControlButton>
        <TextControlButton disabled={busy !== null} onClick={onExport}>
          导出备份
        </TextControlButton>
        <TextControlButton disabled={busy !== null} onClick={onLegacyImport}>
          导入旧记忆
        </TextControlButton>
        <TextControlButton
          className="hover:bg-error/10 hover:text-error"
          disabled={busy !== null}
          onClick={onPurge}
        >
          彻底清除已删除
        </TextControlButton>
      </div>

      {message ? (
        <p className="min-w-0 break-words rounded-[var(--mdx-control-radius)] bg-base-200/70 px-3 py-2 text-xs">
          {message}
        </p>
      ) : null}

      {diagnostics === null ? (
        <p className="text-xs text-base-content/55">加载中。</p>
      ) : (
        <>
          {diagnostics.warnings.length > 0 ? (
            <section className="min-w-0">
              <h3 className="text-xs font-medium text-base-content/70">
                需要注意
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {diagnostics.warnings.map((warning) => (
                  <li
                    key={warning}
                    className="min-w-0 break-words text-xs leading-relaxed text-base-content/70"
                  >
                    {warning}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-xs text-base-content/60">没有发现问题。</p>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <dt className="text-base-content/60">库文件</dt>
            <dd className="min-w-0 truncate" title={diagnostics.library.path}>
              {diagnostics.library.path}
            </dd>
            <dt className="text-base-content/60">schema</dt>
            <dd>
              {diagnostics.library.schemaVersion ?? "未知"} / 支持{" "}
              {diagnostics.library.supportedSchemaVersion}
            </dd>
            <dt className="text-base-content/60">可写</dt>
            <dd>{diagnostics.library.writable ? "是" : "否"}</dd>
            <dt className="text-base-content/60">条目</dt>
            <dd>{diagnostics.library.drawerCount ?? "未知"}</dd>
            <dt className="text-base-content/60">模型</dt>
            <dd className="min-w-0 truncate">
              {diagnostics.model.model}
              {diagnostics.model.ready ? "" : "（未下载）"}
            </dd>
            <dt className="text-base-content/60">项目数</dt>
            <dd>{diagnostics.projects}</dd>
          </dl>
        </>
      )}
    </div>
  );
}
