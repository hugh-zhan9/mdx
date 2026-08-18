"use client";

import { useState } from "react";
import {
  TextControlButton,
  TextInput,
} from "@/common/components/ui-controls";
import type { EvidenceRef, RecallResult } from "../lib/types";

interface MemoryContextTabProps {
  result: RecallResult | null;
  busy: string | null;
  onRun: (query: string) => void;
}

/**
 * What an agent would actually be handed for a given task.
 *
 * Read-only on purpose. The old working-context file was something a person
 * wrote and an agent read; this is assembled from adopted conclusions every
 * time it is asked for. Showing it is the only way to see whether the memory
 * layer is earning its place — an empty pack here means nothing has been
 * adopted, not that the query was bad.
 */
export function MemoryContextTab({
  result,
  busy,
  onRun,
}: MemoryContextTabProps) {
  const [query, setQuery] = useState("");

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <TextInput
          value={query}
          placeholder="描述当前任务"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onRun(query);
            }
          }}
        />
        <TextControlButton disabled={busy !== null} onClick={() => onRun(query)}>
          {busy === "recall" ? "组装中" : "看看会拿到什么"}
        </TextControlButton>
      </div>

      {result === null ? (
        <p className="py-8 text-center text-xs text-base-content/55">
          输入一个任务，看看 agent 这一轮会读到哪些结论。
        </p>
      ) : (
        <>
          <section className="min-w-0">
            <h3 className="text-xs font-medium text-base-content/70">摘要</h3>
            <p className="mt-1 min-w-0 break-words text-xs leading-relaxed">
              {result.brief.summary.length > 0
                ? result.brief.summary
                : "没有可用的结论。"}
            </p>
          </section>

          {result.context.items.length > 0 ? (
            <section className="min-w-0">
              <h3 className="text-xs font-medium text-base-content/70">
                会注入的结论
              </h3>
              <ul className="mt-1 flex min-w-0 flex-col gap-2">
                {result.context.items.map((item) => (
                  <li key={item.drawerId} className="min-w-0">
                    <div className="min-w-0 break-words text-xs">
                      {item.text}
                    </div>
                    {item.evidenceRefs.length > 0 ? (
                      <div className="mt-0.5 min-w-0 truncate text-[11px] text-base-content/50">
                        依据 {item.evidenceRefs.length} 条：
                        {item.evidenceRefs
                          .map((reference: EvidenceRef) => reference.sourceFile)
                          .join("、")}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.brief.uncertainties.length > 0 ? (
            <section className="min-w-0">
              <h3 className="text-xs font-medium text-base-content/70">
                不确定的地方
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {result.brief.uncertainties.map((item) => (
                  <li
                    key={`${item.kind}-${item.message}`}
                    className="min-w-0 break-words text-[11px] text-base-content/60"
                  >
                    {item.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.hits.length > 0 ? (
            <section className="min-w-0">
              <h3 className="text-xs font-medium text-base-content/70">
                相关素材
              </h3>
              <ul className="mt-1 flex min-w-0 flex-col gap-1">
                {result.hits.map((hit) => (
                  <li key={hit.drawerId} className="min-w-0">
                    <div className="min-w-0 break-words text-[11px] leading-relaxed text-base-content/70">
                      {hit.snippet}
                    </div>
                    <div
                      className="min-w-0 truncate text-[11px] text-base-content/45"
                      title={hit.sourceFile}
                    >
                      {hit.sourceFile}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
