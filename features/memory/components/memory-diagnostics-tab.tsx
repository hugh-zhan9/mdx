"use client";

import {
  FactRows,
  HairlineItem,
  PanelText,
  TextControlButton,
} from "@/common/components/ui-controls";
import type { MemoryDiagnostics } from "../lib/types";

interface MemoryDiagnosticsTabProps {
  diagnostics: MemoryDiagnostics | null;
  busy: string | null;
  onExport: () => void;
  onLegacyImport: () => void;
}

/**
 * What is wrong, and the ways out of it that cannot destroy anything.
 *
 * The warnings come from the backend verbatim. Export is here rather than buried
 * in a menu because the library is a single file with no automatic backup: a
 * bundle is the only copy a user can keep. Purging tombstones used to be the
 * fourth button in this row — it is irreversible, so it has a group of its own.
 */
export function MemoryDiagnosticsTab({
  diagnostics,
  busy,
  onExport,
  onLegacyImport,
}: MemoryDiagnosticsTabProps) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <TextControlButton outlined disabled={busy !== null} onClick={onExport}>
          {busy === "export" ? "导出中" : "导出备份"}
        </TextControlButton>
        <TextControlButton disabled={busy !== null} onClick={onLegacyImport}>
          {busy === "legacy" ? "导入中" : "导入旧记忆"}
        </TextControlButton>
      </div>

      {diagnostics === null ? (
        <PanelText tone="meta">加载中。</PanelText>
      ) : (
        <>
          {diagnostics.warnings.length > 0 ? (
            <section className="min-w-0">
              <PanelText tone="meta">需要注意</PanelText>
              <ul className="mt-1 flex min-w-0 flex-col">
                {diagnostics.warnings.map((warning) => (
                  <HairlineItem key={warning} className="py-2.5">
                    <PanelText className="break-words">{warning}</PanelText>
                  </HairlineItem>
                ))}
              </ul>
            </section>
          ) : (
            <PanelText>没有发现问题。</PanelText>
          )}

          {/*
           * The library path, the entry count and the model are stated at the top of
           * this page already — three sections merged into one page, and each had
           * been repeating the other two's facts. What is only interesting when
           * something is wrong stays here.
           */}
          <FactRows
            items={[
              {
                label: "schema",
                value: `${diagnostics.library.schemaVersion ?? "未知"} / 支持 ${diagnostics.library.supportedSchemaVersion}`,
              },
              { label: "可写", value: diagnostics.library.writable ? "是" : "否" },
              { label: "项目数", value: diagnostics.projects },
            ]}
          />
        </>
      )}
    </div>
  );
}
