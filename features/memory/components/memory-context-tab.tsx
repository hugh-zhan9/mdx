"use client";

import { useState } from "react";
import {
  HairlineItem,
  PANEL_GUTTER,
  PanelSection,
  PanelTitle,
  PanelText,
  StatList,
  StateLabel,
  TextControlButton,
  TextInput,
} from "@/common/components/ui-controls";
import type { ContextItem, RecallResult } from "../lib/types";

interface MemoryContextTabProps {
  result: RecallResult | null;
  busy: string | null;
  /** How many conclusions are adopted, which decides whether this can be empty. */
  adoptedCount: number;
  onRun: (query: string) => void;
  onOpenEntry: (drawerId: string) => void;
}

/**
 * What an agent would actually be handed for a given task.
 *
 * Read-only on purpose: this is assembled from the library every time it is
 * asked for, so it is the one screen that can answer "did adopting that change
 * anything". An empty pack means nothing has been adopted, not that the query was
 * bad, which is why the count is said before the query rather than after.
 *
 * Two things this screen got wrong until now, both visible the first time it ran
 * against a real library. It put everything the assembler returned under the
 * heading "会注入的结论", and most of what comes back is material — the pack is
 * conclusions *and* the evidence that matched, and calling material a conclusion
 * misrepresents the one distinction the whole feature rests on. And it printed
 * each item's full text, which for a chunk of an i18n table is several hundred
 * lines of error codes: a wall nobody reads is the same as showing nothing.
 */
export function MemoryContextTab({
  result,
  busy,
  adoptedCount,
  onRun,
  onOpenEntry,
}: MemoryContextTabProps) {
  const [query, setQuery] = useState("");
  const asked = result !== null;

  const field = (
    <div className="flex min-w-0 items-center gap-2">
      <TextInput
        value={query}
        placeholder="描述当前任务"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && query.trim().length > 0) {
            onRun(query);
          }
        }}
      />
      <TextControlButton
        outlined
        className="shrink-0"
        disabled={busy !== null || query.trim().length === 0}
        onClick={() => onRun(query)}
      >
        {busy === "recall" ? "组装中" : "看看会拿到什么"}
      </TextControlButton>
    </div>
  );

  return (
    // `min-h-full` so the unasked state can sit in the middle of the panel rather
    // than at the top of it: this page has exactly one thing to do before a query,
    // and a lone field pinned under the tab bar does not say so.
    <div className="flex min-h-full min-w-0 flex-col">
      {asked ? (
        /*
         * Asked: the field moves to the top and stays there, the way a search page
         * keeps its query in view while you read what came back.
         */
        <div
          className={`sticky top-0 z-10 min-w-0 border-b border-[var(--mdx-separator)] bg-[var(--mdx-content-bg)] py-3 ${PANEL_GUTTER}`}
        >
          <div className="min-w-0 lg:max-w-2xl">{field}</div>
        </div>
      ) : (
        // Centred with a bias upwards: geometric centre always reads as low,
        // because the eye puts the optical middle above it — the extra bottom
        // padding is what lifts the block into that spot.
        <div className="flex min-w-0 flex-1 items-center justify-center px-6 pb-[16vh] pt-10">
          <div className="w-full max-w-xl min-w-0">
            <PanelTitle className="text-center">Agent 会读到什么</PanelTitle>
            <p className="mt-2 text-center text-[13px] leading-[1.6] text-base-content/50">
              描述一个任务，看这一轮组装出来的上下文——结论是判断，素材是原始记录。
            </p>
            <div className="mt-6 min-w-0">{field}</div>
            {adoptedCount === 0 ? (
              <p className="mt-4 text-center text-[13px] leading-[1.6] text-warning">
                现在没有任何已采纳的结论，所以无论输入什么，结论那一栏都会是空的。
              </p>
            ) : (
              <p className="mt-4 text-center text-[11.5px] leading-relaxed text-base-content/45">
                本项目有 {adoptedCount} 条已采纳的结论可供组装。
              </p>
            )}
          </div>
        </div>
      )}

      {result !== null ? (
        <Assembled result={result} onOpenEntry={onOpenEntry} />
      ) : null}
    </div>
  );
}

