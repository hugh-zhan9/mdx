# MDX Memory Agent Backend Clarification

## Intent And Desired Outcome

MDX Memory 的定位已明确为外挂给 Codex、Claude、Cursor 等 agent 的本地优先记忆系统，而不是以用户手工维护为主的笔记面板。

目标是设计一个 agent memory backend：agent 通过 hook、CLI、MCP、本地协议自动 recall、capture、distill；MDX UI 负责查看、审核、搜索、校正、诊断和配置，不把手工写 working memory 作为主路径。

## Important User Wording

- “我对这个记忆系统的定位是一个，外挂给codex，claude，curspr 的记忆系统”
- “这些 agent 可以通过，skill，cli 来写入/查询 记忆”
- “该记忆系统会存入agent的原始对话信息，以及 agent自动提取的记忆”
- “应该要通过 hook自动来触发，而不是需要使用者手动提示agent来触发”
- “你把这个定位定死到 AGENT.md，实现不能偏移这部分”
- “v1 把 Codex，Claude，Cursor 做到最高的完成度，参考claude-mem”
- “SQLite 和别的数据库可以选择吗？ 我有一个postgre 的场景。支持这两个我觉得也可以。”
- “我希望可以在设置界面完整的关闭某个功能。”

## In-Scope Work

- 本地后台服务和队列。
- Codex、Claude、Cursor 三个一等 agent 集成。
- Agent lifecycle hooks 自动触发 recall、capture、enqueue、distill。
- 原始事件日志、thread 快照、长期记忆、待确认候选、provenance。
- SQLite 和 PostgreSQL 两种运行时数据库后端。
- SQLite -> PostgreSQL 完整迁移，PostgreSQL -> SQLite 快照导出/回退。
- Markdown 投影继续生成，作为审计、导出、本地可读兼容层。
- UI 中的 Memory 独立页面，包含概览、Agent 集成、会话、长期记忆、待确认、工作上下文、诊断。
- 设置页提供全局、workspace、agent 三级功能开关。
- 安装/修复向导和 CLI `install/status/doctor/repair/uninstall`。

## Non-Goals

- 不把 Memory 做成人工笔记系统。
- 不要求用户手动提示 agent 写入记忆作为主路径。
- 不把 working memory 当成长期记忆主存储。
- 不默认把 Memory 自动写入 `wiki/`。
- 不做 SQLite/PostgreSQL 实时双向同步、双写复制、冲突合并。
- 不把 Claude Code 或任一外部 agent 作为默认 distill 依赖。
- 不让原始 thread 默认注入 agent 上下文。
- Gemini/OpenCode/Windsurf 等不进入 V1 最高完成度目标。

## Confirmed Decisions

### Product Positioning

- MDX Memory 是 local-first external memory backend for agents。
- 主调用方是 agent；UI 是审计、审核、诊断、配置界面。
- 已写入 `AGENT.md`，实现不得偏离。

### Service Runtime

- V1 必须有本地后台服务和队列。
- 桌面 App 管理后台服务；同时提供 `mdx memory daemon` CLI 用于无 UI 场景。
- Hook 只做轻量 capture、recall、enqueue。
- 服务不可用时 hook 写 fallback spool，服务恢复后补采集。

### Distill Worker

- Distill worker 默认独立于 Codex/Claude/Cursor 主 agent。
- Claude Code 或其他外部 agent 只能作为可选 provider。
- 默认 provider worker 可直接调用模型 provider API。

### Recall Injection

- `SessionStart` 注入当前项目简短 Memory 概览。
- `UserPromptSubmit` 按本轮 prompt 做低延迟 recall，注入少量相关长期记忆。
- `PostToolUse` 和 `Stop` 主要用于 capture/enqueue。
- 原始 thread 默认不注入。
- Hook recall 有超时预算，失败返回空 context，不阻塞 agent。
- 注入内容默认 2-4KB，可配置。

### Capture Trigger Model

- `SessionStart`：创建或恢复 session 记录，绑定 `agent_source + session_id + cwd + workspace_root + project_key`。
- `UserPromptSubmit`：保存用户输入事件，同时触发本轮 recall。
- `PostToolUse`：保存工具调用摘要和元数据，大输出保存引用或截断版本。
- `Stop`：保存最后 assistant 输出，标记状态，enqueue distill job。
- `PreCompact`：最高优先级 flush 当前 session 事件，并 enqueue 高优先级 distill job。
- `PostCompact`：记录 compact 后状态，用于诊断和 provenance。
- 没有 `Stop` 也不能丢数据，worker 要能基于已捕获事件周期性补偿。

### Auto-Accept Rules

