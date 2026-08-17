"use client";

import { RefreshCw, Save, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  detectLlmWikiWorkspace,
  getLlmWikiConfig,
  getLlmWikiLog,
  getLlmConfig,
  saveLlmConfig,
  updateLlmWikiConfig,
} from "@/features/llm-wiki/lib/llm-wiki-client";
import { MemorySettingsSection } from "@/features/memory/components/memory-settings-section";
import type {
  MemoryProviderOption,
  MemoryStorageBackend,
} from "@/features/memory/components/memory-settings-section";
import {
  dryRunMemoryStorageMigration,
  setMemoryConfig,
  runMemoryStorageMigration as applyMemoryStorageMigrationCommand,
  updateMemoryConfig,
} from "@/features/memory/lib/memory-client";
import type {
  MemoryConfig,
  MemoryStorageMigrationReport,
} from "@/features/memory/lib/types";
import type { LlmWikiKnowledgeConfig } from "@/features/llm-wiki/lib/types";
import type { LlmProviderApiMode } from "@/features/llm-wiki/lib/types";
import {
  PrimaryTextControlButton,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { AppPreferences } from "../lib/types";
import {
  SYSTEM_THEME_PREFERENCE,
  useThemePreference,
} from "../lib/theme-preference";
import { builtInThemesByAppearance } from "../lib/themes";
import { useUserThemes } from "../lib/use-user-themes";
import type { UserThemeEntry } from "../lib/user-themes";
import {
  appPreferencesEqual,
  createDefaultAppPreferences,
  parsePositiveIntegerSetting,
} from "../lib/preferences";

interface SettingsButtonProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  workspaceRoot?: string | null;
  preferences?: AppPreferences;
  onPreferencesChange?: (preferences: AppPreferences) => Promise<void>;
  onLlmConfigSaved?: () => Promise<void> | void;
}

export function SettingsButton({
  open,
  onOpenChange,
  workspaceRoot,
  preferences,
  onPreferencesChange,
  onLlmConfigSaved,
}: SettingsButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <>
      <TextControlButton onClick={() => setOpen(true)}>
        <Settings aria-hidden="true" />
        设置
      </TextControlButton>
      {actualOpen ? (
        <SettingsDialog
          onClose={() => setOpen(false)}
          workspaceRoot={workspaceRoot ?? null}
          preferences={preferences ?? createDefaultAppPreferences()}
          onPreferencesChange={onPreferencesChange}
          onLlmConfigSaved={onLlmConfigSaved}
        />
      ) : null}
    </>
  );
}

