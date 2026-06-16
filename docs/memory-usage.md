# MDX Memory 使用说明

本文面向使用者说明 MDX Memory 的日常操作。底层契约见 [memory.md](./memory.md)。

## 入口方式

Memory 有三种入口：

1. 桌面应用右侧 `Memory` 面板：适合日常查看、Recall、Working Memory、Inbox、Threads 和索引修复。
2. CLI：

```bash
/Applications/MDX.app/Contents/MacOS/mdx-cli memory ...
```

如果在源码目录，也可以使用构建产物：

```bash
src-tauri/target/release/mdx-cli memory ...
```

3. MCP：

```bash
/Applications/MDX.app/Contents/MacOS/mdx-mcp --workspace /path/to/workspace
```

CLI 默认连接正在运行的 MDX 桌面应用。要脱离桌面应用直接操作某个工作区，使用 `--root`：

```bash
mdx-cli memory --root /path/to/workspace status
```

Agent backend 常用命令：

```bash
mdx-cli memory --root "$PWD" daemon --port 14243
mdx-cli memory --root "$PWD" install --agent codex --dry-run
mdx-cli memory --root "$PWD" doctor --agent codex --json
mdx-cli memory --root "$PWD" hook codex UserPromptSubmit < codex-hook.json
mdx-cli memory --root "$PWD" migrate storage --to postgresql --target "$MDX_MEMORY_POSTGRES_URL" --dry-run
```

## 初始化

首次在工作区使用 Memory：

```bash
mdx-cli memory --root /path/to/workspace init
```

初始化会创建：

```text
memory/
  MEMORY.md
  working.md
  memories/
  threads/
  inbox/
.mdx/
  memory-config.json
  search.sqlite
```

查看状态：

```bash
mdx-cli memory --root /path/to/workspace status --json
```

## 添加长期记忆

添加一条长期记忆：

```bash
mdx-cli memory --root /path/to/workspace add \
  --title "项目约定" \
  --body "Memory 层和 LLM Wiki 层平级，recall 默认不读取 wiki 全文。" \
  --tag architecture \
  --importance 0.8 \
  --confidence 0.9
```

从文件添加：

```bash
mdx-cli memory --root /path/to/workspace add \
  --title "长期约定" \
  --file ./note.md \
  --tag convention
```

从 stdin 添加：

```bash
cat ./note.md | mdx-cli memory --root /path/to/workspace add \
  --title "长期约定" \
  --stdin
```

列出记忆：

```bash
mdx-cli memory --root /path/to/workspace list
mdx-cli memory --root /path/to/workspace list --tag architecture
```

查看单条记忆：

```bash
mdx-cli memory --root /path/to/workspace show <memory_id或path>
```

归档记忆：

```bash
mdx-cli memory --root /path/to/workspace archive <memory_id或path>
```

## Recall 检索

Recall 是给 Agent 或用户查上下文的主入口：

```bash
mdx-cli memory --root /path/to/workspace recall "memory 模块的设计约定"
```

输出 JSON：

```bash
mdx-cli memory --root /path/to/workspace recall --json "memory 模块的设计约定"
```

常用参数：

```bash
mdx-cli memory --root /path/to/workspace recall \
  --limit 10 \
  --byte-budget 65536 \
  --tag architecture \
  --include-threads \
  "索引降级怎么处理"
```

Recall 行为：

- 默认包含 `memory/working.md`。
- 默认不注入 thread 全文。
- `--include-threads` 返回 thread 摘要，不默认返回完整对话。
- SQLite 索引只是投影；索引不可用时会 fallback 到 Markdown，并标记 degraded。

不包含 working memory：

```bash
mdx-cli memory --root /path/to/workspace recall --no-working "查询内容"
```

## Working Memory

Working Memory 存放当前关注点，适合记录本轮或近期工作状态。

读取：

```bash
mdx-cli memory --root /path/to/workspace working get
```

覆盖：

```bash
mdx-cli memory --root /path/to/workspace working set \
  --body "当前正在完成 Memory 完整能力实现。"
```

追加到 section：

```bash
mdx-cli memory --root /path/to/workspace working append \
  --section "Current Focus" \
  --text "下一步检查 MCP 调用面。"
```

## 保存对话 Thread

