"use client";

import { useState } from "react";
import {
  TextArea,
  TextControlButton,
  TextInput,
  PANEL_GUTTER,
} from "@/common/components/ui-controls";
import type { StoredItem } from "../lib/types";

interface MemoryMaterialTabProps {
  items: StoredItem[];
  selected: string[];
  busy: string | null;
  /** Whether the library holds more than what was fetched. */
  hasMore: boolean;
  onLoadMore: () => void;
  onSearch: (query: string) => void;
  onAdd: (body: string) => void;
  onDelete: (drawerId: string) => void;
  onToggleSelected: (drawerId: string) => void;
  onDistillSelected: () => void;
}

/**
 * Everything that was captured, and the way out of it.
 *
 * Material is a record: it is shown as it was stored, with where it came from,
 * and the only judgements available are "delete this" and "these say
 * something — draw a conclusion". Captured material cannot be unremembered, so
 * the delete affordance sits on every row rather than in a menu.
 */
export function MemoryMaterialTab({
  items,
  selected,
  busy,
  hasMore,
  onLoadMore,
  onSearch,
  onAdd,
  onDelete,
  onToggleSelected,
  onDistillSelected,
}: MemoryMaterialTabProps) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");

  return (
    <div className={`flex min-w-0 flex-col gap-4 pb-8 pt-1 ${PANEL_GUTTER}`}>
      <div className="flex min-w-0 items-center gap-2">
        <TextInput
          value={query}
          placeholder="搜索素材"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSearch(query);
            }
          }}
        />
        <TextControlButton onClick={() => onSearch(query)}>
          搜索
        </TextControlButton>
      </div>

      <details className="min-w-0">
        <summary className="cursor-pointer text-[13px] text-base-content/55">
          手动记一条素材
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <TextArea
            rows={3}
            value={draft}
            placeholder="发生了什么。原样记录，不用总结成结论。"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <TextControlButton
              disabled={draft.trim().length === 0 || busy !== null}
              onClick={() => {
                onAdd(draft);
                setDraft("");
              }}
            >
              存为素材
            </TextControlButton>
            <span className="text-xs text-base-content/55">
              存进去只能事后删除，别放密钥。
            </span>
          </div>
        </div>
      </details>

      {selected.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--mdx-control-radius)] bg-base-200/70 px-3 py-2">
          <span className="text-xs">已选 {selected.length} 条</span>
          {/*
           * Not filled: the workbench shows this column beside the conclusions, and
           * 采纳 over there is the one irreversible act on the screen. Two filled
           * buttons say they are equally weighty, and they are not — the bar itself
           * is already what draws the eye here.
           */}
          <TextControlButton disabled={busy !== null} onClick={onDistillSelected}>
            由此得出结论
          </TextControlButton>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="py-10 text-[13.5px] leading-[1.75] text-base-content/50">
          这个项目还没有素材。上面「手动记一条素材」可以写一条，或者让 agent
          在它工作时存进来。
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col">
          {items.map((item) => (
            /*
             * A rule between entries rather than a box around each: these are
             * records on a page, and a page of boxes reads as a form. Selection is
             * said with a bar in the margin, which is the quietest mark that still
             * survives a glance.
             */
            <li
              key={item.drawerId}
              className={[
                "group -mx-3 flex min-w-0 gap-3 border-t border-[var(--mdx-separator)] px-3 py-4 transition-colors",
                selected.includes(item.drawerId)
                  ? "bg-primary/5 shadow-[inset_2px_0_0_var(--color-primary)]"
                  : "hover:bg-base-content/3",
              ].join(" ")}
            >
              <input
                type="checkbox"
                // Centred on the first line of the excerpt: at 13.5px/1.75 that line
                // is 23.6px tall, so a 14px box sits 5px down. `mt-1` put it a
                // pixel high against every row.
                className="mt-[5px] size-3.5 shrink-0 accent-[var(--color-primary)]"
                aria-label={`选择 ${item.drawerId}`}
                checked={selected.includes(item.drawerId)}
                onChange={() => onToggleSelected(item.drawerId)}
              />
              <div className="min-w-0 flex-1">
                <p className="min-w-0 break-words text-[13.5px] leading-[1.75] text-base-content/85">
                  {item.excerpt}
                </p>
                <div className="mt-1.5 flex min-w-0 items-center gap-3 text-[11.5px] leading-relaxed text-base-content/45">
                  {item.room ? <span className="shrink-0">{item.room}</span> : null}
                  {item.sourceFile ? (
                    <span className="min-w-0 truncate" title={item.sourceFile}>
                      {item.sourceFile}
                    </span>
                  ) : null}
                </div>
              </div>
              {/*
               * Shown on hover, reachable by keyboard: a live delete button on
               * every row turns a list into a minefield, and captured material
               * cannot be unremembered.
               */}
              <TextControlButton
                className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-error/10 hover:text-error"
                disabled={busy !== null}
                onClick={() => onDelete(item.drawerId)}
              >
                删除
              </TextControlButton>
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="pb-2">
          {/*
           * A growing window rather than pages: the list is read top-down and a
           * page you have to go back to is a place to lose your selection.
           */}
          <TextControlButton disabled={busy !== null} onClick={onLoadMore}>
            {busy === "material" ? "读取中" : "加载更多"}
          </TextControlButton>
        </div>
      ) : null}
    </div>
  );
}
