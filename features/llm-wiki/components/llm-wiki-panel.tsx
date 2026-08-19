"use client";

import { RefreshCw } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import {
  EmptyState,
  PanelScroll,
  PanelViewport,
  HairlineItem,
  IconButton,
  LogBlock,
  PanelSection,
  PanelStrip,
  PanelText,
  PrimaryTextControlButton,
  StatList,
  TextArea,
  TextInput,
  TextControlButton,
} from "../../../common/components/ui-controls";
import type { LlmWikiWorkspaceHook } from "../hooks/use-llm-wiki-workspace";

interface LlmWikiPanelProps {
  llmWiki: LlmWikiWorkspaceHook;
  onConfigureLlm?: () => void;
}

const MAX_PROGRESS_MESSAGE_CHARS = 4000;
const MAX_PROGRESS_MESSAGE_LINES = 80;

function formatPanelProgressMessage(message: string) {
  const lines = message.split("\n");
  const lineLimited = lines.length > MAX_PROGRESS_MESSAGE_LINES;
  let preview = (lineLimited
    ? lines.slice(0, MAX_PROGRESS_MESSAGE_LINES)
    : lines
  ).join("\n");
  const charLimited = preview.length > MAX_PROGRESS_MESSAGE_CHARS;

  if (charLimited) {
    preview = preview.slice(0, MAX_PROGRESS_MESSAGE_CHARS).trimEnd();
  }

  if (!lineLimited && !charLimited) {
    return message;
  }

  return [
    preview,
    "",
    `... 已截断，完整进度共 ${lines.length} 行、${message.length} 个字符。`,
  ].join("\n");
}

/** What each section is for, in words the heading alone does not carry. */
const ASK_HINT = "按当前 wiki 的内容回答，并列出它引用到的页面。";
const DIGEST_HINT = "把一个主题写成一篇综述，存成 wiki 里的一页 Markdown。";
const NEEDS_LLM = "需要先配置 LLM";

/** What the two secondary actions do, in words that say what pressing them means. */
const SECONDARY_ACTION_TITLES: Record<string, string> = {
  lint: "检查 wiki 一致性",
  graph: "重建知识图谱页",
};

const SECONDARY_ACTION_HINTS: Record<string, string> = {
  lint: "扫描 wiki 与 raw，把断链、缺失和重复写进报告。文件多时要跑一会儿。",
  graph: "按当前 wiki 重新生成图谱 Markdown 页。",
};

