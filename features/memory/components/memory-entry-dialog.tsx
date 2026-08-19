"use client";

import { X } from "lucide-react";
import {
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  FactRows,
  HairlineItem,
  PanelText,
  PrimaryTextControlButton,
  StateLabel,
  TextControlButton,
} from "@/common/components/ui-controls";
import type { StoredItem } from "../lib/types";

interface MemoryEntryDialogProps {
  item: StoredItem;
  /** Whether this entry is in the workbench's current selection. */
  selected: boolean;
  busy: string | null;
  onClose: () => void;
  onDelete: (drawerId: string) => void;
  onAdopt: (drawerId: string) => void;
  onRetire: (drawerId: string, evidenceRefs: string[]) => void;
  onToggleSelected: (drawerId: string) => void;
  /** Opens a cited entry in this same dialog, so a chain can be walked. */
  onOpenEntry: (drawerId: string) => void;
  /**
   * One line of text per id, for whatever the panel has loaded.
   *
   * A citation is stored as an id, and a list of eight ids is a list of eight
   * hashes — the whole point of showing the chain is reading what it says.
   */
  labels: Record<string, string>;
  /** Asks the store what it considers close to this entry. */
  onFindSimilar: (drawerId: string) => void;
}

/**
 * One entry, in full, with what can be done to it.
 *
 * A dot on the graph and a row in the list both lead here, because in both places
 * the question is the same: what does this actually say, and do I want to keep it.
 * It used to be a strip along the bottom of the panel that could show the text and
 * nothing else — so reading an entry meant closing it again and hunting for the
 * same entry in a list to act on it.
 *
 * Deletion is offered without a second confirmation and adoption is not, which is
 * the right way round: a deleted piece of material is gone from a library nobody
 * backs up automatically, while an adopted conclusion can be retired.
 */
export function MemoryEntryDialog({
  item,
  selected,
  busy,
  onClose,
  onDelete,
  onAdopt,
  onRetire,
  onToggleSelected,
  onOpenEntry,
  onFindSimilar,
  labels,
}: MemoryEntryDialogProps) {
  const isConclusion = item.kind === "conclusion";
  const adopted = item.status === "promoted" || item.status === "canonical";
  // A conclusion's stored text usually opens with its own statement, so printing
  // both is printing it twice.
  const body =
    item.statement && item.excerpt.startsWith(item.statement)
      ? item.excerpt.slice(item.statement.length).trim()
      : item.excerpt;
  const cited: Array<[string, string[]]> = [
    ["支撑素材", item.supportingRefs],
    ["采纳记录", item.verificationRefs],
    ["反例", item.counterexampleRefs],
  ];

  return (
    <DialogOverlay onDismiss={onClose}>
      <DialogSurface
        label={isConclusion ? "结论" : "素材"}
        testId="memory-entry-dialog"
        className="w-[min(92vw,620px)]"
      >
        <DialogHeader
          actions={
            <TextControlButton onClick={onClose}>
              <X aria-hidden="true" />
              关闭
            </TextControlButton>
          }
        >
          <StateLabel tone={isConclusion ? "primary" : "neutral"}>
            {isConclusion ? "结论" : "素材"}
          </StateLabel>
          {isConclusion ? (
            <StateLabel tone={adopted ? "success" : "warning"}>
              {adopted ? "已采纳" : "候选"}
            </StateLabel>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {item.statement ? (
            <p className="min-w-0 break-words text-[16px] font-[600] leading-[1.5] text-base-content">
              {item.statement}
            </p>
          ) : null}
          {body.length > 0 ? (
            <PanelText
              className={`min-w-0 whitespace-pre-wrap break-words ${item.statement ? "mt-3" : ""}`}
            >
              {body}
            </PanelText>
          ) : null}

          <FactRows
            className="mt-6"
            items={[
              ...(item.sourceFile
                ? [
                    {
                      label: "来源",
                      value: item.sourceFile,
                      title: item.sourceFile,
                    },
                  ]
                : []),
              ...(item.room ? [{ label: "分区", value: item.room }] : []),
              ...(item.addedAt ? [{ label: "存入", value: item.addedAt }] : []),
              { label: "id", value: item.drawerId, title: item.drawerId },
            ]}
          />

          {/*
           * The chain, walkable: a conclusion is only as good as what it stands on,
           * and until now the way to read its evidence was to know the ids by heart.
           */}
          {cited.map(([label, refs]) =>
            refs.length > 0 ? (
              <section key={label} className="mt-5 min-w-0">
                <PanelText tone="meta">{`${label}（${refs.length}）`}</PanelText>
                <ul className="mt-1 flex min-w-0 flex-col">
                  {refs.map((ref) => (
                    <HairlineItem key={ref} className="py-2">
                      <button
                        type="button"
                        className="min-w-0 max-w-full truncate text-left text-[13px] leading-[1.6] text-primary hover:underline"
                        onClick={() => onOpenEntry(ref)}
                        title={ref}
                      >
                        {labels[ref] ?? ref}
                      </button>
                    </HairlineItem>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>

        <footer className="flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--mdx-separator)] px-5 py-3">
          {isConclusion ? (
            <>
              {adopted ? null : (
                <PrimaryTextControlButton
                  disabled={busy !== null}
                  onClick={() => onAdopt(item.drawerId)}
                >
                  {busy === "adopt" ? "采纳中" : "采纳"}
                </PrimaryTextControlButton>
              )}
              <TextControlButton
                outlined
                disabled={busy !== null}
                onClick={() => onRetire(item.drawerId, item.supportingRefs)}
              >
                退役
              </TextControlButton>
            </>
          ) : (
            <>
              <TextControlButton
                outlined
                disabled={busy !== null}
                onClick={() => onToggleSelected(item.drawerId)}
              >
                {selected ? "取消选择" : "选中，用来得出结论"}
              </TextControlButton>
              <TextControlButton
                outlined
                disabled={busy !== null}
                onClick={() => onFindSimilar(item.drawerId)}
              >
                找相似
              </TextControlButton>
            </>
          )}
          {/*
           * Right-aligned, and red only under the pointer: it is the one act here
           * that cannot be undone, and it should not also be the brightest thing in
           * the row.
           */}
          <TextControlButton
            className="ml-auto hover:bg-error/10 hover:text-error"
            disabled={busy !== null}
            onClick={() => onDelete(item.drawerId)}
          >
            {busy === "delete" ? "删除中" : "删除"}
          </TextControlButton>
        </footer>
      </DialogSurface>
    </DialogOverlay>
  );
}