- 默认允许低风险、高置信、可复用信息自动进长期记忆。
- 可以自动接受：项目结构、技术栈、用户明确确认的偏好、架构决策、约定、稳定 bug 结论、已验证流程。
- 必须进待确认：个人隐私、账号/组织内部信息、客户资料、商业敏感内容、推断偏好、低置信总结、第三方判断。
- 禁止保存：密钥、token、密码、私钥、cookie、完整凭证、明确要求不要记录的内容。
- 自动接受必须有 provenance。
- Workspace 可配置 `auto_accept=false`，全部候选进入待确认。

### Storage

- 支持 SQLite 和 PostgreSQL。
- SQLite 是默认本机单用户模式。
- PostgreSQL 是高级模式，用于多设备、NAS、服务化或 Postgre 场景。
- DB 是 runtime 事实来源，负责 event log、queue、job 状态、memory 状态、索引、去重、provenance、权限配置。
- Markdown 是可读投影，负责审计、导出、Obsidian/LLM Wiki 兼容。
- PostgreSQL 模式下 Markdown 仍必须生成，但可以异步生成。
- DB 和 Markdown 不一致时以 DB 为准，后台提供 repair/export/rebuild。

### Migration

- V1 支持 SQLite -> PostgreSQL 完整迁移。
- V1 支持 PostgreSQL -> SQLite 快照导出/回退。
- 不做实时双向同步、双写复制或冲突合并。
- 迁移命令支持 dry-run、备份、校验、断点/幂等导入。

### Authorization

- 默认不全局静默捕获。
- 按 `workspace + agent_source` 显式启用。
- 每个 agent 单独开关：Codex / Claude / Cursor。
- Workspace 支持 exclude 规则。
- 未授权 workspace 的 hook 返回空 context，不捕获、不 distill。
- 用户可暂停某 agent 或某 workspace 的 capture/recall/distill。

### V1 Agent Integration Scope

- Codex、Claude、Cursor 都是一等集成，不分主次。
- 三者都要做到自动 capture、自动 recall、自动 distill enqueue、可诊断、可安装、可卸载、可暂停。
- Codex 使用 native Codex hooks。
- Claude 使用 native hooks/plugin 路径。
- Cursor 使用 hooks + MCP 双通道，并可生成 rules/context 文件作为兜底。
- Generic Agent API/CLI 仍提供，但不能牺牲三者完成度。

### Install And Repair

- V1 提供桌面 UI “连接 Agent/集成诊断”。
- CLI 提供 `mdx memory install --agent codex|claude|cursor|all`、`status`、`doctor`、`repair`、`uninstall`。
- 安装时启用 workspace 授权、写 hook/MCP 配置、启动/注册后台服务、验证测试事件。
- 修复时重写缺失 hook、检查服务端口/API key、DB、spool、Markdown 投影任务。

### UI Information Architecture

- `概览`：服务状态、DB 后端、队列积压、今日捕获事件、待确认数量、最近错误。
- `Agent 集成`：Codex / Claude / Cursor 的安装、授权、最后事件、最后错误、修复/暂停/卸载。
- `会话`：原始 thread/session 列表，显示 agent、项目、消息数/事件数、捕获状态、distill 状态、来源路径。
- `长期记忆`：已接受记忆，支持搜索、按项目/agent/tag 过滤、provenance、撤销/归档。
- `待确认`：候选记忆审核，支持接受、编辑后接受、拒绝、批量操作。
- `工作上下文`：保留，但定位为当前任务临时上下文和 agent 调试。
- `诊断`：hook 日志、spool 文件、DB 连接、Markdown 投影、迁移状态、doctor 结果。

### Memory And LLM Wiki Boundary

- Memory 默认不自动写入 `wiki/`。
- 长期记忆保存在 DB 和 `memory/memories/` 投影中，服务于 agent recall。
- 原始会话保存在 DB 和 `memory/threads/` 投影中，服务于审计和 distill。
- 待确认候选保存在 DB 和 `memory/inbox/` 投影中。
- 只有用户明确执行 Promote to Wiki 时才写入 `wiki/` 或 `raw/promoted/`。

### Feature Shutdown

- 设置页需要支持完整关闭某个功能。
- 支持全局开关：Memory 总开关、自动捕获、自动 recall 注入、自动提取、自动接受长期记忆、Markdown 投影、PostgreSQL 后端、MCP Server。
- 支持 workspace 开关和 agent 开关。
- 关闭后必须硬关闭：hook 返回空 context、不写 DB、不写 spool、不 enqueue、不生成 Markdown。
- 关闭功能不删除历史数据；删除必须单独提供清理/导出/删除入口并确认。

### Retention

- 原始 thread/event log 默认长期保存。
- Hook 日志、doctor 日志、失败堆栈默认保留最近 30 天或按大小滚动。
- Spool 成功导入后可删除或归档，失败 spool 保留直到用户修复/清理。
- Queue job 历史默认保留最近 30 天，失败 job 保留更久或直到处理。
- 清理长期记忆、thread、event log 必须显式确认。

### Provider Configuration

