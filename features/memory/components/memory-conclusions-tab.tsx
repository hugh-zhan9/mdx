"use client";

import { useState } from "react";
import {
  PrimaryTextControlButton,
  TextArea,
  TextControlButton,
} from "@/common/components/ui-controls";
import type { GateReport, StoredItem } from "../lib/types";

interface MemoryConclusionsTabProps {
  items: StoredItem[];
  gates: Record<string, GateReport>;
  busy: string | null;
  /** The reason the last adoption was refused, shown as the backend worded it. */
  gateFailure: { drawerId: string; reasons: string[] } | null;
  onAdopt: (drawerId: string) => void;
  onRetire: (drawerId: string, evidenceRefs: string[]) => void;
  onAddCounterexample: (drawerId: string, body: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  candidate: "候选",
  promoted: "已采纳",
  canonical: "已采纳",
  demoted: "已降级",
  retired: "已退役",
};

/**
 * Conclusions, grouped by whether anyone has stood behind them.
 *
 * Adoption is one click, and that click is recorded as evidence in its own
 * right — which is the whole reason the gate can be satisfied at all. When it
 * cannot be, the backend's reasons are printed as they came, because a
 * paraphrase of "why not" is how a user ends up unable to fix it.
 */
export function MemoryConclusionsTab({
  items,
  gates,
  busy,
  gateFailure,
  onAdopt,
  onRetire,
  onAddCounterexample,
}: MemoryConclusionsTabProps) {
  const [counterexampleFor, setCounterexampleFor] = useState<string | null>(
    null,
  );
  const [counterexample, setCounterexample] = useState("");

  const candidates = items.filter((item) => item.status === "candidate");
  const adopted = items.filter(
    (item) => item.status === "promoted" || item.status === "canonical",
  );
  const retired = items.filter(
    (item) => item.status === "demoted" || item.status === "retired",
  );

  const renderItem = (item: StoredItem) => {
    const gate = gates[item.drawerId];
    const failure =
      gateFailure?.drawerId === item.drawerId ? gateFailure.reasons : null;

    return (
      <li
        key={item.drawerId}
        className="min-w-0 border-b border-[var(--mdx-separator)] py-3"
      >
        <div className="min-w-0 break-words text-sm font-medium">
          {item.statement ?? item.excerpt}
        </div>
        <p className="mt-1 min-w-0 break-words text-xs leading-relaxed text-base-content/65">
          {item.excerpt}
        </p>

        {gate ? (
          <p className="mt-1 text-[11px] text-base-content/50">
            证据 支持 {gate.evidenceCounts.supporting}/
            {gate.requirements.minSupportingRefs} · 验证{" "}
            {gate.evidenceCounts.verification}/
            {gate.requirements.minVerificationRefs}
            {gate.evidenceCounts.counterexample > 0
              ? ` · 反例 ${gate.evidenceCounts.counterexample}`
              : ""}
          </p>
        ) : null}

        {failure ? (
          <ul className="mt-2 flex flex-col gap-1 rounded-[var(--mdx-control-radius)] bg-error/10 px-2.5 py-2 text-[11px] text-base-content/75">
            {failure.map((reason) => (
              <li key={reason} className="min-w-0 break-words">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          {item.status === "candidate" ? (
            <PrimaryTextControlButton
              disabled={busy !== null}
              onClick={() => onAdopt(item.drawerId)}
            >
              采纳
            </PrimaryTextControlButton>
          ) : null}
          {item.status === "promoted" || item.status === "canonical" ? (
            <TextControlButton
              disabled={busy !== null}
              onClick={() => onRetire(item.drawerId, [])}
            >
              退役
            </TextControlButton>
          ) : null}
          <TextControlButton
            disabled={busy !== null}
            onClick={() =>
              setCounterexampleFor(
                counterexampleFor === item.drawerId ? null : item.drawerId,
              )
            }
          >
            记一条反例
          </TextControlButton>
        </div>

        {counterexampleFor === item.drawerId ? (
          <div className="mt-2 flex flex-col gap-2">
            <TextArea
              rows={2}
              value={counterexample}
              placeholder="这条结论在什么情况下不成立。"
              onChange={(event) => setCounterexample(event.target.value)}
            />
            <div>
              <TextControlButton
                disabled={counterexample.trim().length === 0 || busy !== null}
                onClick={() => {
                  onAddCounterexample(item.drawerId, counterexample);
                  setCounterexample("");
                  setCounterexampleFor(null);
                }}
              >
                记下来
              </TextControlButton>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const renderGroup = (title: string, group: StoredItem[], hint?: string) =>
    group.length === 0 ? null : (
      <section className="min-w-0">
        <h3 className="text-xs font-medium text-base-content/70">
          {title}
          <span className="ml-1 text-base-content/45">{group.length}</span>
        </h3>
        {hint ? (
          <p className="mt-0.5 text-[11px] text-base-content/50">{hint}</p>
        ) : null}
        <ul className="mt-1 flex min-w-0 flex-col">{group.map(renderItem)}</ul>
      </section>
    );

  if (items.length === 0) {
    return (
      <p className="p-8 text-center text-xs text-base-content/55">
        还没有结论。到「素材」里选几条，再由它们得出一条。
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 p-4">
      {renderGroup(
        STATUS_LABEL.candidate,
        candidates,
        "采纳之后，agent 下次开工才会读到它。",
      )}
      {renderGroup(STATUS_LABEL.promoted, adopted)}
      {renderGroup(STATUS_LABEL.retired, retired)}
    </div>
  );
}
