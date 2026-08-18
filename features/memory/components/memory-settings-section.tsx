"use client";

import type { Ref } from "react";
import { Card } from "@/common/components/ui-controls";
import type { WorkspaceMemoryConfig } from "../lib/types";

interface MemorySettingsSectionProps {
  sectionRef?: Ref<HTMLElement>;
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
    <section ref={sectionRef} className="flex min-w-0 flex-col gap-2">
      <h2 className="text-sm font-medium">记忆</h2>
      <Card className="flex min-w-0 flex-col gap-3 text-sm">
        <label className="flex min-w-0 items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            disabled={disabled || config === null}
            checked={captureEnabled}
            onChange={(event) => onToggleCapture(event.target.checked)}
          />
          <span className="min-w-0">
            <span className="block">自动捕获 agent 会话</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-base-content/60">
              默认关闭。捕获进库的内容只能事后删除，不能撤回，所以只捕获你在下面勾选的来源。
            </span>
          </span>
        </label>

        <fieldset className="flex min-w-0 flex-col gap-1.5 pl-6">
          <legend className="sr-only">捕获来源</legend>
          {SOURCES.map((source) => (
            <label key={source.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                disabled={disabled || !captureEnabled || config === null}
                checked={sources.includes(source.id)}
                onChange={(event) =>
                  onToggleSource(source.id, event.target.checked)
                }
              />
              {source.label}
            </label>
          ))}
        </fieldset>
      </Card>
    </section>
  );
}