export function LlmWikiPanel({ llmWiki, onConfigureLlm }: LlmWikiPanelProps) {
  const {
    status,
    viewModel,
    message,
    queryAnswer,
    isReady,
    isLoading,
    isQuerying,
    isProcessing,
    activeOperation,
    activeOperationId,
    activeOperationLabel,
    progress,
    activeStageLabel,
    cancelActiveOperation,
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

  const panelMessage = message ? formatPanelProgressMessage(message) : null;
  const actionsDisabled = !isReady || isLoading || isProcessing;
  const queryActionsDisabled =
    !isReady ||
    isLoading ||
    (isProcessing && activeOperation !== "ingest");
  const primaryActionLabel = activeOperationLabel ?? viewModel.primaryAction;
  const emptyStateActionLabel =
    viewModel.emptyState?.actionLabel === "初始化 LLM Wiki" &&
    activeOperation === "initialize"
      ? (activeOperationLabel ?? viewModel.emptyState.actionLabel)
      : viewModel.emptyState?.actionLabel;
  const askMode = viewModel.modes.find((mode) => mode.id === "ask");
  const digestMode = viewModel.modes.find((mode) => mode.id === "digest");
  // The sections are always shown, so what used to disable a tab now explains
  // itself in place.
  const askDisabledHint = askMode?.disabled ? "需要先配置 LLM" : null;
  const digestDisabledHint = digestMode?.disabled ? "需要先配置 LLM" : null;
  const queryDisabled =
    queryActionsDisabled ||
    status?.mode !== "llmWiki" ||
    isQuerying ||
    question.trim().length === 0;
  /**
   * Nothing to show two columns of yet: this workspace has no wiki at all, so the
   * page is the one action that creates it.
   */
  const uninitialised = status?.mode === "ordinary";
  const digestDisabled =
    actionsDisabled ||
    status?.mode !== "llmWiki" ||
    digestTitle.trim().length === 0 ||
    digestPrompt.trim().length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col bg-base-100">
      {/*
       * What is happening right now, on one line under the chrome — the same strip
       * the memory panel keeps, for the same reason: it is the fact that decides
       * whether anything below it means anything yet.
       */}
      {progress || activeOperation ? (
        <PanelStrip>
          {progress ? (
            <StatList
              singleLine
              items={[
                {
                  label: "正在处理",
                  value: `${progress.index}/${progress.total}`,
                },
                { label: "已完成", value: progress.completed },
                { label: "已失败", value: progress.failed },
                { label: "已等待", value: `${progress.elapsedSeconds} 秒` },
                {
                  label: "当前",
                  value: progress.file,
                  title: progress.file,
                },
              ]}
            />
          ) : (
            <StatList
              items={[
                {
                  label: "状态",
                  value:
                    activeStageLabel ?? activeOperationLabel ?? "处理中",
                },
              ]}
            />
          )}
          {/*
           * Always rendered while the strip is up, disabled when there is nothing to
           * cancel. The ingest loop clears `activeOperation` in its per-file
           * `finally` and sets it again on the next file, so a conditional button
           * unmounted and remounted once per file — the strip changing width each
           * time, which is what flickered.
           */}
          <TextControlButton
            className="shrink-0"
            disabled={!activeOperationId}
            onClick={() => void cancelActiveOperation()}
          >
            取消
          </TextControlButton>
        </PanelStrip>
      ) : null}

      {/*
       * Two columns: what the machine is doing, and what you are asking of it. The
       * same shape as 素材与结论, for the same reason — the two halves are read
       * together, and stacked in one column the answer to a question sat below a
       * screenful of queue counts. One column under a narrow window, where two of
       * 300px are worse than one of 600.
       */}
      {uninitialised ? (
        <PanelScroll>
          {/* Same optical centre as the memory panel's ask page. */}
          <div className="flex min-h-full min-w-0 items-center justify-center px-6 pb-[16vh] pt-10">
            <div className="w-full max-w-xl min-w-0">
              <EmptyState
                title={viewModel.emptyState?.title ?? "初始化 LLM Wiki"}
                description={
                  viewModel.emptyState?.description ??
                  "创建 Wiki 目录后，可以用当前工作区内容提问或生成综述。"
                }
                actionLabel={emptyStateActionLabel}
                onAction={
                  viewModel.emptyState?.actionLabel === "配置 LLM"
                    ? handleConfigure
                    : handlePrimaryAction
                }
                actionDisabled={actionsDisabled}
              />
            </div>
          </div>
        </PanelScroll>
      ) : (
        <PanelViewport>
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <section className="flex min-h-0 min-w-0 flex-col overflow-auto lg:border-r lg:border-[var(--mdx-separator)]">
              <PanelSection
                title={viewModel.title}
                hint="raw 里的文件由后台逐个读成 wiki 页；下面的计数是那一轮的进度。"
                actions={
                  <>
                    <PrimaryTextControlButton
                      disabled={actionsDisabled}
                      onClick={handlePrimaryAction}
                    >
                      {primaryActionLabel}
                    </PrimaryTextControlButton>
                    <IconButton
                      label="刷新状态"
                      icon={
                        <RefreshCw
                          className={isLoading ? "animate-spin" : undefined}
                        />
                      }
                      onClick={() => void refresh()}
                      disabled={isLoading || isProcessing}
                    />
                  </>
                }
              >
                <StatList items={viewModel.statusStats} />

                {/*
                 * Named for what they do, with what they do underneath. They were two
                 * words — 检查, 图谱 — in a bare two-column grid, which read as labels
                 * rather than controls and said nothing about what pressing them meant.
                 */}
                <ul className="mt-6 flex min-w-0 flex-col">
                  {viewModel.secondaryActions.map((action) => (
                    <HairlineItem key={action.id}>
                      <div className="flex min-w-0 items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium leading-[1.75] text-base-content">
                            {SECONDARY_ACTION_TITLES[action.id]}
                          </div>
                          <PanelText tone="meta">
                            {SECONDARY_ACTION_HINTS[action.id]}
                          </PanelText>
                        </div>
                        <TextControlButton
                          outlined
                          className="shrink-0"
                          disabled={actionsDisabled || action.disabled}
                          onClick={() =>
                            action.id === "lint" ? void lint() : void graph()
                          }
                        >
                          {activeOperation === action.id
                            ? (activeOperationLabel ?? "进行中")
                            : action.label}
                        </TextControlButton>
                      </div>
                    </HairlineItem>
                  ))}
                </ul>

                {/* The operation's own output belongs on this side: it is the
                    machine reporting, not an answer to a question. */}
                {/*
                  * A fixed height, because this is the box a running operation
                  * writes into: growing by a line as each file reports moved
                  * everything below it, once per file.
                  */}
                {panelMessage ? (
                  <LogBlock className="mt-6 h-24" testId="llm-wiki-progress">
                    {panelMessage}
                  </LogBlock>
                ) : null}

                {viewModel.failed.length > 0 ? (
                  <section className="mt-6 min-w-0">
                    <PanelText tone="meta">失败明细</PanelText>
                    <ul
                      data-testid="llm-wiki-failed-details"
                      className="mt-1 flex max-h-64 min-w-0 flex-col overflow-auto"
                    >
                      {viewModel.failed.map((failure) => (
                        <HairlineItem key={failure.path} className="py-2.5">
                          <div
                            className="min-w-0"
                            title={`${failure.path}\n${failure.reason}`}
                          >
                            <div className="break-all text-[13px] leading-[1.6] text-base-content/85">
                              {failure.path}
                            </div>
                            <PanelText tone="meta" className="break-words">
                              {failure.reason}
                            </PanelText>
                          </div>
                        </HairlineItem>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </PanelSection>
            </section>

            <section className="flex min-h-0 min-w-0 flex-col overflow-auto">
              {/*
               * Both LLM-backed sections are visible whether or not a provider is
               * configured, and say so in their own hint. They used to be tabs that
               * refused to open, which left the user to guess why.
               */}
              <PanelSection
                title="提问"
                hint={askDisabledHint ? `${NEEDS_LLM}。${ASK_HINT}` : ASK_HINT}
                actions={
                  askDisabledHint ? (
                    <TextControlButton outlined onClick={handleConfigure}>
                      配置 LLM
                    </TextControlButton>
                  ) : null
                }
              >
                <form
                  className="flex min-w-0 flex-col gap-3"
                  onSubmit={handleQuerySubmit}
                >
                  {/* No field label: the section is called 提问 and the box says what
                      to type in it. */}
                  <TextArea
                    className="min-h-24"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    disabled={queryActionsDisabled || status?.mode !== "llmWiki"}
                    placeholder="询问当前 Wiki"
                    rows={4}
                  />
                  <div className="flex justify-end">
                    <TextControlButton
                      outlined
                      type="submit"
                      disabled={queryDisabled}
                    >
                      {isQuerying ? "正在查询" : "查询 Wiki"}
                    </TextControlButton>
                  </div>
                </form>

                {queryAnswer ? (
                  <div className="mt-5 min-w-0">
                    <PanelText className="whitespace-pre-wrap break-words">
                      {queryAnswer.answer}
                    </PanelText>
                    {queryAnswer.insufficientContext ? (
                      <PanelText tone="meta" className="mt-2 text-warning">
                        当前 Wiki 内容不足以完整回答该问题。
                      </PanelText>
                    ) : null}
                    {queryAnswer.references.length > 0 ? (
                      <>
                        <PanelText tone="meta" className="mt-4">
                          引用到的页面
                        </PanelText>
                        <ul className="mt-1 flex min-w-0 flex-col">
                          {queryAnswer.references.map((reference) => (
                            <HairlineItem
                              key={reference.path}
                              className="py-2.5"
                            >
                              <div
                                className="min-w-0"
                                title={`${reference.title}\n${reference.path}`}
                              >
                                <div className="truncate text-[13px] leading-[1.6] text-base-content/85">
                                  {reference.title}
                                </div>
                                <PanelText tone="meta" className="truncate">
                                  {reference.path}
                                </PanelText>
                              </div>
                            </HairlineItem>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </PanelSection>

              <PanelSection
                className="border-t border-[var(--mdx-separator)]"
                title="生成综述"
                hint={
                  digestDisabledHint ? `${NEEDS_LLM}。${DIGEST_HINT}` : DIGEST_HINT
                }
                actions={
                  digestDisabledHint ? (
                    <TextControlButton outlined onClick={handleConfigure}>
                      配置 LLM
                    </TextControlButton>
                  ) : null
                }
              >
                <form
                  className="flex min-w-0 flex-col gap-3"
                  onSubmit={handleDigestSubmit}
                >
                  {/* A file name is short, so its field is short: a full-width box for
                      eight characters is what made these pages look like forms. The
                      topic is prose and gets the room prose needs. */}
                  <label className="flex min-w-0 flex-col gap-1.5 sm:max-w-xs">
                    <span className="text-[13px] leading-[1.6] text-base-content/50">
                      文件名
                    </span>
                    <TextInput
                      value={digestTitle}
                      onChange={(event) => setDigestTitle(event.target.value)}
                      disabled={
                        actionsDisabled ||
                        status?.mode !== "llmWiki" ||
                        isProcessing
                      }
                      placeholder="project-summary"
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-[13px] leading-[1.6] text-base-content/50">
                      主题
                    </span>
                    <TextArea
                      className="min-h-20"
                      value={digestPrompt}
                      onChange={(event) => setDigestPrompt(event.target.value)}
                      disabled={
                        actionsDisabled ||
                        status?.mode !== "llmWiki" ||
                        isProcessing
                      }
                      placeholder="生成综述的问题或主题"
                      rows={3}
                    />
                  </label>
                  <div className="flex justify-end">
                    <TextControlButton
                      outlined
                      type="submit"
                      disabled={digestDisabled}
                    >
                      {activeOperation === "digest"
                        ? (activeOperationLabel ?? "正在生成")
                        : "生成综述"}
                    </TextControlButton>
                  </div>
                </form>
              </PanelSection>
            </section>
          </div>
        </PanelViewport>
      )}

    </section>
  );
}
