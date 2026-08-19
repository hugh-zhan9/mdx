"use client";

import type { Ref } from "react";
import {
  Checkbox,
  FieldLabel,
  PanelSection,
  PanelText,
} from "@/common/components/ui-controls";
import type { WorkspaceMemoryConfig } from "../lib/types";

interface MemorySettingsSectionProps {
  sectionRef?: Ref<HTMLDivElement>;
  disabled: boolean;
  config: WorkspaceMemoryConfig | null;
  onToggleCapture: (enabled: boolean) => void;
  onToggleSource: (source: string, enabled: boolean) => void;
}

const SOURCES: Array<{ id: string; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
];

/**
 * The capture switches, and nothing else.
 *
 * What used to live here — picking a storage backend and migrating between
 * them — is gone with the second backend. What remains is the decision that
 * actually needs a person: which agents may put conversations into the library,
 * given that captured material can be deleted afterwards but never unseen.
 */
export function MemorySettingsSection({
  sectionRef,
  disabled,
  config,
  onToggleCapture,
  onToggleSource,
}: MemorySettingsSectionProps) {
  const captureEnabled = config?.capture.enabled === true;
  const sources = config?.capture.sources ?? [];

  return (
    // The dialog's own section, drawn by the same component as its neighbours: it
    // used to bring its own heading size and its own grid, which is most of what
    // made this page look unaligned.
    <div ref={sectionRef} data-settings-section="memory" className="scroll-mt-5">
      <PanelSection
        title="记忆"
        hint="默认关闭。捕获进库的内容只能事后删除，不能撤回，所以只捕获你在下面勾选的来源。"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <label className="flex min-w-0 items-center gap-2.5 text-[13.5px] leading-[1.75] text-base-content/85">
            <Checkbox
              disabled={disabled || config === null}
              checked={captureEnabled}
              onChange={(event) => onToggleCapture(event.target.checked)}
            />
            <span>自动捕获 agent 会话</span>
          </label>

          <fieldset className="min-w-0">
            <legend className="sr-only">捕获来源</legend>
            <FieldLabel>捕获哪些来源</FieldLabel>
            {/* Three names across one row: a column of three said no more and
                took three times the height. */}
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {SOURCES.map((source) => (
                <label
                  key={source.id}
                  className="flex min-w-0 items-center gap-2 text-[13px] leading-[1.6] text-base-content/85"
                >
                  <Checkbox
                    disabled={disabled || !captureEnabled || config === null}
                    checked={sources.includes(source.id)}
                    onChange={(event) =>
                      onToggleSource(source.id, event.target.checked)
                    }
                  />
                  <span className="truncate">{source.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {config === null ? (
            <PanelText tone="meta">打开工作区后可以修改这一项。</PanelText>
          ) : null}
        </div>
      </PanelSection>
    </div>
  );
}
