"use client";

import { useState } from "react";
import {
  PrimaryTextControlButton,
  TextArea,
  TextControlButton,
  TextInput,
} from "@/common/components/ui-controls";
import type { StoredItem } from "../lib/types";

interface MemoryMaterialTabProps {
  items: StoredItem[];
  selected: string[];
  busy: string | null;
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
  onSearch,
  onAdd,
  onDelete,
  onToggleSelected,
  onDistillSelected,
}: MemoryMaterialTabProps) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4 text-sm">
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
        <summary className="cursor-pointer text-xs text-base-content/65">
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
          <PrimaryTextControlButton
            disabled={busy !== null}
            onClick={onDistillSelected}
          >
            由此得出结论
          </PrimaryTextControlButton>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="py-8 text-center text-xs text-base-content/55">
          这个项目还没有素材。
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col">
          {items.map((item) => (
            <li
              key={item.drawerId}
              className="flex min-w-0 gap-3 border-b border-[var(--mdx-separator)] py-2"
            >
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                aria-label={`选择 ${item.drawerId}`}
                checked={selected.includes(item.drawerId)}
                onChange={() => onToggleSelected(item.drawerId)}
              />
              <div className="min-w-0 flex-1">
                <p className="min-w-0 break-words text-xs leading-relaxed">
                  {item.excerpt}
                </p>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-base-content/50">
                  <span className="shrink-0">{item.room}</span>
                  {item.sourceFile ? (
                    <span className="min-w-0 truncate" title={item.sourceFile}>
                      {item.sourceFile}
                    </span>
                  ) : null}
                </div>
              </div>
              <TextControlButton
                className="shrink-0 hover:bg-error/10 hover:text-error"
                disabled={busy !== null}
                onClick={() => onDelete(item.drawerId)}
              >
                删除
              </TextControlButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
