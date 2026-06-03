"use client";

import { type FormEvent, useCallback, useState } from "react";
import type { LlmWikiWorkspaceHook } from "../hooks/use-llm-wiki-workspace";

interface LlmWikiPanelProps {
  llmWiki: LlmWikiWorkspaceHook;
  onConfigureLlm?: () => void;
}

export function LlmWikiPanel({ llmWiki, onConfigureLlm }: LlmWikiPanelProps) {
  const {
    status,
    viewModel,
    message,
    queryAnswer,
    isReady,
    isLoading,
    isQuerying,
    initialize,
    rescan,
    lint,
    graph,
    digest,
    query,
    refresh,
  } = llmWiki;
  const [question, setQuestion] = useState("");
  const [digestTitle, setDigestTitle] = useState("");
  const [digestPrompt, setDigestPrompt] = useState("");
  const handlePrimaryAction = useCallback(() => {
    if (viewModel.primaryAction === "配置 LLM") {
      onConfigureLlm?.();
      return;
    }

    if (status?.mode === "ordinary") {
      void initialize();
      return;
    }

    void rescan();
  }, [
    initialize,
    onConfigureLlm,
    rescan,
    status?.mode,
    viewModel.primaryAction,
  ]);

  const handleConfigure = useCallback(() => {
    onConfigureLlm?.();
  }, [onConfigureLlm]);

  const handleQuerySubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void query(question);
    },
    [query, question],
  );

  const handleDigestSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void digest(digestTitle, digestPrompt);
    },
    [digest, digestPrompt, digestTitle],
  );

  const panelMessage = message;
  const actionsDisabled = !isReady || isLoading;
  const queryDisabled =
    actionsDisabled ||
    status?.mode !== "llmWiki" ||
    isQuerying ||
    question.trim().length === 0;
  const digestDisabled =
    actionsDisabled ||
    status?.mode !== "llmWiki" ||
    digestTitle.trim().length === 0 ||
    digestPrompt.trim().length === 0;

  return (
    <section className="min-h-0 border-t border-base-300 bg-base-100">
      <div className="flex h-10 min-w-0 items-center justify-between border-b border-base-300 px-3">
        <div className="min-w-0 truncate text-xs font-semibold uppercase text-base-content/60">
          LLM Wiki
        </div>
        <button
          type="button"
          className="h-7 px-2 text-xs text-base-content/65 hover:bg-base-200"
          onClick={() => void refresh()}
          disabled={isLoading}
          title="刷新状态"
        >
          {isLoading ? "加载" : "刷新"}
        </button>
      </div>

      <div className="space-y-3 overflow-auto p-3 text-xs">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-base-content">
            {viewModel.title}
          </div>
          <div className="mt-2 space-y-1 text-base-content/65">
            {viewModel.statusLines.map((line) => (
              <div key={line} className="truncate" title={line}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm min-h-8 h-8 text-xs"
            disabled={actionsDisabled}
            onClick={
              viewModel.primaryAction === "配置 LLM"
                ? handleConfigure
                : handlePrimaryAction
            }
          >
            <span className="truncate">{viewModel.primaryAction}</span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-sm min-h-8 h-8 text-xs"
              disabled={actionsDisabled}
              onClick={() => void lint()}
            >
              Lint
            </button>
            <button
              type="button"
              className="btn btn-sm min-h-8 h-8 text-xs"
              disabled={actionsDisabled}
              onClick={() => void graph()}
            >
              图谱
            </button>
          </div>
        </div>

        <form className="space-y-2" onSubmit={handleQuerySubmit}>
          <textarea
            className="textarea textarea-bordered min-h-20 w-full resize-y text-xs leading-relaxed"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={actionsDisabled || status?.mode !== "llmWiki"}
            placeholder="询问当前 Wiki"
            rows={3}
          />
          <button
            type="submit"
            className="btn btn-sm min-h-8 h-8 w-full text-xs"
            disabled={queryDisabled}
          >
            {isQuerying ? "查询中" : "查询 Wiki"}
          </button>
        </form>

        <form className="space-y-2" onSubmit={handleDigestSubmit}>
          <input
            className="input input-bordered h-8 min-h-8 w-full text-xs"
            value={digestTitle}
            onChange={(event) => setDigestTitle(event.target.value)}
            disabled={actionsDisabled || status?.mode !== "llmWiki"}
            placeholder="Digest slug，例如 project-summary"
          />
          <textarea
            className="textarea textarea-bordered min-h-16 w-full resize-y text-xs leading-relaxed"
            value={digestPrompt}
            onChange={(event) => setDigestPrompt(event.target.value)}
            disabled={actionsDisabled || status?.mode !== "llmWiki"}
            placeholder="生成 synthesis 的问题或主题"
            rows={2}
          />
          <button
            type="submit"
            className="btn btn-sm min-h-8 h-8 w-full text-xs"
            disabled={digestDisabled}
          >
            生成 Digest
          </button>
        </form>

        {queryAnswer ? (
          <div className="space-y-2 rounded border border-base-300 p-2">
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-base-content/80">
              {queryAnswer.answer}
            </div>
            {queryAnswer.references.length > 0 ? (
              <div className="space-y-1 border-t border-base-300 pt-2 text-base-content/60">
                {queryAnswer.references.map((reference) => (
                  <div
                    key={reference.path}
                    className="min-w-0"
                    title={`${reference.title}\n${reference.path}`}
                  >
                    <div className="truncate font-medium text-base-content/70">
                      {reference.title || reference.path}
                    </div>
                    <div className="truncate">{reference.snippet}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {panelMessage ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-base-300 bg-base-200 p-2 font-sans text-xs leading-relaxed text-base-content/75">
            {panelMessage}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