- 做统一模型 provider 注册表，但 Memory 有自己的 feature 配置。
- Memory 默认可复用现有 LLM API 配置，但允许单独覆盖 provider/model/baseUrl/apiKey。
- V1 支持 OpenAI-compatible、Anthropic、Gemini、OpenRouter。
- Recall 基础搜索不能强依赖大模型。
- Distill 需要 provider；未配置时只保存 thread/event，并在诊断页提示。
- API key 按现有安全策略保存，不写入 workspace Markdown。

## Brownfield Evidence

- `AGENT.md` 已新增 Memory Positioning、Workflow Rules、Non-Goals。
- `docs/loopx/specs/memory.md` 已定义 Memory 与 LLM Wiki 并列契约、thread/memory/working/inbox/recall/distill/capture/promote 基础契约。
- `src-tauri/src/memory_models.rs` 已有 `MemoryConfig`、`MemoryRecallConfig`、`MemoryDistillConfig`、`MemoryCaptureConfig`，但缺少 DB 后端、agent 授权、feature hard-off、provider registry 等新字段。
- `src-tauri/src/memory_daemon.rs` 已有 local dispatch 路由，覆盖 recall/add/thread/inbox/distill/capture/export/import 等，但目前更像同步 HTTP dispatch，不是完整常驻服务/队列。
- `src-tauri/src/memory_agent_setup.rs` 已有 Codex/Claude/Cursor setup 雏形，写 skill、MCP、precompact hook 和 Cursor rules；需要升级为一等安装、状态、修复、卸载、诊断闭环。
- `src-tauri/src/memory_distill.rs` 当前复用默认 LLM config，直接执行 distill；需要拆成后台 job/provider worker。
- `features/memory/*` 已有独立 Memory UI 雏形，包括设置、召回、工作记忆、长期记忆、待确认、会话；需要按 agent backend 状态重构信息架构。
- `docs/memory-usage.md` 已说明 distill 需要本地 provider。

## External Evidence

- Codex 源码已确认存在 native hooks：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`PreCompact`、`PostCompact`。
- Codex hook 输入包含 `session_id`、`cwd`、`model`、`transcript_path`，turn 级包含 `turn_id`，`Stop` 包含 `last_assistant_message`。
- Codex hook 输出支持 `additional_context`，可用于自动 recall 注入。
- claude-mem 已实现 Codex native hooks，且把 Codex transcript watcher 降级为 legacy/backfill。
- claude-mem 旧 worker `ClaudeProvider` 使用 `@anthropic-ai/claude-agent-sdk` 和本地 Claude Code executable；server/generation 路径直接调用 Anthropic/Gemini/OpenRouter provider API。
- claude-mem Cursor 集成采用 hooks + MCP，并生成 context/rules 兜底。

## Rejected Alternatives

- 只依赖用户手动提示 agent 写 memory：拒绝，不符合产品定位。
- Codex 只做 transcript scan/polling：拒绝，Codex 已有 native hooks。
- 默认使用 Claude Code 外部 agent 做 distill：拒绝，会把 MDX Memory 绑定到单一 agent。
- SQLite 和 PostgreSQL 双写同步：拒绝，V1 范围过大。
- Markdown 作为高频 ingest 事实来源：拒绝，无法支撑 queue、job、诊断、去重和迁移。
- Memory 自动写入 Wiki：拒绝，会污染 LLM Wiki 长期知识边界。

## Success Criteria

- Codex/Claude/Cursor 任一启用后，新会话不需要用户手动提示即可自动 recall/capture/enqueue。
- 用户能在 UI 看到三类 agent 的安装、授权、最后事件、最后错误和修复操作。
- 原始事件进入 DB；thread Markdown 最终生成；distill job 有可追溯状态。
- 高置信低风险记忆可自动进入长期记忆；敏感/低置信内容进入待确认。
- 关闭任一功能后 hook 硬停止对应行为，诊断显示关闭原因。
- SQLite 默认可用，PostgreSQL 可配置；SQLite -> PostgreSQL 可 dry-run 和正式迁移。
- 没有 provider 时 capture/thread 仍工作，distill 明确显示不可用。

## Residual Risks

- Codex/Claude/Cursor hook schema 和安装位置可能随上游版本变化，需要版本探测和 fixture。
- Cursor lifecycle 能力如果不稳定，需要 hooks、MCP、rules/context 文件组合兜底。
- PostgreSQL 模式引入连接、迁移、凭证保存、服务生命周期问题，需要单独验证。
- 自动接受长期记忆的隐私边界需要保守实现和可审计 UI。

## Handoff Recommendation

`needs_spec`

原因：该需求涉及产品行为、agent hook、后台服务、队列、DB schema、迁移、安全隐私、设置开关、UI 信息架构和跨 agent 集成，必须先形成正式设计文档，再进入实现计划。

推荐下一步：

```text
$plan docs/loopx/design/MDX Memory Agent Backend 自动化记忆系统需求设计文档.md
```