Thread 用于保存完整 AI 对话原文，后续可以蒸馏成记忆。Thread 是原文归档，不等同于压缩前自动写入 memory。

```bash
mdx-cli memory --root /path/to/workspace thread save \
  --source codex \
  --thread-id "codex:memory-design-001" \
  --title "Memory 完整能力设计" \
  --file ./thread.md
```

支持的 source：

```text
codex
cursor
claude-code
import
manual
```

列出 thread：

```bash
mdx-cli memory --root /path/to/workspace thread list
mdx-cli memory --root /path/to/workspace thread list --source codex
```

查看 thread：

```bash
mdx-cli memory --root /path/to/workspace thread show codex:memory-design-001
```

Codex 本地会话可以从 Codex session JSONL 自动发现并归档：

```bash
mdx-cli memory --root /path/to/workspace capture scan --source codex
mdx-cli memory --root /path/to/workspace capture scan --source codex --import
```

默认扫描目录：

```text
~/.codex/sessions
~/.codex/archived_sessions
```

需要覆盖或追加扫描目录时，设置 `MDX_CODEX_SESSION_DIRS`。该变量使用系统 path-list 分隔符，例如 macOS/Linux 上用 `:`：

```bash
MDX_CODEX_SESSION_DIRS="/path/to/sessions:/path/to/archived" \
  mdx-cli memory --root /path/to/workspace capture scan --source codex --import
```

`capture scan --source codex --import` 会把发现的 `rollout-*.jsonl` 保存到 `memory/threads/codex/`。保存的 thread 按原始会话展示，包含 `## Conversation` 和 `## Raw Codex JSONL` 两部分，因此可以保留完整 Codex 会话原文。加 `--distill` 时会在导入后尝试蒸馏；如果蒸馏失败，命令会返回失败，不会把 distill failure 静默当作成功。

## Agent 集成配置

Memory 可以为 Codex/Claude/Cursor 配置 MCP、skill/rule，以及 Claude/Cursor 的 pre-compact hook：

```bash
mdx-cli memory --root /path/to/workspace install --agent codex
mdx-cli memory --root /path/to/workspace install --agent claude
mdx-cli memory --root /path/to/workspace install --agent cursor
```

省略 `--agent` 会配置所有支持的 agent：

```bash
mdx-cli memory --root /path/to/workspace install
```

预览将写入哪些文件：

```bash
mdx-cli memory --root /path/to/workspace install --agent codex --dry-run
```

旧的聚合设置命令仍可用于一次性配置多项 agent 集成：

```bash
mdx-cli memory --root /path/to/workspace agent setup --all
```

MDX 桌面应用也提供入口：打开 Memory 面板的 Settings tab，在 Agent Integration 区域选择 Codex、Claude、Cursor 和 PreCompact hooks，然后点击 Configure Agents。安装包会随 app bundle 带上 `mdx-cli` 和 `mdx-mcp`；外部 agent 配置不会静默写入，必须由用户在 UI 或 CLI 中主动触发。

选择性配置：

```bash
mdx-cli memory --root /path/to/workspace agent setup --codex
mdx-cli memory --root /path/to/workspace agent setup --claude --cursor
mdx-cli memory --root /path/to/workspace agent setup --all --no-hooks
```

预览将写入哪些文件：

```bash
mdx-cli memory --root /path/to/workspace agent setup --all --dry-run
```

需要指定二进制路径时：

```bash
mdx-cli memory --root /path/to/workspace agent setup --all \
  --mdx-cli /Applications/MDX.app/Contents/MacOS/mdx-cli \
  --mdx-mcp /Applications/MDX.app/Contents/MacOS/mdx-mcp
```

配置内容：

- Codex/Codey：写入 `~/.codey/config.toml` 的 `mdx-memory` MCP，并安装 `mdx-memory` skill。
- Claude：安装 `mdx-memory` skill，追加 `~/.claude/CLAUDE.md` 提示，配置 `PreCompact` hook。
- Cursor：写入 `~/.cursor/mcp.json`、`~/.cursor/rules/mdx-memory.mdc`、`mdx-memory` skill，并配置 `preCompact` hook。

