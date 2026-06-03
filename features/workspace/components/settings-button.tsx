"use client";

import { useEffect, useState } from "react";
import {
  getLlmConfig,
  saveLlmConfig,
} from "@/features/llm-wiki/lib/llm-wiki-client";
import {
  useThemePreference,
  type ThemePreference,
} from "../lib/theme-preference";

interface SettingsButtonProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onLlmConfigSaved?: () => Promise<void> | void;
}

export function SettingsButton({
  open,
  onOpenChange,
  onLlmConfigSaved,
}: SettingsButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <>
      <button
        type="button"
        className="h-7 px-2 text-xs text-base-content/70 hover:bg-base-300"
        onClick={() => setOpen(true)}
      >
        设置
      </button>
      {actualOpen ? (
        <SettingsDialog
          onClose={() => setOpen(false)}
          onLlmConfigSaved={onLlmConfigSaved}
        />
      ) : null}
    </>
  );
}

function SettingsDialog({
  onClose,
  onLlmConfigSaved,
}: {
  onClose: () => void;
  onLlmConfigSaved?: () => Promise<void> | void;
}) {
  const { preference, setPreference } = useThemePreference();
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiKey, setApiKey] = useState("");
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const saveConfig = async () => {
    setSavingConfig(true);
    setMessage(null);

    try {
      const saved = await saveLlmConfig({
        baseUrl,
        model,
        apiKey,
        preserveApiKey: hasExistingApiKey && apiKey.trim() === "",
      });
      setHasExistingApiKey(saved.hasApiKey);
      setApiKey("");
      setBaseUrl(saved.baseUrl);
      setModel(saved.model);
      await onLlmConfigSaved?.();
      onClose();
    } catch (error) {
      setMessage(formatError(error, "保存 LLM 配置失败。"));
    } finally {
      setSavingConfig(false);
    }
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
        className="grid w-full max-w-2xl grid-cols-[150px_minmax(0,1fr)] overflow-hidden border border-base-300 bg-base-100 shadow-2xl"
      >
        <aside className="border-r border-base-300 bg-base-200 px-3 py-4">
          <h2 className="px-2 text-sm font-semibold">设置</h2>
          <div className="mt-4 space-y-1">
            <div className="bg-base-100 px-2 py-1.5 text-xs font-medium text-base-content">
              通用
            </div>
            <div className="px-2 py-1.5 text-xs text-base-content/55">LLM</div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="flex h-12 items-center justify-between border-b border-base-300 px-5">
            <div className="text-sm font-medium">通用设置</div>
            <button
              type="button"
              className="h-7 px-2 text-xs text-base-content/55 hover:bg-base-200 hover:text-base-content"
              onClick={onClose}
            >
              关闭
            </button>
          </header>

          <div className="space-y-7 px-5 py-5">
            <section className="grid grid-cols-[88px_minmax(0,1fr)] gap-4">
              <h3 className="pt-2 text-xs font-medium text-base-content/55">
                外观
              </h3>
              <div className="grid grid-cols-3 gap-1 bg-base-200 p-1">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={[
                      "h-8 text-xs",
                      preference === option.value
                        ? "bg-base-100 text-base-content shadow-sm"
                        : "text-base-content/60 hover:text-base-content",
                    ].join(" ")}
                    onClick={() => setPreference(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-[88px_minmax(0,1fr)] gap-4">
              <h3 className="pt-2 text-xs font-medium text-base-content/55">
                LLM API
              </h3>
              <div className="space-y-3">
                <label className="block space-y-1.5 text-xs text-base-content/55">
                  <span>Base URL</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-base-content/45"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.currentTarget.value)}
                    disabled={loadingConfig || savingConfig}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/55">
                  <span>Model</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-base-content/45"
                    value={model}
                    onChange={(event) => setModel(event.currentTarget.value)}
                    disabled={loadingConfig || savingConfig}
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-base-content/55">
                  <span>API Key</span>
                  <input
                    className="h-9 w-full border border-base-300 bg-base-100 px-2.5 text-sm text-base-content outline-none focus:border-base-content/45"
                    value={apiKey}
                    type="password"
                    placeholder={
                      hasExistingApiKey
                        ? "已配置，留空则保留"
                        : "请输入 API Key"
                    }
                    onChange={(event) => setApiKey(event.currentTarget.value)}
                    disabled={loadingConfig || savingConfig}
                  />
                </label>
                <div className="flex min-h-8 items-center justify-between gap-3 pt-1">
                  <div className="min-w-0 text-xs text-error">{message}</div>
                  <button
                    type="button"
                    className="h-8 shrink-0 bg-base-content px-3 text-xs text-base-100 disabled:bg-base-content/30"
                    onClick={() => void saveConfig()}
                    disabled={
                      loadingConfig ||
                      savingConfig ||
                      !baseUrl.trim() ||
                      !model.trim()
                    }
                  >
                    {savingConfig ? "保存中" : "保存配置"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback} ${error.message}`;
  }

  if (typeof error === "string" && error.length > 0) {
    return `${fallback} ${error}`;
  }

  return fallback;
}