function SettingsDialog({
  onClose,
  workspaceRoot,
  preferences,
  onPreferencesChange,
  onLlmConfigSaved,
}: {
  onClose: () => void;
  workspaceRoot: string | null;
  preferences: AppPreferences;
  onPreferencesChange?: (preferences: AppPreferences) => Promise<void>;
  onLlmConfigSaved?: () => Promise<void> | void;
}) {
  const { preference, setPreference } = useThemePreference();
  const themeGroups = useMemo(builtInThemesByAppearance, []);
  const userThemes = useUserThemes();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<SettingsSection, HTMLElement | null>>({
    general: null,
    search: null,
    files: null,
    memory: null,
    llm: null,
  });
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiMode, setApiMode] = useState<LlmProviderApiMode>("chat");
  const [apiKey, setApiKey] = useState("");
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingMemorySettings, setSavingMemorySettings] = useState(false);
  const [memoryConfig, setMemoryConfigState] = useState<MemoryConfig | null>(
    null,
  );
  const [postgresTargetText, setPostgresTargetText] = useState("");
  const [migrationReport, setMigrationReport] =
    useState<MemoryStorageMigrationReport | null>(null);
  const [migratingMemoryStorage, setMigratingMemoryStorage] = useState(false);
  const [applyingMemoryMigration, setApplyingMemoryMigration] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fileWatchEnabled, setFileWatchEnabled] = useState(
    preferences.fileWatchEnabled,
  );
  const [searchMaxFileBytesText, setSearchMaxFileBytesText] = useState(
    String(preferences.searchMaxFileBytes),
  );
  const [searchMaxResultsText, setSearchMaxResultsText] = useState(
    String(preferences.searchMaxResults),
  );
  const [searchMaxMatchesPerFileText, setSearchMaxMatchesPerFileText] =
    useState(String(preferences.searchMaxMatchesPerFile));
  const [excludeDirsText, setExcludeDirsText] = useState(
    preferences.fileTreeExcludeDirs.join("\n"),
  );
  const [llmWikiConfig, setLlmWikiConfig] =
    useState<LlmWikiKnowledgeConfig | null>(null);
  const [llmWikiLog, setLlmWikiLog] = useState("");
  const [loadingLlmWiki, setLoadingLlmWiki] = useState(false);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMessage(null);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingConfig(true);
      setMessage(null);

      try {
        const config = await getLlmConfig();

        if (cancelled) {
          return;
        }

        if (config) {
          setBaseUrl(config.baseUrl);
          setModel(config.model);
          setApiMode(config.apiMode);
          setHasExistingApiKey(config.hasApiKey);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(formatError(error, "加载 LLM 配置失败。"));
        }
      } finally {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setFileWatchEnabled(preferences.fileWatchEnabled);
    setSearchMaxFileBytesText(String(preferences.searchMaxFileBytes));
    setSearchMaxResultsText(String(preferences.searchMaxResults));
    setSearchMaxMatchesPerFileText(
      String(preferences.searchMaxMatchesPerFile),
    );
    setExcludeDirsText(preferences.fileTreeExcludeDirs.join("\n"));
  }, [preferences]);

  useEffect(() => {
    if (!workspaceRoot) {
      setLlmWikiConfig(null);
      setLlmWikiLog("");
      return;
    }

    let cancelled = false;

    async function loadLlmWikiSettings() {
      setLoadingLlmWiki(true);

      try {
        const status = await detectLlmWikiWorkspace(workspaceRoot as string);

        if (!status.hasLlmWiki) {
          if (!cancelled) {
            setLlmWikiConfig(null);
            setLlmWikiLog("");
          }
          return;
        }

        const [config, log] = await Promise.all([
          getLlmWikiConfig(workspaceRoot as string),
          getLlmWikiLog(workspaceRoot as string),
        ]);

        if (!cancelled) {
          setLlmWikiConfig(config);
          setLlmWikiLog(log);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(formatError(error, "加载 LLM Wiki 设置失败。"));
        }
      } finally {
        if (!cancelled) {
          setLoadingLlmWiki(false);
        }
      }
    }

    void loadLlmWikiSettings();

    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  const saveSettings = async () => {
    setSavingSettings(true);
    setMessage(null);

    try {
      const nextExcludeDirs = parseExcludeDirs(excludeDirsText);
      const nextPreferences = {
        fileTreeExcludeDirs: nextExcludeDirs,
        fileWatchEnabled,
        searchMaxFileBytes: parsePositiveIntegerSetting(
          searchMaxFileBytesText,
          1_024,
          50 * 1_024 * 1_024,
          preferences.searchMaxFileBytes,
        ),
        searchMaxResults: parsePositiveIntegerSetting(
          searchMaxResultsText,
          1,
          5_000,
          preferences.searchMaxResults,
        ),
        searchMaxMatchesPerFile: parsePositiveIntegerSetting(
          searchMaxMatchesPerFileText,
          1,
          500,
          preferences.searchMaxMatchesPerFile,
        ),
      };

      if (!appPreferencesEqual(nextPreferences, preferences)) {
        await onPreferencesChange?.(nextPreferences);
      }

      const saved = await saveLlmConfig({
        baseUrl,
        model,
        apiMode,
        apiKey,
        preserveApiKey: hasExistingApiKey && apiKey.trim() === "",
      });
      setHasExistingApiKey(saved.hasApiKey);
      setApiKey("");
      setBaseUrl(saved.baseUrl);
      setModel(saved.model);
      setApiMode(saved.apiMode);
      await onLlmConfigSaved?.();
      onClose();
    } catch (error) {
      setMessage(formatError(error, "保存设置失败。"));
    } finally {
      setSavingSettings(false);
    }
  };
  const toggleLlmWiki = async () => {
    if (!workspaceRoot || !llmWikiConfig) {
      return;
    }

    setLoadingLlmWiki(true);
    setMessage(null);

    try {
      const nextConfig = await updateLlmWikiConfig(workspaceRoot, {
        paused: !llmWikiConfig.paused,
        skipPaths: llmWikiConfig.skipPaths,
      });
      setLlmWikiConfig(nextConfig);
      await onLlmConfigSaved?.();
    } catch (error) {
      setMessage(formatError(error, "保存 LLM Wiki 开关失败。"));
    } finally {
      setLoadingLlmWiki(false);
    }
  };
  const refreshLlmWikiLog = async () => {
    if (!workspaceRoot) {
      return;
    }

    setLoadingLlmWiki(true);
    setMessage(null);

    try {
      setLlmWikiLog(await getLlmWikiLog(workspaceRoot));
    } catch (error) {
      setMessage(formatError(error, "刷新 LLM Wiki 日志失败。"));
    } finally {
      setLoadingLlmWiki(false);
    }
  };
  const toggleMemoryConfig = async (key: string, enabled: boolean) => {
    if (!workspaceRoot) {
      setMessage("打开工作区后可以修改 Memory 设置。");
      return;
    }

    setSavingMemorySettings(true);
    setMessage(null);

    try {
      await setMemoryConfig(workspaceRoot, {
        scope: "workspace",
        key,
        enabled,
      });
      const nextConfig = await setMemoryConfig(workspaceRoot, {
        scope: "workspace",
        key,
        enabled,
      });
      setMemoryConfigState(nextConfig);
      setMessage("Memory 设置已保存。");
    } catch (error) {
      setMessage(formatError(error, "保存 Memory 设置失败。"));
    } finally {
      setSavingMemorySettings(false);
    }
  };
  const updateMemoryProvider = async (provider: MemoryProviderOption) => {
    if (!workspaceRoot) {
      setMessage("打开工作区后可以修改 Memory 设置。");
      return;
    }

    setSavingMemorySettings(true);
    setMessage(null);

    try {
      const nextConfig = await updateMemoryConfig(workspaceRoot, {
        scope: "workspace",
        provider:
          provider === "reuse_llm"
            ? { mode: "reuse_llm", provider: null }
            : { mode: "provider", provider },
      });
      setMemoryConfigState(nextConfig);
      setMessage("Memory Provider 已保存。");
    } catch (error) {
      setMessage(formatError(error, "保存 Memory Provider 失败。"));
    } finally {
      setSavingMemorySettings(false);
    }
  };
  const updateMemoryStorageBackend = async (backend: MemoryStorageBackend) => {
    if (!workspaceRoot) {
      setMessage("打开工作区后可以修改 Memory 设置。");
      return;
    }

    setSavingMemorySettings(true);
    setMessage(null);
    setMigrationReport(null);

    try {
      const nextConfig = await updateMemoryConfig(workspaceRoot, {
        scope: "workspace",
        storage: { backend },
      });
      setMemoryConfigState(nextConfig);
      setPostgresTargetText(nextConfig.storage.postgres_url_ref ?? "");
      setMessage("Memory 存储设置已保存。");
    } catch (error) {
      setMessage(formatError(error, "保存 Memory 存储设置失败。"));
    } finally {
      setSavingMemorySettings(false);
    }
  };
  const updatePostgresTarget = (target: string) => {
    setPostgresTargetText(target);
    setMigrationReport(null);
  };
  const persistPostgresTarget = async () => {
    if (!workspaceRoot) {
      setMessage("打开工作区后可以修改 Memory 设置。");
      return;
    }

    try {
      const nextConfig = await updateMemoryConfig(workspaceRoot, {
        scope: "workspace",
        storage: {
          backend: "postgresql",
          postgres_url_ref: postgresTargetText,
        },
      });
      setMemoryConfigState(nextConfig);
      setPostgresTargetText(nextConfig.storage.postgres_url_ref ?? "");
      setMigrationReport(null);
    } catch (error) {
      setMessage(formatError(error, "保存 PostgreSQL URL 失败。"));
    }
  };
  const runMemoryStorageMigrationDryRun = async () => {
    if (!workspaceRoot) {
      setMessage("打开工作区后可以修改 Memory 设置。");
      return;
    }

    await persistPostgresTarget();
    const target = postgresTargetText.trim();
    if (!target) {
      setMessage("请先填写 PostgreSQL URL。");
      return;
    }

    setMigratingMemoryStorage(true);
    setMessage(null);

    try {
      const report = await dryRunMemoryStorageMigration(workspaceRoot, {
        from: "sqlite",
        to: "postgresql",
        target,
        dry_run: true,
        resume: false,
      });
      setMigrationReport(report);
      setMessage(
        report.validation_errors.length === 0
          ? "Memory 迁移预检通过。"
          : "Memory 迁移预检有问题。",
      );
    } catch (error) {
      setMessage(formatError(error, "Memory 迁移预检失败。"));
    } finally {
      setMigratingMemoryStorage(false);
    }
  };
  const applyMemoryStorageMigration = async () => {
    if (!workspaceRoot) {
      setMessage("打开工作区后可以修改 Memory 设置。");
      return;
    }

    const target = postgresTargetText.trim();
    if (!target) {
      setMessage("请先填写 PostgreSQL URL。");
      return;
    }
    if (!migrationReport || migrationReport.validation_errors.length > 0) {
      setMessage("请先通过迁移预检。");
      return;
    }

    setApplyingMemoryMigration(true);
    setMessage(null);

    try {
      const report = await applyMemoryStorageMigrationCommand(workspaceRoot, {
        from: "sqlite",
        to: "postgresql",
        target,
        dry_run: false,
        resume: false,
      });
      setMigrationReport(report);
      setMessage("Memory 迁移已完成。");
    } catch (error) {
      setMessage(formatError(error, "Memory 迁移失败。"));
    } finally {
      setApplyingMemoryMigration(false);
    }
  };
  const selectSection = (section: SettingsSection) => {
    setActiveSection(section);
    const container = contentScrollRef.current;
    const target = sectionRefs.current[section];

    if (!container || !target) {
      return;
    }

    container.scrollTo({
      top: target.offsetTop - container.offsetTop,
      behavior: "smooth",
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 py-14 backdrop-blur-sm"
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
        aria-label="设置"
        className="grid h-[min(680px,78dvh,calc(100dvh-2rem))] min-h-0 w-[min(90vw,840px)] min-w-0 grid-cols-[minmax(104px,152px)_minmax(0,1fr)] overflow-hidden border border-base-300 bg-base-100 shadow-2xl"
      >
        <aside className="min-h-0 min-w-0 overflow-auto border-r border-base-300 bg-base-200 px-3 py-4">
          <h2 className="px-2 text-sm font-semibold">设置</h2>
          <div className="mt-4 space-y-1">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={[
                  "block w-full px-2 py-1.5 text-left text-xs",
                  activeSection === section.id
                    ? "bg-base-100 font-medium text-base-content"
                    : "text-base-content/70 hover:bg-base-100/70 hover:text-base-content",
                ].join(" ")}
                onClick={() => selectSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 min-h-0 flex-col">
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-base-300 px-5 py-3">
            <div className="min-w-0 text-sm font-medium">设置</div>
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {message ? (
                <div className="max-w-64 truncate text-xs text-error">
                  {message}
                </div>
              ) : null}
              <TextControlButton onClick={onClose}>
                <X aria-hidden="true" />
                关闭
              </TextControlButton>
              <PrimaryTextControlButton
                onClick={() => void saveSettings()}
                disabled={
                  loadingConfig ||
                  savingSettings ||
                  !baseUrl.trim() ||
                  !model.trim()
                }
              >
                <Save aria-hidden="true" />
                {savingSettings ? "保存中" : "保存"}
              </PrimaryTextControlButton>
            </div>
          </header>

          <div
            ref={contentScrollRef}
            data-settings-scroll-container
            className="min-h-0 flex-1 space-y-7 overflow-y-auto overflow-x-hidden px-[clamp(16px,3vw,28px)] py-5"
          >
            <section
              ref={(node) => {
                sectionRefs.current.general = node;
              }}
              data-settings-section="general"
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                外观
              </h3>
              <div className="space-y-3">
                <ThemeChoice
                  selected={preference === SYSTEM_THEME_PREFERENCE}
                  name="跟随系统"
                  description="随 macOS 的浅色与深色外观自动切换。"
                  onSelect={() => setPreference(SYSTEM_THEME_PREFERENCE)}
                />

                {(
                  [
                    ["浅色主题", themeGroups.light],
                    ["深色主题", themeGroups.dark],
                  ] as const
                ).map(([groupLabel, themes]) => (
                  <div key={groupLabel} className="space-y-1.5">
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

                <UserThemeSection
                  entries={userThemes.entries}
                  directoryError={userThemes.directoryError}
                  loading={userThemes.loading}
                  selected={preference}
                  onSelect={setPreference}
                  onRefresh={() => void userThemes.refresh()}
                />
              </div>
            </section>

            <section
              ref={(node) => {
                sectionRefs.current.search = node;
              }}
              data-settings-section="search"
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                搜索限制
              </h3>
              <div className="space-y-3">
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>单文件最大搜索大小（字节）</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={searchMaxFileBytesText}
                    inputMode="numeric"
                    onChange={(event) =>
                      setSearchMaxFileBytesText(event.currentTarget.value)
                    }
                    disabled={savingSettings}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>最大结果数</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={searchMaxResultsText}
                    inputMode="numeric"
                    onChange={(event) =>
                      setSearchMaxResultsText(event.currentTarget.value)
                    }
                    disabled={savingSettings}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>每个文件最大匹配数</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={searchMaxMatchesPerFileText}
                    inputMode="numeric"
                    onChange={(event) =>
                      setSearchMaxMatchesPerFileText(event.currentTarget.value)
                    }
                    disabled={savingSettings}
                  />
                </label>
              </div>
            </section>

            <section
              ref={(node) => {
                sectionRefs.current.files = node;
              }}
              data-settings-section="files"
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                文件监听
              </h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 text-sm text-base-content">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-base-300 bg-base-100"
                    checked={fileWatchEnabled}
                    onChange={(event) =>
                      setFileWatchEnabled(event.currentTarget.checked)
                    }
                    disabled={savingSettings}
                  />
                  <span>启用工作区文件监听</span>
                </label>
                <p className="text-xs leading-relaxed text-base-content/65">
                  未保存正文会以明文草稿保存在 ~/.mdx/drafts/，保存或丢弃后会清理对应草稿。
                </p>
                <div className="border-t border-base-300 pt-3">
                  <div className="mb-2 text-xs text-base-content/70">
                    过滤项目
                  </div>
                  <textarea
                    className="min-h-24 w-full resize-y border border-base-300 bg-base-100 px-2.5 py-2 text-sm text-base-content outline-none placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={excludeDirsText}
                    onChange={(event) =>
                      setExcludeDirsText(event.currentTarget.value)
                    }
                    placeholder={"每行一个目录，例如：\nnode_modules\ndist\nraw/archive"}
                    disabled={savingSettings}
                  />
                </div>
              </div>
            </section>

            <MemorySettingsSection
              sectionRef={(node) => {
                sectionRefs.current.memory = node;
              }}
              disabled={!workspaceRoot || savingMemorySettings}
              config={memoryConfig}
              postgresTarget={postgresTargetText}
              migrationReport={migrationReport}
              checkingMigration={migratingMemoryStorage}
              applyingMigration={applyingMemoryMigration}
              onToggle={(key, enabled) => {
                void toggleMemoryConfig(key, enabled);
              }}
              onProviderChange={(provider) => {
                void updateMemoryProvider(provider);
              }}
              onStorageBackendChange={(backend) => {
                void updateMemoryStorageBackend(backend);
              }}
              onPostgresTargetChange={(target) => {
                updatePostgresTarget(target);
              }}
              onPostgresTargetBlur={() => {
                void persistPostgresTarget();
              }}
              onMigrationDryRun={() => {
                void runMemoryStorageMigrationDryRun();
              }}
              onMigrationApply={() => {
                void applyMemoryStorageMigration();
              }}
            />

            <section
              ref={(node) => {
                sectionRefs.current.llm = node;
              }}
              data-settings-section="llm"
              className="scroll-mt-5 grid grid-cols-[clamp(64px,12vw,96px)_minmax(0,1fr)] gap-x-5 gap-y-2"
            >
              <h3 className="pt-2 text-xs font-medium text-base-content/70">
                LLM API
              </h3>
              <div className="space-y-3">
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>Base URL</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>Model</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={model}
                    onChange={(event) => setModel(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <div className="space-y-1.5 text-xs text-base-content/70">
                  <span>API 模式</span>
                  <div className="grid grid-cols-2 gap-1 bg-base-200 p-1">
                    {LLM_API_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={[
                          "h-8 text-xs",
                          apiMode === option.value
                            ? "bg-base-100 text-base-content shadow-sm"
                            : "text-base-content/60 hover:text-base-content",
                        ].join(" ")}
                        onClick={() => setApiMode(option.value)}
                        disabled={loadingConfig || savingSettings}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block space-y-1.5 text-xs text-base-content/70">
                  <span>API Key</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none placeholder:text-base-content/65 focus:border-primary focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-primary"
                    value={apiKey}
                    type="password"
                    placeholder={
                      hasExistingApiKey
                        ? "已配置，留空则保留"
                        : "请输入 API Key"
                    }
                    onChange={(event) => setApiKey(event.currentTarget.value)}
                    disabled={loadingConfig || savingSettings}
                  />
                </label>
                <div className="border-t border-base-300 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-base-content/70">
                      LLM Wiki 后台处理
                    </div>
                    <TextControlButton
                      className="h-8 bg-base-content px-3 text-base-100 hover:bg-base-content/85 hover:text-base-100 disabled:bg-base-content/30 disabled:hover:bg-base-content/30"
                      onClick={() => void toggleLlmWiki()}
                      disabled={!workspaceRoot || !llmWikiConfig || loadingLlmWiki}
                    >
                      {llmWikiConfig?.paused ? "启用" : "暂停"}
                    </TextControlButton>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-base-content/70">日志</div>
                    <TextControlButton
                      onClick={() => void refreshLlmWikiLog()}
                      disabled={!workspaceRoot || loadingLlmWiki}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={loadingLlmWiki ? "animate-spin" : undefined}
                      />
                      刷新
                    </TextControlButton>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border border-base-300 bg-base-200 p-2 font-sans text-xs leading-relaxed text-base-content/75">
                    {workspaceRoot
                      ? llmWikiLog || "暂无日志"
                      : "打开工作区后显示 LLM Wiki 日志"}
                  </pre>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
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
}: {
  entries: UserThemeEntry[];
  directoryError: string | null;
  loading: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-1.5 border-t border-[var(--mdx-separator)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-base-content/45">自定义主题</p>
        <button
          type="button"
          className="h-5 rounded-[5px] px-1.5 text-[11px] text-base-content/55 outline-none transition-colors hover:bg-base-content/6 hover:text-base-content/80 focus-visible:ring-2 focus-visible:ring-primary/25"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>

      {directoryError ? (
        <p className="px-2.5 text-[11px] leading-relaxed text-warning">
          {`无法读取主题目录：${directoryError}`}
        </p>
      ) : entries.length === 0 ? (
        <p className="px-2.5 text-[11px] leading-relaxed text-base-content/45">
          把 .css 文件放进 ~/.mdx/themes/ 后点刷新。文件里用
          <code className="px-1">--mdx-theme-*</code>
          变量声明颜色，至少要有
          <code className="px-1">--mdx-theme-appearance: light</code>
          或 dark。
        </p>
      ) : (
        <div className="space-y-1">
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
        <span className="block text-xs text-base-content">{name}</span>
        <span className="block truncate text-[11px] text-base-content/50">
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

const LLM_API_MODE_OPTIONS: Array<{
  value: LlmProviderApiMode;
  label: string;
}> = [
  { value: "chat", label: "Chat" },
  { value: "responses", label: "Responses" },
];

type SettingsSection = "general" | "search" | "files" | "memory" | "llm";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "通用" },
  { id: "search", label: "搜索" },
  { id: "files", label: "文件" },
  { id: "memory", label: "Memory" },
  { id: "llm", label: "LLM" },
];

function parseExcludeDirs(text: string) {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.replaceAll("\\", "/").trim())
        .map((line) => line.replace(/^\/+|\/+$/g, ""))
        .filter((line) => line.length > 0)
        .filter(
          (line) =>
            !line
              .split("/")
              .some((part) => part === "." || part === ".."),
        ),
    ),
  );
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback} ${error.message}`;
  }

  if (typeof error === "string" && error.length > 0) {
    return `${fallback} ${error}`;
  }

  if (error && typeof error === "object") {
    if (
      "message" in error &&
      typeof error.message === "string" &&
      error.message.length > 0
    ) {
      return `${fallback} ${error.message}`;
    }

    if (
      "error" in error &&
      typeof error.error === "string" &&
      error.error.length > 0
    ) {
      return `${fallback} ${error.error}`;
    }

    try {
      return `${fallback} ${JSON.stringify(error)}`;
    } catch {
      return `${fallback} ${String(error)}`;
    }
  }

  return fallback;
}
