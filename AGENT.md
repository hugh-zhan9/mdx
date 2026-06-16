# MDX Product North Star

MDX 是一个本地优先的 LLM Wiki Markdown 工作区。

它以桌面 Markdown 编辑器作为人的操作界面，以本地 CLI / Agent 协议作为自动化界面。用户在本机文件夹中编辑、阅读和组织 Markdown；Agent 则可以在用户授权下消化素材、维护索引、生成实体与主题页面，并把知识库逐步演化成一个持久化、可追溯、可审计的 wiki。

MDX 基于 [Karpathy 的 LLM Wiki 方法](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 来组织长期知识：

- `raw/` 保存原始素材，作为事实来源。
- `wiki/` 保存由人和 Agent 共同维护的 Markdown 知识页面。
- `index.md` 提供内容导览，让人和 Agent 都能快速定位相关页面。
- `log.md` 记录 ingest、query、digest、lint 等关键操作。
- wikilink、frontmatter、source 引用和变更记录共同保证知识可以回溯。

MDX 的目标不是只做一个 Markdown 预览编辑器，而是让人和 Agent 能在同一个本地工作区里协作维护知识库：人负责判断、修订和确认；Agent 负责整理、连接、检索、综合和持续维护。

## Product Principles

- Local-first: 知识库优先保存在用户本机文件夹中。
- Markdown-native: 所有核心知识都应该能以普通 Markdown 文件长期保存和迁移。
- Agent-operable: 桌面应用需要提供稳定的 CLI / 本地协议，让 Agent 能安全地读取、打开、编辑和保存工作区内容。
- Auditable automation: Agent 可以自动生成和更新页面，但重要改动应该能通过来源、引用、日志和 diff 被用户审计。
- Incremental wiki: 每次素材消化和问题回答都应该有机会沉淀为可复用的 wiki 页面，而不是一次性的聊天结果。

## Memory Positioning

MDX Memory 的定位是：作为外挂给 Codex、Claude、Cursor 等 agent 的本地优先记忆系统，而不是以人工维护为主的笔记面板。

- Memory 的主调用方是 agent，不是用户手工操作。agent 应通过 skill、MCP、本地 CLI 和本地协议读取与写入 memory。
- `memory/threads/` 用于保存 agent 原始对话原文。完整 thread 归档是 Memory 的一等能力，不能退化成只保存摘要。
- `memory/memories/` 用于保存 agent 从对话中提取出的可复用长期记忆。
- `memory/inbox/` 用于保存自动提取但仍需审核的候选记忆。
- `memory/working.md` 只是当前任务上下文缓存和过渡层，不应成为要求用户主动维护的主路径。

## Memory Workflow Rules

- Memory 的目标工作流应默认偏向自动化：agent 自动 recall，自动保存原始 thread，自动提取候选 memory，必要时进入 inbox 审核。
- 触发 thread capture、memory distill、pre-compact memory 提取时，应优先通过 hook、capture pipeline、agent 生命周期事件或等价的自动触发链路完成。
- 需要用户每次明确提示 agent “请写入记忆”“请更新工作记忆” 的流程，不符合目标定位，只能作为临时 fallback，不能作为产品主路径。
- UI 的主要职责是查看、审核、搜索、校正和诊断 Memory 状态，不应把“手工编辑 working memory”设计成主交互模型。
- 若自动化链路与手工链路发生冲突，实现应优先保证 agent 自动工作流成立，再考虑手工补充入口。

## Memory Backend Rules

- Agent backend mode uses the runtime database as the source of truth. Markdown under `memory/**` is a readable projection and import/export compatibility layer.
- SQLite is the default local backend; PostgreSQL is supported for service-style deployments and must be reached through explicit storage migration.
- Hard shutdown means the disabled feature stops new writes. It must not delete historical DB records, Markdown projection files, or user-authored Memory content.
- Hooks must stay lightweight: capture/recall may run in the hook path, but provider distill and long work must run through daemon/queue/worker paths.
- Codex, Claude, and Cursor are the V1 first-class agents. New agent behavior should not lower completion quality for these three.

## Memory Non-Goals

- 不要把 Memory 实现成以人工录入为中心的知识管理工具。
- 不要把 working memory 误当成长期记忆的主存储。
- 不要要求用户理解或维护 thread capture、distill、inbox、working memory 之间的内部流程，除非是在诊断或审核场景下。
- 不要为了补齐 UI 交互而偏离“外挂给 agent 的 memory backend”这一定位。
