# Clarify: mdx-cli LLM Wiki 查询检索能力

## Intent And Desired Outcome

用户希望 `mdx-cli` 包含一部分 LLM Wiki 能力，第一版只暴露面向用户和 Agent 的查询/检索能力，不开放会改变知识库结构或后台处理状态的操作入口。

目标结果：

- `mdx-cli llm-wiki query ...` 可基于当前 Workspace Mode 的 LLM Wiki 知识库回答问题。
- `mdx-cli llm-wiki search ...` 可为 Agent 返回结构化检索结果。
- CLI 行为继续符合现有 `mdx-cli` 的 Workspace Mode/socket 模型。

## In Scope

- 新增 `mdx-cli llm-wiki query [--json] <question...>`。
- 新增 `mdx-cli llm-wiki search <query...>`。
- 命令使用当前 Workspace Mode 的 active workspace root。
- `query` 默认输出纯文本 answer；`--json` 输出完整 JSON。
- `search` 默认输出 JSON，包含 `results` 数组。
- 多词参数用剩余 argv join 成一个字符串。
- `query` 沿用当前应用内 `llm_wiki_query_sync` 行为，可写入 `log.md`。
- `search` 纯检索，不写日志。
- LLM Wiki paused 状态下 `query/search` 仍可用。
- 扩展现有 Unix socket JSON line CLI 协议和 Rust `mdx-cli` 子命令。
- 更新 README/中文 README/日文 README 的 CLI 命令说明。

## Non Goals

- 不暴露 `init`、`scan/rescan`、`ingest`、`lint`、`graph`、`digest`。
- 不支持 headless 直接文件系统模式。
- 不支持 `--root`。
- 不支持 stdin。
- 不支持 `--limit`。
- 不新增 `wiki`、`ask`、顶层 `search` 等别名。
- 不影响当前 MDX UI 状态，不主动打开 LLM Wiki 面板、不打开文件、不切换 tab。
- 不自动初始化 LLM Wiki workspace，不自动引导配置 LLM。
- 不纳入 Document Mode。

## Decision Boundaries

- 第一版继续只服务 Workspace Mode 和现有 socket：`~/.mdx/cli.sock`。
- `mdx-cli` 连接不到 socket 时沿用现有 bootstrap 行为，尝试启动 MDX；启动后没有 workspace 时返回 `no_workspace`。
- 当前 workspace 不是 LLM Wiki 时返回 `llm_wiki_not_ready`。
- `query` 无匹配上下文时返回 ok，`insufficient_context: true`，默认纯文本输出 answer，exit 0。
- `search` 无匹配结果时返回 ok，`results: []`，exit 0。
- CLI JSON 统一使用现有 `snake_case`。

## Constraints

- 现有 CLI 协议在 `src-tauri/src/cli_protocol.rs`，使用 `serde(tag = "cmd", rename_all = "kebab-case")`。
- 现有 CLI 响应是 `snake_case`，例如 `root_path`、`active_tab_id`。
- 现有 socket server 在 `src-tauri/src/cli_server.rs`，通过当前 Workspace snapshot 获取 active root。
- 现有 CLI binary 在 `src-tauri/src/bin/mdx_cli.rs`，使用 `clap` subcommand。
- 现有 LLM Wiki Tauri/Rust 能力已经有：
  - `llm_wiki_search(root_path, query) -> Vec<WikiSearchResult>`
  - `llm_wiki_query(root_path, question) -> LlmWikiQueryResponse`
  - `llm_wiki_query_sync` 当前会 `append_log_entry("query ...")`。

## Success Criteria

- `mdx-cli llm-wiki query raw 目录是什么` 输出纯文本 answer。
- `mdx-cli llm-wiki query --json raw 目录是什么` 输出 JSON，包含 `ok`、`answer`、`references`、`insufficient_context`。
- `mdx-cli llm-wiki search raw 目录` 输出 JSON，包含 `ok`、`results`。
- `search` 空结果仍输出 `{"ok":true,"results":[]}`。
- 非 LLM Wiki workspace 返回 `ok:false` 和 `error_code:"llm_wiki_not_ready"`。
- 无 active workspace 返回现有 `no_workspace`。
- CLI 查询不改变 UI 状态。
- 只新增查询/检索能力，文档中不出现对外暴露 init/scan/ingest/lint/graph/digest 的命令。

## Assumptions Challenged

- 不把所有 LLM Wiki 面板能力搬到 CLI；用户明确只要查询能力，并要求当前版本支持 Agent 检索。
- 不做 headless，因为会引入第二套 root、状态和 UI 同步模型。
- 不做 `--root`，避免半 headless 行为。
- `query` 虽然写 `log.md`，但用户确认沿用当前应用行为。

