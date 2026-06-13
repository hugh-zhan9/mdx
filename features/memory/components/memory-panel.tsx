"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  IconButton,
  PanelHeader,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { MemoryWorkspaceHook } from "../hooks/use-memory-workspace";
import type { MemoryPanelTabId } from "../lib/memory-panel-state";

interface MemoryPanelProps {
  memory: MemoryWorkspaceHook;
}

export function MemoryPanel({ memory }: MemoryPanelProps) {
  const [activeTab, setActiveTab] = useState<MemoryPanelTabId>("settings");
  const effectiveTab =
    memory.tabs.find((tab) => tab.id === activeTab)?.disabled === true
      ? "settings"
      : activeTab;
  const activeTabModel = memory.tabs.find((tab) => tab.id === effectiveTab);
  const initializeDisabled =
    memory.loading || memory.viewState?.canInitialize === false;

  return (
    <section className="min-h-0 border-t border-base-300 bg-base-100">
      <PanelHeader
        title="Memory"
        actions={
          <IconButton
            label="Refresh memory status"
            icon={
              <RefreshCw className={memory.loading ? "animate-spin" : undefined} />
            }
            onClick={() => void memory.refresh()}
            disabled={memory.loading}
          />
        }
      />

      <div className="space-y-3 overflow-auto p-3 text-xs">
        <div className="grid grid-cols-3 gap-1 bg-base-200 p-1">
          {memory.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={[
                "h-7 truncate px-2 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/40",
                effectiveTab === tab.id
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/70 hover:text-base-content",
              ].join(" ")}
              disabled={tab.disabled}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {memory.error ? (
          <div className="space-y-2 border border-error/40 bg-error/5 p-2 text-error">
            <div className="break-words">{memory.error}</div>
            <TextControlButton
              className="border-error/40 text-error hover:bg-error/10 hover:text-error"
              onClick={() => void memory.refresh()}
              disabled={memory.loading}
            >
              Retry
            </TextControlButton>
          </div>
        ) : null}

        {effectiveTab === "settings" ? (
          <div className="space-y-3">
            <div className="space-y-1 border border-base-300 bg-base-200/60 p-2 text-base-content/75">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="shrink-0 text-base-content/60">Status</span>
                <span className="min-w-0 truncate text-base-content">
                  {memory.loading && !memory.status
                    ? "Loading"
                    : memory.hasMemory
                      ? "Ready"
                      : "Not initialized"}
                </span>
              </div>
              {memory.viewState ? (
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-base-content/60">Mode</span>
                  <span className="min-w-0 truncate text-base-content">
                    {memory.viewState.mode}
                  </span>
                </div>
              ) : null}
            </div>

            {!memory.hasMemory ? (
              <button
                type="button"
                className="h-8 w-full border border-base-content bg-base-content px-3 text-xs text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
                disabled={initializeDisabled}
                onClick={() => void memory.initialize()}
              >
                {memory.loading ? "Initializing" : "Initialize Memory"}
              </button>
            ) : null}

            {memory.viewState && memory.viewState.missingPaths.length > 0 ? (
              <div className="space-y-1 border border-base-300 bg-base-200/60 p-2 text-base-content/70">
                {memory.viewState.missingPaths.map((path) => (
                  <div key={path} className="truncate" title={path}>
                    {path}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="border border-base-300 bg-base-200/60 p-2 text-base-content/75">
            <div className="text-sm font-semibold text-base-content">
              {activeTabModel?.label}
            </div>
            <div className="mt-2">
              {memory.loading ? "Loading" : memory.hasMemory ? "Ready" : "Not initialized"}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
