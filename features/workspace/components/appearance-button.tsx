"use client";

import { FolderOpen, Plus, RefreshCw, Shirt, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  IconButton,
  PrimaryTextControlButton,
  SegmentedControl,
  TextControlButton,
} from "../../../common/components/ui-controls";
import {
  SYSTEM_THEME_PREFERENCE,
  useThemePreference,
} from "../lib/theme-preference";
import {
  THEME_DESIGNER_FIELDS,
  draftFromCurrentTheme,
  revealUserThemesDir,
  saveThemeDraft,
  themeFileName,
  type ThemeDraft,
} from "../lib/theme-designer";
import { builtInThemesByAppearance } from "../lib/themes";
import type { ThemeAppearance } from "../lib/themes";
import { useUserThemes } from "../lib/use-user-themes";
import { userThemeId } from "../lib/theme-contract";
import type { UserThemeEntry } from "../lib/user-themes";

/**
 * Appearance, on the title bar rather than inside the settings panel.
 *
 * Changing how the window looks is something people do while looking at the
 * window — often several times in a minute, comparing. Kept in a settings panel
 * it was four clicks deep behind a page of numbers about search limits, which is
 * a place for a decision you make once.
 */
export function AppearanceButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        active={open}
        aria-pressed={open}
        label="外观"
        icon={<Shirt />}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? <AppearancePanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AppearancePanel({ onClose }: { onClose: () => void }) {
  const { preference, setPreference } = useThemePreference();
  const userThemes = useUserThemes();
  const groups = useMemo(() => builtInThemesByAppearance(), []);
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * Saves the draft, then selects it.
   *
   * Selecting it is the point: a theme you made and then have to go find in a
   * list is a theme you cannot see the effect of. The list is reloaded first so
   * the palette is on the page before the preference names it.
   */
  const save = async (next: ThemeDraft) => {
    setMessage(null);

    const fileName = themeFileName(next.name);

    if (fileName === null) {
      setMessage("主题名称不能为空");
      return;
    }

    try {
      await saveThemeDraft(next);
      await userThemes.refresh();
      setPreference(userThemeId(fileName));
      setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 py-14 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="外观"
        // Wider than a list strictly needs, because the designer is the widest
        // thing in here: ten colour rows and their explanations. Still narrower
        // than the settings panel — this is one decision, not a page of them.
        className="flex h-[min(740px,84dvh,calc(100dvh-2rem))] min-h-0 w-[min(92vw,640px)] min-w-0 flex-col overflow-hidden rounded-xl bg-base-100 shadow-[var(--mdx-panel-shadow)]"
      >
        <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--mdx-separator)] px-4 py-3">
          <div className="min-w-0 text-sm font-medium">
            {draft ? "新建主题" : "外观"}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {message ? (
              <span className="max-w-48 truncate text-xs text-error">
                {message}
              </span>
            ) : null}
            <TextControlButton onClick={draft ? () => setDraft(null) : onClose}>
              <X aria-hidden="true" />
              {draft ? "取消" : "关闭"}
            </TextControlButton>
            {draft ? (
              <PrimaryTextControlButton onClick={() => void save(draft)}>
                保存并使用
              </PrimaryTextControlButton>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {draft ? (
            <ThemeDesigner draft={draft} onChange={setDraft} />
          ) : (
            <>
              <ThemeChoice
                selected={preference === SYSTEM_THEME_PREFERENCE}
                name="跟随系统"
                description="随 macOS 的浅色与深色外观自动切换。"
                onSelect={() => setPreference(SYSTEM_THEME_PREFERENCE)}
              />

              {/*
                * Light beside dark rather than one above the other. They are the
                * two halves of the same question, and stacked they did not fit:
                * choosing meant scrolling past one group to see the other, which
                * is the one thing a theme list must not make you do.
                *
                * One column again in a narrow window, where two would leave a
                * name with no room to be read.
                */}
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["浅色主题", groups.light],
                    ["深色主题", groups.dark],
                  ] as const
                ).map(([groupLabel, themes]) => (
                  <div key={groupLabel} className="min-w-0 space-y-1.5">
                    <p className="text-[11px] text-base-content/45">
                      {groupLabel}
                    </p>
                    <div className="space-y-1">
                      {themes.map((theme) => (
                        <ThemeChoice
                          key={theme.id}
                          selected={preference === theme.id}
                          name={theme.name}
                          description={theme.description}
                          swatch={<ThemeSwatch themeId={theme.id} />}
                          onSelect={() => setPreference(theme.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <UserThemeSection
                entries={userThemes.entries}
                directoryError={userThemes.directoryError}
                loading={userThemes.loading}
                selected={preference}
                onSelect={setPreference}
                onRefresh={() => void userThemes.refresh()}
                onCreate={() => {
                  setMessage(null);
                  setDraft(
                    draftFromCurrentTheme(
                      "我的主题",
                      currentAppearance(),
                    ),
                  );
                }}
                onOpenDirectory={() => {
                  setMessage(null);
                  void revealUserThemesDir().catch((error: unknown) => {
                    setMessage(
                      error instanceof Error ? error.message : String(error),
                    );
                  });
                }}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** Whether the window is currently on a light or a dark ground. */
function currentAppearance(): ThemeAppearance {
  return document.documentElement.dataset.mdxAppearance === "dark"
    ? "dark"
    : "light";
}

/**
 * Making a theme by choosing its colours.
 *
 * It starts from the theme already on screen, so this is an edit of something
 * that works rather than ten decisions from black. Every field is a native
 * colour input: the platform already has a colour picker, and it is the one the
 * user knows.
 */
function ThemeDesigner({
  draft,
  onChange,
}: {
  draft: ThemeDraft;
  onChange: (draft: ThemeDraft) => void;
}) {
  const fileName = themeFileName(draft.name);

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs text-base-content/70">
        <span>名称</span>
        <input
          type="text"
          className="h-9 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
          value={draft.name}
          onChange={(event) =>
            onChange({ ...draft, name: event.currentTarget.value })
          }
        />
        <span className="block text-[11px] text-base-content/45">
          {fileName === null
            ? "取个名字，它同时是文件名。"
            : `保存为 ~/.mdx/themes/${fileName}`}
        </span>
      </label>

      <div className="space-y-1.5">
        <p className="text-xs text-base-content/70">明暗</p>
        <SegmentedControl
          value={draft.appearance}
          options={APPEARANCE_OPTIONS}
          onChange={(next) => onChange({ ...draft, appearance: next })}
        />
        <p className="text-[11px] leading-relaxed text-base-content/45">
          决定滚动条、表单控件、代码配色和 macOS 标题栏站在浅色还是深色一边。
        </p>
      </div>

      <div className="grid gap-0.5 sm:grid-cols-2">
        {THEME_DESIGNER_FIELDS.map((field) => (
          <label
            key={field.property}
            className="flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-base-content/4"
          >
            <input
              type="color"
              aria-label={field.label}
              value={draft.colors[field.property] ?? "#808080"}
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-base-content/15 bg-base-100 p-0.5"
              onChange={(event) =>
                onChange({
                  ...draft,
                  colors: {
                    ...draft.colors,
                    [field.property]: event.currentTarget.value,
                  },
                })
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-base-content">
                {field.label}
              </span>
              <span className="line-clamp-2 text-[11px] leading-snug text-base-content/50">
                {field.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const APPEARANCE_OPTIONS: Array<{ value: ThemeAppearance; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

/**
 * Themes the user wrote, and what happened to each file.
 *
 * A file that did not become a theme is listed with its reason rather than
 * omitted: a theme that silently fails to appear is a state the user cannot
 * diagnose. The same goes for values that were refused inside a theme that
 * otherwise loaded — the count is shown so a typo is findable.
 */
function UserThemeSection({
  entries,
  directoryError,
  loading,
  selected,
  onSelect,
  onRefresh,
  onCreate,
  onOpenDirectory,
}: {
  entries: UserThemeEntry[];
  directoryError: string | null;
  loading: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onOpenDirectory: () => void;
}) {
  return (
    <div className="space-y-1.5 border-t border-[var(--mdx-separator)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-base-content/45">自定义主题</p>
        <div className="flex items-center gap-1">
          <TextControlButton onClick={onCreate}>
            <Plus aria-hidden="true" />
            新建
          </TextControlButton>
          <TextControlButton onClick={onOpenDirectory}>
            <FolderOpen aria-hidden="true" />
            文件夹
          </TextControlButton>
          <TextControlButton onClick={onRefresh} disabled={loading}>
            <RefreshCw
              aria-hidden="true"
              className={loading ? "animate-spin" : undefined}
            />
            刷新
          </TextControlButton>
        </div>
      </div>

      {directoryError ? (
        <p className="px-2.5 text-[11px] leading-relaxed text-warning">
          {`无法读取主题目录：${directoryError}`}
        </p>
      ) : entries.length === 0 ? (
        <p className="px-2.5 text-[11px] leading-relaxed text-base-content/45">
          点「新建」从当前主题改一个出来，或把自己写的 .css 放进 ~/.mdx/themes/
          后点刷新。
        </p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2">
          {entries.map((entry) =>
            entry.status === "ready" ? (
              <ThemeChoice
                key={entry.id}
                selected={selected === entry.id}
                name={entry.name}
                description={
                  entry.ignored.length > 0
                    ? `${entry.fileName} · 已忽略 ${String(entry.ignored.length)} 项`
                    : entry.fileName
                }
                swatch={<ThemeSwatch themeId={entry.id} />}
                onSelect={() => onSelect(entry.id)}
              />
            ) : (
              <div
                key={entry.id}
                className="flex items-start gap-2.5 px-2.5 py-2 text-[11px]"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-9 shrink-0 rounded-[3px] border border-dashed border-base-content/20"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-base-content/60">
                    {entry.fileName}
                  </span>
                  <span className="block text-warning">
                    {`无法加载：${entry.reason}`}
                  </span>
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** One selectable theme, as a row with its name, purpose and colors. */
function ThemeChoice({
  selected,
  name,
  description,
  swatch,
  onSelect,
}: {
  selected: boolean;
  name: string;
  description: string;
  swatch?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={[
        "flex w-full items-center gap-2.5 border px-2.5 py-2 text-left",
        selected
          ? "border-primary/60 bg-primary/8"
          : "border-transparent hover:bg-base-content/5",
      ].join(" ")}
    >
      {swatch ?? <span aria-hidden="true" className="h-5 w-9 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-base-content">{name}</span>
        {/*
         * Wrapped to two lines, not truncated: in a column half the width the
         * description is exactly the part that would be cut, and it is the
         * sentence saying why this theme exists rather than the one beside it.
         */}
        <span className="line-clamp-2 text-[11px] leading-snug text-base-content/50">
          {description}
        </span>
      </span>
      {selected ? (
        <span aria-hidden="true" className="text-xs text-primary">
          ✓
        </span>
      ) : null}
    </button>
  );
}

/**
 * A theme's own colors, painted by the theme itself.
 *
 * The swatch carries `data-theme`, so the palette it shows is the one the
 * stylesheet actually defines for that theme rather than a copy of it kept
 * here. A theme whose colors change is a swatch that changes with it, and one
 * that is added needs nothing added here.
 */
function ThemeSwatch({ themeId }: { themeId: string }) {
  return (
    <span
      data-theme={themeId}
      aria-hidden="true"
      className="flex h-5 w-9 shrink-0 overflow-hidden border border-base-content/15"
    >
      <span className="flex-1 bg-base-100" />
      <span className="flex-1 bg-base-200" />
      <span className="w-2 bg-primary" />
    </span>
  );
}
