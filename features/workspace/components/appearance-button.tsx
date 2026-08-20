"use client";

import { FolderOpen, ImagePlus, Plus, RefreshCw, Shirt, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  FieldLabel,
  IconButton,
  PanelText,
  PrimaryTextControlButton,
  SegmentedControl,
  Slider,
  TextControlButton,
  TextInput,
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
import type { BackgroundFit } from "../lib/background-preference";
import { builtInThemesByAppearance } from "../lib/themes";
import type { ThemeAppearance } from "../lib/themes";
import { useUserThemes } from "../lib/use-user-themes";
import { userThemeId } from "../lib/theme-contract";
import type { UserThemeEntry } from "../lib/user-themes";
import {
  BACKGROUND_ACCEPT,
  BACKGROUND_FIT_OPTIONS,
} from "../lib/background-image";
import { useBackground, type BackgroundControls } from "../lib/use-background";

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
  const background = useBackground();
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
    <DialogOverlay onDismiss={onClose}>
      <DialogSurface
        label="外观"
        // Wider than a list strictly needs, because the designer is the widest
        // thing in here: ten colour rows and their explanations. Still narrower
        // than the settings panel — this is one decision, not a page of them.
        className="h-[min(740px,84dvh,calc(100dvh-2rem))] w-[min(92vw,640px)]"
      >
        <DialogHeader
          actions={
            <>
              {message ? (
                <span className="max-w-48 truncate text-xs text-error">
                  {message}
                </span>
              ) : null}
              <TextControlButton
                onClick={draft ? () => setDraft(null) : onClose}
              >
                <X aria-hidden="true" />
                {draft ? "取消" : "关闭"}
              </TextControlButton>
              {draft ? (
                <PrimaryTextControlButton onClick={() => void save(draft)}>
                  保存并使用
                </PrimaryTextControlButton>
              ) : null}
            </>
          }
        >
          {draft ? "新建主题" : "外观"}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
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
                  <div key={groupLabel} className="min-w-0 space-y-2">
                    <FieldLabel>{groupLabel}</FieldLabel>
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

              <BackgroundSection background={background} />
            </>
          )}
        </div>
      </DialogSurface>
    </DialogOverlay>
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
      <label className="flex min-w-0 flex-col gap-1.5 sm:max-w-sm">
        <FieldLabel>名称</FieldLabel>
        <TextInput
          type="text"
          value={draft.name}
          onChange={(event) =>
            onChange({ ...draft, name: event.currentTarget.value })
          }
        />
        <PanelText tone="meta">
          {fileName === null
            ? "取个名字，它同时是文件名。"
            : `保存为 ~/.loam/themes/${fileName}`}
        </PanelText>
      </label>

      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>明暗</FieldLabel>
        <SegmentedControl
          value={draft.appearance}
          options={APPEARANCE_OPTIONS}
          onChange={(next) => onChange({ ...draft, appearance: next })}
        />
        <PanelText tone="meta">
          决定滚动条、表单控件、代码配色和 macOS 标题栏站在浅色还是深色一边。
        </PanelText>
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
              <span className="block text-[13px] leading-[1.6] text-base-content">
                {field.label}
              </span>
              <span className="line-clamp-2 text-[11.5px] leading-snug text-base-content/45">
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
    <div className="space-y-2 border-t border-[var(--mdx-separator)] pt-4">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>自定义主题</FieldLabel>
        <div className="flex items-center gap-1">
          <TextControlButton onClick={onCreate}>
            <Plus aria-hidden="true" />
            新建
          </TextControlButton>
          <TextControlButton onClick={onOpenDirectory}>
            <FolderOpen aria-hidden="true" />
            文件夹
          </TextControlButton>
          {/* Icon only, like every other refresh in the app: re-reading a list is
              never a decision, and it was a named action here and an icon two
              panels over. */}
          <IconButton
            label="刷新主题目录"
            icon={
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            }
            onClick={onRefresh}
            disabled={loading}
          />
        </div>
      </div>

      {directoryError ? (
        <PanelText tone="meta" className="text-warning">
          {`无法读取主题目录：${directoryError}`}
        </PanelText>
      ) : entries.length === 0 ? (
        <PanelText tone="meta">
          点「新建」从当前主题改一个出来，或把自己写的 .css 放进 ~/.loam/themes/
          后点刷新。
        </PanelText>
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
                className="flex items-start gap-2.5 px-2.5 py-2 text-[11.5px]"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-9 shrink-0 rounded-[3px] border border-dashed border-base-content/20"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-[1.6] text-base-content/60">
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

/**
 * A picture behind the document, and how strongly it shows.
 *
 * Below the themes rather than among them, because it is not a palette and
 * cannot be shared as one: `docs/loopx/specs/theme.md` keeps a theme unable to
 * load anything, so a background is a choice this machine makes on top of
 * whichever theme is in effect.
 *
 * The strength is offered as a slider rather than a set of presets because the
 * right value depends entirely on the picture — a paper texture is still legible
 * at 40%, a photograph of a city is not — and the only way to find it is to move
 * it and look at the document, which is what this does on every drag.
 */
function BackgroundSection({ background }: { background: BackgroundControls }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { setting, error, busy } = background;

  return (
    <div className="space-y-2 border-t border-[var(--mdx-separator)] pt-4">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>背景图</FieldLabel>
        <div className="flex items-center gap-1">
          <TextControlButton
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
            {setting ? "换一张" : "选择图片"}
          </TextControlButton>
          {setting ? (
            <TextControlButton
              disabled={busy}
              onClick={() => void background.remove()}
            >
              <Trash2 aria-hidden="true" />
              移除
            </TextControlButton>
          ) : null}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={BACKGROUND_ACCEPT}
        aria-label="选择背景图"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Cleared, so that choosing the same file twice is still a change the
          // input reports — which is what someone does after editing the image.
          event.currentTarget.value = "";

          if (file) {
            void background.choose(file);
          }
        }}
      />

      {error ? (
        <PanelText tone="meta" className="text-warning">
          {error}
        </PanelText>
      ) : null}

      {setting === null ? (
        <PanelText tone="meta">
          只铺在正文区，侧栏与标题栏保持主题底色。选中的图片会复制到
          ~/.loam/background/，之后移动或删除原图都不影响。
        </PanelText>
      ) : (
        <div className="space-y-3 pt-1">
          <label className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel>
              {`不透明度 ${String(Math.round(setting.opacity * 100))}%`}
            </FieldLabel>
            <Slider
              min={0}
              max={100}
              step={1}
              disabled={busy}
              value={Math.round(setting.opacity * 100)}
              onChange={(event) =>
                background.setOpacity(Number(event.currentTarget.value) / 100)
              }
            />
            <PanelText tone="meta">
              越低越淡。图片是往主题底色里淡出，正文的对比度不受影响，换深色主题时同一张图会自己变暗。
            </PanelText>
          </label>

          <div className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel>排列</FieldLabel>
            {/*
              * Two rows rather than a segmented control, because the two words
              * do not say what they do: "平铺" leaves open at what size it
              * repeats, which is the entire difference between the two. Drawn
              * in the same shape as the theme rows above — a diagram, a name and
              * a line about it — so this reads as part of the same list rather
              * than as a control bolted underneath one.
              */}
            <div className="grid gap-1 sm:grid-cols-2">
              {BACKGROUND_FIT_OPTIONS.map((option) => (
                <ThemeChoice
                  key={option.value}
                  selected={setting.fit === option.value}
                  disabled={busy}
                  name={option.label}
                  description={option.hint}
                  swatch={<BackgroundFitDiagram fit={option.value} />}
                  onSelect={() => background.setFit(option.value)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One selectable theme, as a row with its name, purpose and colors. */
function ThemeChoice({
  selected,
  disabled = false,
  name,
  description,
  swatch,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  name: string;
  description: string;
  swatch?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={[
        "flex w-full items-center gap-2.5 rounded-[var(--mdx-control-radius)] border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        selected
          ? "border-primary/45 bg-primary/8"
          : "border-transparent bg-[var(--mdx-card-bg)] hover:border-base-content/10",
      ].join(" ")}
    >
      {swatch ?? <span aria-hidden="true" className="h-5 w-9 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-base-content">
          {name}
        </span>
        {/*
         * Wrapped to two lines, not truncated: in a column half the width the
         * description is exactly the part that would be cut, and it is the
         * sentence saying why this theme exists rather than the one beside it.
         */}
        <span className="line-clamp-2 text-[11.5px] leading-relaxed text-base-content/45">
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
 * What each layout does to the picture, drawn.
 *
 * The same motif in both, at two scales, because that is the whole difference:
 * one copy blown up until it fills the frame — running past every edge, which is
 * what "裁掉" means — against the same copy at its own size, repeated with its
 * seams showing. Two words could not carry that; a picture of it can.
 *
 * Same footprint and same frame as `ThemeSwatch`, so the rows line up with the
 * theme rows above them.
 */
function BackgroundFitDiagram({ fit }: { fit: BackgroundFit }) {
  return (
    <span
      aria-hidden="true"
      className="h-5 w-9 shrink-0 overflow-hidden border border-base-content/15 bg-base-100 text-base-content"
    >
      <svg viewBox="0 0 36 20" className="h-full w-full" fill="currentColor">
        {fit === "cover"
          ? // One copy, blown up until it overruns every edge. Its mark is cut
            // off by the frame on two sides, which is the part of 铺满 people do
            // not expect: filling means cropping.
            motif(-8, -8, 48)
          : TILE_ORIGINS.map(([x, y]) =>
              motif(x, y, 7, `${String(x)}-${String(y)}`),
            )}
      </svg>
    </span>
  );
}

/**
 * Where each copy starts, at its own size and with a seam between.
 *
 * Deliberately running off all four edges rather than fitting a tidy grid
 * inside: what repeats does not stop at the pane, and both diagrams then say the
 * same thing about the frame — that it is a window onto something larger.
 */
const TILE_ORIGINS: ReadonlyArray<readonly [number, number]> = [-1, 8, 17]
  .flatMap((y) => [-2, 7, 16, 25, 34].map((x) => [x, y] as const));

/**
 * One copy of the picture, as a square with a mark in it.
 *
 * A plain square would read as a colour field rather than as an image, and the
 * tiled version would read as a grid. The mark is what makes eight of them read
 * as eight copies of the same thing.
 */
function motif(x: number, y: number, size: number, key?: string) {
  return (
    <g key={key}>
      <rect x={x} y={y} width={size} height={size} opacity="0.24" />
      <circle
        cx={x + size * 0.3}
        cy={y + size * 0.3}
        r={size * 0.2}
        opacity="0.6"
      />
    </g>
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
