import { TextControlButton } from "../../../common/components/ui-controls";

export type WorkingQuickSection =
  | "Updated"
  | "Focus"
  | "Open Questions"
  | "Recent Decisions";

interface MemoryWorkingContextTabProps {
  text: string;
  loading: boolean;
  saving: boolean;
  quickNote: string;
  quickSection: WorkingQuickSection;
  onTextChange: (text: string) => void;
  onQuickNoteChange: (text: string) => void;
  onQuickSectionChange: (section: WorkingQuickSection) => void;
  onRefresh: () => Promise<void>;
  onSave: () => Promise<void>;
  onAppend: () => Promise<void>;
  onPromote: () => Promise<void>;
}

const WORKING_QUICK_SECTIONS: Array<{
  value: WorkingQuickSection;
  label: string;
}> = [
  { value: "Updated", label: "进度" },
  { value: "Focus", label: "当前目标" },
  { value: "Open Questions", label: "阻塞问题" },
  { value: "Recent Decisions", label: "最近决定" },
];

export function MemoryWorkingContextTab({
  text,
  loading,
  saving,
  quickNote,
  quickSection,
  onTextChange,
  onQuickNoteChange,
  onQuickSectionChange,
  onRefresh,
  onSave,
  onAppend,
  onPromote,
}: MemoryWorkingContextTabProps) {
  return (
    <div className="space-y-2">
      <div className="space-y-2 border border-base-300 bg-base-200/60 p-2">
        <div className="font-medium text-base-content">快捷记录</div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {WORKING_QUICK_SECTIONS.map((section) => (
            <button
              key={section.value}
              type="button"
              className={[
                "h-7 truncate px-2 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                quickSection === section.value
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "bg-base-200 text-base-content/70 hover:text-base-content",
              ].join(" ")}
              onClick={() => onQuickSectionChange(section.value)}
            >
              {section.label}
            </button>
          ))}
        </div>
        <input
          className="h-8 w-full min-w-0 border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          value={quickNote}
          onChange={(event) => onQuickNoteChange(event.currentTarget.value)}
          placeholder="记录一句当前上下文"
        />
        <div className="flex flex-wrap justify-end gap-1">
          <TextControlButton
            onClick={() => void onAppend()}
            disabled={saving || quickNote.trim().length === 0}
          >
            记到工作记忆
          </TextControlButton>
          <TextControlButton
            onClick={() => void onPromote()}
            disabled={saving || quickNote.trim().length === 0}
          >
            记到长期记忆
          </TextControlButton>
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <TextControlButton onClick={() => void onRefresh()} disabled={loading}>
          刷新
        </TextControlButton>
        <TextControlButton onClick={() => void onSave()} disabled={saving}>
          {saving ? "保存中" : "保存"}
        </TextControlButton>
      </div>
      <textarea
        className="min-h-72 w-full resize-y border border-base-300 bg-base-100 p-2 font-mono text-xs leading-relaxed outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        value={loading ? "加载中..." : text}
        disabled={loading}
        onChange={(event) => onTextChange(event.currentTarget.value)}
      />
    </div>
  );
}

export function buildWorkingMemoryTitle(
  section: WorkingQuickSection,
  text: string,
) {
  const prefix =
    section === "Recent Decisions"
      ? "决定"
      : section === "Open Questions"
        ? "问题"
        : section === "Focus"
          ? "目标"
          : "进展";

  return `${prefix}：${text}`;
}