Pre-compact hook 的语义是“压缩前自动沉淀 memory”：当 hook 输入包含 `transcript_path` 时，会先 `capture import --distill`，再对同一 thread 执行 `distill --accept`，让结果进入 active memory。实现上会保存 source thread 作为溯源材料，但这不是“自动 thread 归档”入口。显式保存完整原文使用 `memory thread save`，Codex 本地 session 使用 `capture scan --source codex --import`。

Codex 当前没有已验证的 pre-compact transcript hook，因此 `agent setup --codex` 只配置 MCP 和 skill；Codex 的压缩前 capture 仍需通过 MCP/CLI 显式触发，直到 Codex 暴露可靠的 transcript hook。Codex thread 原文归档不依赖 pre-compact hook，它通过扫描本地 Codex session JSONL 完成。

## Agent Backend Daemon 和 Hook

启动本地 daemon：

```bash
mdx-cli memory --root /path/to/workspace daemon --port 14243
```

手动模拟 hook 输入：

```bash
printf '{"session_id":"s1","turn_id":"t1","cwd":"%s","prompt":"remember Memory positioning"}' "/path/to/workspace" \
  | mdx-cli memory --root /path/to/workspace hook codex UserPromptSubmit
```

查看 agent 集成状态：

```bash
mdx-cli memory --root /path/to/workspace doctor --json
mdx-cli memory --root /path/to/workspace doctor --agent codex --json
```

Hook 失败不能阻塞 agent。daemon 不可用或存储退化时，hook 应返回成功并尽量写入 fallback spool；硬关闭时不写 DB、不写 spool、不入队。

## Distill 蒸馏

把保存过的 thread 蒸馏成 inbox 候选记忆：

```bash
mdx-cli memory --root /path/to/workspace distill \
  --thread codex:memory-design-001
```

直接接受为 active memory：

```bash
mdx-cli memory --root /path/to/workspace distill \
  --thread codex:memory-design-001 \
  --accept
```

强制重新蒸馏：

```bash
mdx-cli memory --root /path/to/workspace distill \
  --thread codex:memory-design-001 \
  --force
```

注意：

- 不带 `--force` 时，同一 thread 内容重复蒸馏是幂等的，不会重复生成候选。
- 当前 distill 需要配置本地 LLM provider；未配置时会报 `distill_unavailable`。

## Inbox 审核

查看待确认候选：

```bash
mdx-cli memory --root /path/to/workspace inbox list
```

包含已处理候选：

```bash
mdx-cli memory --root /path/to/workspace inbox list --include-reviewed
```

接受候选：

```bash
mdx-cli memory --root /path/to/workspace inbox accept <inbox_id>
```

接受时覆盖标题或正文：

```bash
mdx-cli memory --root /path/to/workspace inbox accept <inbox_id> \
  --title "新的标题" \
  --body "修订后的记忆正文"
```

拒绝候选：

```bash
mdx-cli memory --root /path/to/workspace inbox reject <inbox_id>
```

## Capture 导入外部对话

导入 Codex/Cursor/Claude Code 对话文件：

```bash
mdx-cli memory --root /path/to/workspace capture import \
  --source codex \
  --file ./codex-thread.jsonl \
  --thread-id "codex:abc123" \
  --title "一次 Codex 会话"
```

导入并尝试蒸馏：

```bash
mdx-cli memory --root /path/to/workspace capture import \
  --source codex \
  --file ./codex-thread.jsonl \
  --distill
```

`capture import --distill` 默认写入 `memory/inbox` 候选；需要直接进入 active memory 时，对保存出来的 thread 再执行：

```bash
mdx-cli memory --root /path/to/workspace distill \
  --thread <source:thread-id> \
  --accept
```

扫描来源：

```bash
mdx-cli memory --root /path/to/workspace capture scan --source codex
mdx-cli memory --root /path/to/workspace capture scan --source codex --import
```

## Promote 到 LLM Wiki

把 thread 或 memory 推到 `raw/promoted/`：

```bash
mdx-cli memory --root /path/to/workspace promote <thread_id或memory_id或path>
```

指定标题：

```bash
mdx-cli memory --root /path/to/workspace promote <target> \
  --title "Memory 模块设计材料"
```

推送后立即 ingest 到 LLM Wiki：

```bash
mdx-cli memory --root /path/to/workspace promote <target> --ingest
```

注意：