function Assembled({
  result,
  onOpenEntry,
}: {
  result: RecallResult;
  onOpenEntry: (drawerId: string) => void;
}) {
  // A conclusion is what carries a status or a tier; everything else the
  // assembler returned is material it matched on.
  const conclusions = result.context.items.filter(
    (item) => item.status !== null || item.tier !== null,
  );
  const material = result.context.items.filter(
    (item) => item.status === null && item.tier === null,
  );

  return (
    <>
      <div className={`min-w-0 pb-2 pt-5 ${PANEL_GUTTER}`}>
        {/*
         * Our own numbers, in the interface's language. The backend's own summary is
         * a generated English count sentence; it is kept underneath rather than
         * dropped, because a future version of it may say something we did not.
         */}
        <StatList
          items={[
            { label: "结论", value: conclusions.length },
            { label: "素材", value: material.length },
            { label: "关键事实", value: result.brief.keyFacts.length },
            {
              label: "待确认",
              value: result.brief.uncertainties.length,
              tone: result.brief.uncertainties.length > 0 ? "warning" : "normal",
            },
            ...(result.truncated
              ? [{ label: "结果", value: "已截断", tone: "warning" as const }]
              : []),
          ]}
        />

        {result.brief.summary.length > 0 ? (
          <PanelText tone="meta" className="mt-3 break-words">
            {result.brief.summary}
          </PanelText>
        ) : null}

        {result.brief.uncertainties.length > 0 ? (
          <section className="mt-5 min-w-0">
            <PanelText tone="meta">这一轮缺什么</PanelText>
            <ul className="mt-1 flex min-w-0 flex-col">
              {result.brief.uncertainties.map((item) => (
                <HairlineItem
                  key={`${item.kind}-${item.message}`}
                  className="py-2"
                >
                  <PanelText className="break-words">
                    {UNCERTAINTY[item.kind] ?? item.message}
                  </PanelText>
                </HairlineItem>
              ))}
            </ul>
          </section>
        ) : null}

        {/*
         * The engine's own words, in the language it wrote them in, behind a
         * disclosure. They are generated English sentences: useful when something
         * is odd, wrong as the voice of a Chinese interface, and not something to
         * paraphrase — a paraphrase of machine guidance is a guess about what the
         * machine meant.
         */}
        {result.brief.nextActions.length > 0 ||
        result.brief.uncertainties.length > 0 ? (
          <details className="mt-4 min-w-0">
            <summary className="cursor-pointer text-[11.5px] text-base-content/45">
              记忆引擎的原始提示（英文）
            </summary>
            <ul className="mt-1 flex min-w-0 flex-col gap-1">
              {[
                ...result.brief.uncertainties.map((item) => item.message),
                ...result.brief.nextActions,
              ].map((line) => (
                <li key={line}>
                  <PanelText tone="meta" className="break-words">
                    {line}
                  </PanelText>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {/*
       * The two halves of the pack, side by side on a wide window — the same shape
       * as 素材与结论, because it is the same distinction. Stacked, reading the
       * material meant scrolling past every conclusion first.
       */}
      <div className="grid min-w-0 grid-cols-1 xl:grid-cols-2">
        {conclusions.length > 0 ? (
          <Group
            title="会注入的结论"
            hint="agent 把这些当成已经成立的判断。"
            items={conclusions}
            onOpenEntry={onOpenEntry}
          />
        ) : (
          <PanelSection
            title="会注入的结论"
            hint="这一轮没有结论会被注入——右边的素材是检索命中，agent 读到的是原始记录，不是判断。"
          >
            <PanelText tone="meta">先在「素材与结论」里采纳一条。</PanelText>
          </PanelSection>
        )}

        {material.length > 0 ? (
          <Group
            title="一起带上的素材"
            hint="检索命中的原始记录，不是判断。"
            items={material}
            onOpenEntry={onOpenEntry}
          />
        ) : null}
      </div>
    </>
  );
}

function Group({
  title,
  hint,
  items,
  onOpenEntry,
}: {
  title: string;
  hint: string;
  items: ContextItem[];
  onOpenEntry: (drawerId: string) => void;
}) {
  return (
    <PanelSection
      title={title}
      hint={hint}
      actions={<StateLabel>{items.length}</StateLabel>}
    >
      <ul className="flex min-w-0 flex-col">
        {items.map((item) => (
          <PackedItem
            key={item.drawerId}
            item={item}
            onOpenEntry={onOpenEntry}
          />
        ))}
      </ul>
    </PanelSection>
  );
}

/**
 * What each kind of gap means, in this interface's words.
 *
 * Keyed on the engine's `kind` rather than on its sentence: the kinds are a small
 * closed set it reports for exactly this purpose, and translating the prose would
 * be guessing at what a generated sentence meant.
 */
const UNCERTAINTY: Record<string, string> = {
  no_cards: "这个项目还没有被采纳的结论，所以没有判断可以注入。",
  no_evidence: "没有找到与这个任务相关的素材。",
  no_key_facts: "命中的素材里没有可直接引用的关键事实。",
  unresolved_items: "命中的内容里有还没收尾的事项。",
  conflict_cue: "命中的内容里出现了矛盾、回滚或过时的说法，值得先核对。",
};

/** How much of an item is shown before it has to be asked for. */
const CLAMP = 240;

function PackedItem({
  item,
  onOpenEntry,
}: {
  item: ContextItem;
  onOpenEntry: (drawerId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = item.text.trim();
  const long = text.length > CLAMP;

  return (
    <HairlineItem>
      <PanelText className="min-w-0 whitespace-pre-wrap break-words">
        {expanded || !long ? text : `${text.slice(0, CLAMP)}…`}
      </PanelText>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] leading-relaxed text-base-content/45">
        {item.sourceFile ? (
          <span className="min-w-0 truncate" title={item.sourceFile}>
            {item.sourceFile}
          </span>
        ) : null}
        {item.evidenceRefs.length > 0 ? (
          <span>依据 {item.evidenceRefs.length} 条</span>
        ) : null}
        {long ? (
          <button
            type="button"
            className="text-base-content/60 underline decoration-dotted hover:text-base-content"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "收起" : `展开全文（${text.length} 字）`}
          </button>
        ) : null}
        <button
          type="button"
          className="text-base-content/60 underline decoration-dotted hover:text-base-content"
          onClick={() => onOpenEntry(item.drawerId)}
        >
          打开这条
        </button>
      </div>
    </HairlineItem>
  );
}