## Key Decisions And Rejected Alternatives

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| 运行模型 | Workspace Mode socket | headless 文件系统模式 | 复用现有 CLI/app 状态模型 |
| 能力范围 | query + search | init/scan/ingest/lint/graph/digest | 避免对外暴露操作类能力 |
| root 选择 | active workspace root | `--root` | 避免状态分叉 |
| 输出风格 | snake_case JSON | camelCase JSON | 保持 `mdx-cli` 一致性 |
| query 默认输出 | 纯文本 answer | 默认完整 JSON | 更适合终端和 Agent 直接消费 |
| search 输出 | JSON | 纯文本列表 | 检索结果天然结构化 |
| 参数 | `<question...>` / `<query...>` join | 仅单字符串参数 | 降低用户/Agent 调用成本 |
| 空结果 | ok + 空数组/insufficient | 非 0 失败 | 空结果是正常查询结果 |

## Brownfield Evidence Vs Inference

Evidence:

- `README.zh-CN.md` 已说明 `mdx-cli` 通过 `~/.mdx/cli.sock` 连接 Workspace Mode。
- `docs/loopx/design/MDX双模式文档与工作区需求设计文档.md` 已约束 CLI 继续只服务 Workspace Mode。
- `src-tauri/src/bin/mdx_cli.rs` 已有 `clap` subcommands 和 socket bootstrap。
- `src-tauri/src/cli_protocol.rs` 已定义 `CliRequest`、`CliResponse`、`WorkspaceSnapshot`。
- `src-tauri/src/cli_server.rs` 已通过 current snapshot 找到当前 workspace root 和 window label。
- `src-tauri/src/llm_wiki.rs` 已有 `llm_wiki_search`、`llm_wiki_query_sync`。
- `src-tauri/src/llm_wiki_models.rs` 已有 `WikiSearchResult` 和 `LlmWikiQueryResponse`。

Inference:

- CLI handler 可以直接调用 `llm_wiki::llm_wiki_search` / `llm_wiki_query_sync`，不必通过 Tauri command invoke。
- 为满足 `search` 空结果输出 `results: []`，可能需要扩展 `CliResponse` 序列化规则或新增专用 response 字段封装。

## Residual Risks

- `llm_wiki_query_sync` 可能执行 LLM 调用，CLI socket handler 当前是每 client thread 同步处理；长耗时 query 会占用该 client thread，但不阻塞 listener 主循环。
- `search_wiki_pages` 当前是简单匹配和全量返回，未来如果 wiki 规模变大可能需要 ranking/limit。
- UI 不主动刷新，但 `query` 写 `log.md` 后，已打开的 log 展示是否自动更新取决于现有 UI 机制；本期不要求。

## Conversation Summary And Important User Wording

- 用户原话：“mdx-cli 我期望也可以 包含一些 llm-wiki 的能力”
- 用户原话：“我只需要 llm-wiki 的查询能力，像init、scan 这些操作能力暂时不建议对外暴露”
- 用户原话：“都需要做，这版本就需要支持 agent 检索”
- 用户确认：
  - 只作用于当前 Workspace Mode active workspace。
  - query 默认纯文本，`--json` 输出结构化。
  - query 写 log，search 不写 log。
  - 多词参数 join。
  - JSON 统一 snake_case。
  - 命令名 `llm-wiki query/search`，无别名。
  - 不加 `--limit`。
  - 可自动启动 MDX，但不自动打开 workspace。
  - paused 状态 query/search 可用。
  - 不影响 UI 状态。
  - 不做 stdin。
  - search 空结果 exit 0。

## Source Requirements And References

- `src-tauri/src/bin/mdx_cli.rs`
- `src-tauri/src/cli_protocol.rs`
- `src-tauri/src/cli_server.rs`
- `src-tauri/src/llm_wiki.rs`
- `src-tauri/src/llm_wiki_models.rs`
- `features/llm-wiki/lib/llm-wiki-client.ts`
- `docs/loopx/design/MDX工作区文件树与标题目录需求设计文档.md`
- `docs/loopx/design/MDX双模式文档与工作区需求设计文档.md`
- `docs/loopx/design/MDX本地优先LLMWiki工作区需求设计文档.md`

## Next Handoff Recommendation

`needs_spec`

Reason: 该需求会改动 CLI 协议、CLI 输出契约、socket server handler、文档和测试矩阵，属于跨模块 API/契约变更，需要先固定设计再进入实现计划。