- Memory 和 LLM Wiki 是平级能力。
- Thread 进入 Wiki 只能通过 `memory promote`。
- `--ingest` 要求 LLM Wiki 已初始化。

## 索引维护

查看索引状态：

```bash
mdx-cli memory --root /path/to/workspace index status
```

重建索引：

```bash
mdx-cli memory --root /path/to/workspace index rebuild
```

修复工作区并重建索引：

```bash
mdx-cli memory --root /path/to/workspace repair --rebuild-index
```

## 导出和导入

导出 Memory bundle：

```bash
mdx-cli memory --root /path/to/workspace export \
  --output /tmp/mdx-memory-bundle \
  --include-log
```

导入前 dry run：

```bash
mdx-cli memory --root /path/to/other-workspace import \
  --input /tmp/mdx-memory-bundle \
  --dry-run
```

正式导入：

```bash
mdx-cli memory --root /path/to/other-workspace import \
  --input /tmp/mdx-memory-bundle
```

默认策略是 `skip`，已有文件会跳过。

## SQLite 和 PostgreSQL 迁移

SQLite 是默认本地运行库；PostgreSQL 适合服务化或跨进程部署。切换前先做 dry run：

```bash
mdx-cli memory --root /path/to/workspace migrate storage \
  --to postgresql \
  --target "$MDX_MEMORY_POSTGRES_URL" \
  --dry-run
```

确认后再执行实际迁移：

```bash
mdx-cli memory --root /path/to/workspace migrate storage \
  --to postgresql \
  --target "$MDX_MEMORY_POSTGRES_URL"
```

Markdown under `memory/**` 是可读投影和导入/导出兼容层；agent-backend 模式下，运行时数据库是事实来源。

## Agent-time Memory extraction

Memory 提取发生在 Agent 正常对话 turn 中：Agent 通过 hook、MCP 工具、CLI 和已安装的 skill/rule 判断何时 recall、search、add 或送审候选。daemon/hook 是推荐的自动化路径；MCP 和 CLI 是同一后端能力的显式入口。

安全使用原则：

- 先用 `memory_recall`。当既有决策、用户偏好、项目约定或历史上下文可能影响当前回答时，应在 turn 早期检索。
- 避免重复写入。准备调用 `memory_add` 前，如果标题、主题或事实可能已经存在，先用 `memory_search` 查重。
- 主动保存低风险事实。对用户明确表达、长期有用、非敏感且置信度高的偏好、约定和项目事实，可以在当前 turn 直接写入 durable memory。
- 谨慎处理敏感或不确定内容。涉及隐私、凭证、医疗财务等敏感信息，或只是推测、临时状态、低置信度总结时，应使用 `memory_inbox_add` 创建 inbox review candidate；需要用户判断时先询问。

## MCP 可用工具

`mdx-mcp --workspace /path/to/workspace` 暴露这些工具：

```text
memory_status
memory_recall
memory_working_get
memory_add
memory_inbox_add
memory_thread_save
memory_thread_show
memory_inbox_list
memory_inbox_accept
memory_distill
memory_search
memory_promote
memory_hook_status
memory_diagnostics
```

给 Agent 使用时，推荐流程：

1. session 开始先 `memory_recall`。
2. 需要长期保存时调用 `memory_add`。
3. 完整对话需要保留时调用 `memory_thread_save`。
4. 从 thread 提炼长期记忆时调用 `memory_distill`。
5. 敏感或不确定候选先用 `memory_inbox_add` 创建 review candidate，再用 `memory_inbox_list` 查看并用 `memory_inbox_accept` 接受。

## 推荐日常流程

```bash
# 1. 初始化
mdx-cli memory --root . init

# 2. 写当前关注
mdx-cli memory --root . working set --body "当前在实现 MDX Memory 完整能力。"

# 3. 添加长期记忆
mdx-cli memory --root . add \
  --title "Memory 边界" \
  --body "Memory recall 默认不读取 wiki 全文。" \
  --tag memory

# 4. 查询相关上下文
mdx-cli memory --root . recall --json "Memory recall 的边界规则"

# 5. 定期重建索引
mdx-cli memory --root . index rebuild

# 6. 导出备份
mdx-cli memory --root . export --output ./memory-bundle --include-log
```
