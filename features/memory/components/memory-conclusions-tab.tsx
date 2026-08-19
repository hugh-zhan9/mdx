"use client";

import { useState } from "react";
import {
  PrimaryTextControlButton,
  StateLabel,
  TextArea,
  TextControlButton,
  PANEL_GUTTER,
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
  /** How much material is on the other side, for the empty state to say so. */
  materialCount: number;
  onOpenContext: () => void;
  /** Opens one cited entry in full. */
  onOpenEntry: (drawerId: string) => void;
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
  materialCount,
  onAdopt,
  onRetire,
  onAddCounterexample,
  onOpenContext,
  onOpenEntry,
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
    const body =
      item.statement && item.excerpt.startsWith(item.statement)
        ? item.excerpt.slice(item.statement.length).trim()
        : item.excerpt;

    return (
      <li
        key={item.drawerId}
        className="min-w-0 border-t border-[var(--mdx-separator)] py-5 first:border-t-0"
      >
        <div className="min-w-0">
          <StateLabel
            tone={
              item.status === "promoted" || item.status === "canonical"
                ? "success"
                : item.status === "candidate"
                  ? "warning"
                  : "neutral"
            }
          >
            {STATUS_LABEL[item.status ?? ""] ?? "未知"}
          </StateLabel>
          <div className="mt-1.5 min-w-0 break-words text-[15px] font-semibold leading-[1.6]">
            {item.statement ?? item.excerpt}
          </div>
        </div>
        {/*
         * A conclusion's stored text usually opens with its own statement, so
         * printing both printed it twice — the same rule the entry dialog uses.
         */}
        {body.length > 0 ? (
          <p className="mt-2 min-w-0 break-words text-[13.5px] leading-[1.75] text-base-content/70">
            {body}
          </p>
        ) : null}

        {/*
         * What it stands on. The refs were in the row all along and the panel
         * never showed them, which left "adopted" as a claim with no way to ask
         * why — and the gate's counts alone say how many, not which.
         */}
        {item.supportingRefs.length + item.counterexampleRefs.length > 0 ? (
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[11.5px] text-base-content/45">依据</span>
            {item.supportingRefs.map((ref, index) => (
              <button
                key={ref}
                type="button"
                className="rounded-full bg-base-content/6 px-2 py-0.5 text-[10px] text-base-content/70 transition-colors hover:bg-primary/15 hover:text-primary"
                onClick={() => onOpenEntry(ref)}
              >
                素材 {index + 1}
              </button>
            ))}
            {item.counterexampleRefs.map((ref, index) => (
              <button
                key={ref}
                type="button"
                className="rounded-full bg-error/10 px-2 py-0.5 text-[10px] text-error transition-colors hover:bg-error/20"
                onClick={() => onOpenEntry(ref)}
              >
                反例 {index + 1}
              </button>
            ))}
          </div>
        ) : null}

        {gate ? (
          <p className="mt-2 text-[11.5px] text-base-content/45">
            证据 支持 {gate.evidence_counts.supporting}/
            {gate.requirements.min_supporting_refs} · 验证{" "}
            {gate.evidence_counts.verification}/
            {gate.requirements.min_verification_refs}
            {gate.evidence_counts.counterexample > 0
              ? ` · 反例 ${gate.evidence_counts.counterexample}`
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
              {busy === "adopt" ? "采纳中" : "采纳"}
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
        {/*
         * Smaller than the column's own heading: 候选 sits directly under 结论, and
         * at the same size the two read as two columns rather than as a heading and
         * the groups inside it.
         */}
        <h3 className="text-[13px] font-semibold leading-[1.6] text-base-content/75">
          {title}
          <span className="ml-2 font-normal text-base-content/40">
            {group.length}
          </span>
        </h3>
        {hint ? (
          <p className="mt-1.5 text-[13px] leading-[1.6] text-base-content/50">
            {hint}
          </p>
        ) : null}
        <ul className="mt-4 flex min-w-0 flex-col">{group.map(renderItem)}</ul>
      </section>
    );

  if (items.length === 0) {
    return (
      <div className={`flex min-w-0 flex-col gap-3 py-8 text-[13.5px] leading-[1.75] text-base-content/60 ${PANEL_GUTTER}`}>
        {/*
         * The numbers, then what a conclusion is for, then the way out. The old
         * empty state named an action — "go pick some material" — and offered no
         * way to take it, on a screen that also said nothing about the 1000
         * pieces of material sitting on the other side of it.
         */}
        <p>
          还没有结论。本项目有 <span className="text-base-content/85">{materialCount}</span>{" "}
          条素材（左栏），勾选几条再点「由此得出结论」。
        </p>
        <p>
          结论是唯一会进 agent 上下文的东西：素材再多，agent 也读不到。
        </p>
        <div>
          <TextControlButton onClick={onOpenContext}>
            看看 agent 现在读到什么
          </TextControlButton>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 flex-col gap-9 pb-10 pt-1 ${PANEL_GUTTER}`}>
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
