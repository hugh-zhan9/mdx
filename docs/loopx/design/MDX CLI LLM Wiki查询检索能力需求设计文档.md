# MDX CLI LLM Wiki查询检索能力设计文档

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿 | 2026-06-04 | Codex |

## 二、需求信息

### 2.1 需求背景

- 背景：当前 MDX 已提供 `mdx-cli`，通过本地 Unix socket 控制 Workspace Mode 的窗口、tab 和文件树；当前 LLM Wiki 功能主要通过应用内面板和 Tauri commands 使用。
- 需求目的：让 `mdx-cli` 暴露最小的 LLM Wiki 查询/检索能力，使终端用户和 Agent 可以查询当前工作区的知识库，同时避免把初始化、扫描、ingest 等操作类能力开放为 CLI 外部入口。
- 目标用户/使用方：使用 MDX Workspace Mode 管理 LLM Wiki 的用户；需要通过 CLI/Agent 检索知识库上下文的自动化调用方。
- 需求链接：本轮 `$clarify` 对话。
- 关联原始材料：
  - `.loopx/intake/clarify-mdx-cli-llm-wiki-query-20260604-155445.md`
  - `docs/loopx/design/MDX工作区文件树与标题目录需求设计文档.md`
  - `docs/loopx/design/MDX双模式文档与工作区需求设计文档.md`
  - `docs/loopx/design/MDX本地优先LLMWiki工作区需求设计文档.md`
  - `src-tauri/src/bin/mdx_cli.rs`
  - `src-tauri/src/cli_protocol.rs`
  - `src-tauri/src/cli_server.rs`
  - `src-tauri/src/llm_wiki.rs`

### 2.2 需求范围

- 本期范围：
  - 新增 `mdx-cli llm-wiki query [--json] <question...>`。
  - 新增 `mdx-cli llm-wiki search <query...>`。
  - 两个命令默认作用于当前 Workspace Mode 的 active workspace root。
  - `query` 默认输出纯文本 answer；`--json` 输出完整 JSON。
  - `search` 输出 JSON，包含 `results` 数组。
  - CLI JSON 字段统一现有 `snake_case`。
  - 更新 CLI 协议、socket server、Rust CLI binary、README 文档和相关测试。
- 非目标：
  - 不开放 `init`、`scan/rescan`、`ingest`、`lint`、`graph`、`digest`。
  - 不支持 headless 直接文件系统模式。
  - 不支持 `--root`。
  - 不支持 stdin。
  - 不支持 `--limit`。
  - 不新增别名，如 `mdx-cli wiki`、`mdx-cli ask`、顶层 `search`。
  - 不影响当前 UI 状态，不主动打开 LLM Wiki 面板、不打开文件、不切换 tab。
  - 不支持 Document Mode。
- 决策边界：
  - `mdx-cli` 继续使用 `~/.mdx/cli.sock`。
  - socket 不可用时沿用现有 bootstrap 行为尝试启动 MDX。
  - 启动后没有 workspace 时返回 `no_workspace`，不自动选择文件夹。
  - 当前 workspace 不是 LLM Wiki 时返回 `llm_wiki_not_ready`。
  - LLM Wiki paused 状态下 `query/search` 仍可用。
- 依赖方：
  - Rust CLI binary：`src-tauri/src/bin/mdx_cli.rs`
  - CLI protocol：`src-tauri/src/cli_protocol.rs`
  - CLI socket server：`src-tauri/src/cli_server.rs`
  - LLM Wiki service：`src-tauri/src/llm_wiki.rs`
  - LLM Wiki models/query：`src-tauri/src/llm_wiki_models.rs`、`src-tauri/src/llm_wiki_query.rs`
  - README 文档。
- 约束条件：
  - 复用现有 Workspace snapshot 获取 root，不引入第二套 root 解析入口。
  - `query` 沿用现有 `llm_wiki_query_sync` 行为，会写 `log.md`。
  - `search` 不写日志。

### 2.3 可行性分析

- 业务可行性：需求只增加查询/检索入口，符合用户对 Agent 检索和 CLI 查询的实际需求。
- 技术可行性：现有 Rust 已有 `llm_wiki_search` 和 `llm_wiki_query_sync`，CLI socket server 已能定位当前 Workspace snapshot。
- 团队接受能力：改动集中在 Rust CLI/协议/server 和 README，前端 UI 不需要改。
- 时间成本：低到中。需要扩展协议字段和测试，避免破坏现有 CLI 输出。
- 资源成本：无新增外部依赖。
- 替代方案：
  - 直接做 headless `--root`：拒绝，状态和安全边界会分叉。
  - 暴露完整 LLM Wiki 操作集：拒绝，用户明确不希望开放 init/scan 等操作能力。
  - 只做 query 不做 search：拒绝，用户确认当前版本需要支持 Agent 检索。
- 关键风险：
  - `query` 可能耗时较长，需要确认 socket client thread 同步执行的可接受性。
  - `search` 空结果必须显式输出 `results: []`，不能被现有空 Vec 序列化省略。

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 在现有 `mdx-cli` 中增加窄范围 LLM Wiki 查询/检索能力。
  - 保持 Workspace Mode/socket 模型一致。
  - 保持 CLI 输出可脚本化、对 Agent 友好。
- 总体思路：
  - 在 `mdx-cli` 中新增二级子命令 `llm-wiki`。
  - 在 `CliRequest` 中新增 `LlmWikiQuery` 和 `LlmWikiSearch` 请求。
  - 在 `CliResponse` 中新增 query/search 输出字段。
  - `cli_server` 基于当前 snapshot 的 active workspace root 调用现有 LLM Wiki Rust functions。
- 核心模块：
  - `mdx_cli.rs`：CLI 参数解析、默认输出策略。
  - `cli_protocol.rs`：协议请求/响应字段。
  - `cli_server.rs`：socket dispatch 和 LLM Wiki handler。
  - `llm_wiki.rs` / `llm_wiki_query.rs`：现有查询检索能力。
- 主要难点：
  - 输出格式需要同时兼容纯文本 query 和 JSON query/search。
  - search 空结果需要保留空数组字段。
  - 非 LLM Wiki workspace 的错误判断要清晰。
- 技术指标：
  - 不新增长期后台任务。
  - 不引入新的文件系统写入路径；仅 `query` 沿用现有 `log.md` 写入。

### 3.2 整体架构设计

- 业务模式：用户或 Agent 在终端调用 `mdx-cli`，CLI 通过 socket 请求运行中的 MDX Workspace Mode，由 app 侧 Rust server 使用当前 workspace root 查询 LLM Wiki。
- 系统边界：
  - CLI 不直接读写 arbitrary root。
  - CLI 不控制 Document Mode。
  - CLI 不启动或运行 LLM Wiki ingest pipeline。
- 上下游系统：
  - 上游：终端/Agent 的 `mdx-cli` 命令。
  - 下游：MDX app 的 socket server、LLM Wiki Rust service、本地 LLM provider 配置。
- 应用架构：
  - CLI process 负责参数解析、socket 连接、输出格式。
  - MDX app process 负责 workspace root、路径安全、search/query 执行。
- 技术架构：
  - Unix socket `~/.mdx/cli.sock`
  - JSON line request/response
  - Rust `serde` request/response model
- 数据流转：
  1. `mdx-cli llm-wiki query/search` 解析命令。
  2. CLI 发送 `CliRequest` 到 socket。
  3. `cli_server` 获取 current Workspace snapshot。
  4. server 校验 workspace root 和 LLM Wiki ready 状态。
  5. server 调用 `llm_wiki_search` 或 `llm_wiki_query_sync`。
  6. server 返回 `CliResponse`。
  7. CLI 按命令输出纯文本或 JSON。

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| CLI search | `mdx-cli llm-wiki search <query...>` | mdx-cli, cli_protocol, cli_server, llm_wiki | 参数 join；发送 request；server 获取 root；校验 LLM Wiki ready；调用 search；返回 results | 无 workspace 返回 `no_workspace`；非 LLM Wiki 返回 `llm_wiki_not_ready` | JSON |
| CLI query 文本输出 | `mdx-cli llm-wiki query <question...>` | mdx-cli, cli_server, llm_wiki, LLM provider | 参数 join；调用 query；返回 answer；CLI 只打印 answer | 无上下文 ok + insufficient；LLM 配置/调用失败返回错误 | 纯文本 |
| CLI query JSON 输出 | `mdx-cli llm-wiki query --json <question...>` | 同上 | 同 query，但 CLI 输出完整 JSON | 同上 | JSON |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| CLI 参数解析 | 新增二级子命令 | `llm-wiki query/search`、`--json`、多词 join | clap | 不新增别名 |
| CLI 协议 | 扩展 request/response | 新增 request variant 和 response fields | serde | JSON line |
| CLI server | 执行请求 | current root、ready 校验、调用 service | CliState, llm_wiki | 不影响 UI |
| LLM Wiki service | 查询检索 | 复用 `llm_wiki_search`、`llm_wiki_query_sync` | path_guard, LLM config | 不新增业务算法 |
| 文档和测试 | 对外契约 | README、unit tests、CLI smoke plan | cargo/vitest | 不要求真实 LLM smoke |

### 3.5 新增/调整功能说明

- Rust CLI：
  - 新增 `CommandLine::LlmWiki { command: LlmWikiCommand }`。
  - `LlmWikiCommand::Query { json: bool, question: Vec<String> }`。
  - `LlmWikiCommand::Search { query: Vec<String> }`。
- CLI server：
  - 新增 dispatch 分支。
  - 新增 `handle_llm_wiki_query` 和 `handle_llm_wiki_search`。
- CLI response：
  - 新增 `answer`、`references`、`insufficient_context`、`results`。
  - `results` 对 search 必须即使为空也可输出。
- README：
  - 在 CLI 命令列表中追加 `mdx-cli llm-wiki query [--json] <question...>` 和 `mdx-cli llm-wiki search <query...>`。
  - 明确不包含 init/scan/ingest 等操作类能力。

## 四、详细设计

### 4.1 CLI 参数与输出详细设计

#### 4.1.1 需求内容

- 入口：
  - `mdx-cli llm-wiki query [--json] <question...>`
  - `mdx-cli llm-wiki search <query...>`
- 操作人/调用方：终端用户、Agent、本地自动化脚本。
- 前置条件：MDX app 可通过 socket 访问；当前有 active Workspace Mode；workspace 是 LLM Wiki。
- 输出结果：query answer 或 search results。

#### 4.1.2 方案设计

- 核心逻辑：
  - `<question...>` 和 `<query...>` 使用 `Vec<String>` 收集剩余参数，并以单个空格 join。
  - join 后 trim 为空时，query 返回 `invalid_question`，search 返回 `invalid_query`。
  - `query` 默认纯文本输出 `response.answer`。
  - `query --json` 输出完整 response JSON。
  - `search` 始终输出 JSON。
- 状态流转：不涉及持久状态。
- 数据变更：CLI process 不写本地文件；server 侧 query 沿用 `llm_wiki_query_sync` 写 `log.md`。
- 计算公式：不涉及。
- 幂等设计：search 幂等；query 对 LLM 回答不保证内容幂等，且会追加 query log。
- 权限/越权控制：CLI 不接受 root 参数，只使用 app 当前 workspace root。
- 异常处理：socket 连接失败沿用现有 `io_error`；业务失败输出 JSON 到 stderr 并 exit non-zero。
- 补偿/重试：不涉及。
- 日志与审计：query 写 `log.md`；search 不写。

#### 4.1.3 流程步骤

1. 用户执行 `mdx-cli llm-wiki query/search`。
2. CLI 检查参数非空。
3. CLI 构造 `CliRequest` 并连接 socket。
4. CLI 收到 response。
5. 如果 response.ok=false，输出 JSON 到 stderr，exit 1。
6. 如果 query 且未传 `--json`，输出 answer 到 stdout。
7. 其他情况输出 JSON 到 stdout。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| query 参数为空 | 返回 `invalid_question` | stderr JSON，exit 1 | 无 |
| search 参数为空 | 返回 `invalid_query` | stderr JSON，exit 1 | 无 |
| query 无上下文 | ok + `insufficient_context:true` | stdout answer，exit 0 | query 写 log |
| search 无结果 | ok + `results:[]` | stdout JSON，exit 0 | 无 |
| 使用 paused workspace | 允许执行 | 正常输出 | 无 |

### 4.2 CLI Server 与 Workspace 校验详细设计

#### 4.2.1 需求内容

- 入口：`CliRequest::LlmWikiQuery`、`CliRequest::LlmWikiSearch`。
- 操作人/调用方：`mdx-cli` socket client。
- 前置条件：存在 current Workspace snapshot。
- 输出结果：`CliResponse`。

#### 4.2.2 方案设计

- 核心逻辑：
  - 复用 `current_snapshot(app)`。
  - 若无 snapshot 或 root，返回 `no_workspace`。
  - 对 root 执行 LLM Wiki ready 校验。
  - search 调用 `llm_wiki::llm_wiki_search(root_path, query)`。
  - query 调用 `llm_wiki::llm_wiki_query_sync(root_path, question)`。
- 状态流转：不影响 UI state。
- 数据变更：query 写 `log.md`；search 不写。
- 计算公式：不涉及。
- 幂等设计：search 幂等；query 追加 log。
- 权限/越权控制：
  - 不接收外部 root。
  - 不接收 raw/wiki 输出路径。
  - 不暴露 init/scan/ingest 等写操作。
- 异常处理：
  - 非 LLM Wiki workspace 返回 `llm_wiki_not_ready`。
  - LLM 配置缺失或调用失败沿用现有 `WorkspaceError` 转 CLI error。
- 补偿/重试：不涉及。
- 日志与审计：不新增 server 日志字段；保留现有 CLI error 输出。

#### 4.2.3 流程步骤

1. server 收到 request。
2. `current_snapshot(app)` 找到 focused 或第一个有 snapshot 的 Workspace window。
3. 读取 `snapshot.workspace.root_path`。
4. 校验 LLM Wiki ready。
5. 调用对应 LLM Wiki function。
6. 映射到 `CliResponse`。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| app 启动但无 workspace | `no_workspace` | stderr JSON，exit 1 | 无 |
| 普通 workspace | `llm_wiki_not_ready` | stderr JSON，exit 1 | 无 |
| LLM config 缺失 | 沿用配置错误 | stderr JSON，exit 1 | 无 |
| LLM 调用超时/失败 | 沿用 LLM error | stderr JSON，exit 1 | 无 |
| UI 当前是 Document window | current_snapshot fallback 到 Workspace snapshot；没有则 `no_workspace` | 不切 UI | 无 |

### 4.3 协议与响应模型详细设计

#### 4.3.1 需求内容

- 入口：Unix socket JSON line protocol。
- 操作人/调用方：`mdx-cli`。
- 前置条件：protocol request 可 serde decode。
- 输出结果：兼容现有 `CliResponse`。

#### 4.3.2 方案设计

- 新增 request variants：

```rust
LlmWikiQuery {
    question: String,
}
LlmWikiSearch {
    query: String,
}
```

对应 JSON line：

```json
{"cmd":"llm-wiki-query","question":"raw 目录是什么"}
{"cmd":"llm-wiki-search","query":"raw 目录"}
```

- 新增 response fields：

```rust
answer: Option<String>
references: Vec<WikiSearchResult>
insufficient_context: Option<bool>
results: Option<Vec<WikiSearchResult>>
```

说明：

- `references` 可以沿用空数组省略，也可以在 query JSON 中输出空数组；计划阶段可选择实现细节，但 query `--json` 必须满足文档契约。
- `results` 推荐使用 `Option<Vec<_>>`，使 search 空结果能输出 `"results":[]`，而非被 `Vec::is_empty` 省略。
- `WikiSearchResult` 在 CLI JSON 中使用 `snake_case` 兼容 CLI 顶层风格；其当前 Rust model 是 `camelCase`，计划阶段必须显式决定复用模型时的序列化策略。推荐新增 CLI 专用 search result DTO，字段为 `path/title/snippet`，这些字段在 camel/snake 下相同，无额外风险。

#### 4.3.3 流程步骤

1. CLI command 转换为 protocol request。
2. server dispatch request。
3. service result 转换为 response DTO。
4. CLI 按命令打印。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 旧 CLI 连接新 server | 旧 CLI 不发送新 request | 不受影响 | 无 |
| 新 CLI 连接旧 server | 旧 server parse 失败或 unknown | stderr JSON，exit 1 | 无 |
| 空 results | `results: []` 必须保留 | Agent 可稳定解析 | 无 |

## 五、存储类设计

### 5.1 库表设计

#### 5.1.1 数据库模型图

不涉及。MDX 是本地文件系统应用，本需求不新增数据库。

#### 5.1.2 表结构

不涉及。

字段明细：

不涉及。

### 5.2 数据迁移/初始化

- DDL：不涉及。
- DML：不涉及。
- 数据回填：不涉及。
- 老数据兼容：不涉及。
- 新老系统读写关系：
  - 现有 LLM Wiki 文件结构不迁移。
  - query 继续追加 `log.md`。
  - search 不写任何文件。

### 5.3 缓存设计

不新增缓存。沿用现有 `.llm-wiki/cache.json`，但本期 CLI 不触发 scan/ingest，不更新 cache。

## 六、其他组件设计

### 6.1 消息设计

不涉及。没有新增消息队列。

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| LLM provider config | 本地 app 配置 | 现有默认 | 由现有 LLM config 读取逻辑决定 | query 需要 LLM 配置；search 不需要 | 配置缺失时 query 失败 |

### 6.3 定时任务/批处理

不涉及。CLI 不启动后台 scan/ingest。

### 6.4 技术组件

- 分布式锁：不涉及。
- 唯一 ID：不涉及。
- 加解密/验签：不新增；沿用本地 socket 权限模型。
- 字典转换：需要 request/response DTO 转换。
- Excel/文件处理：不涉及。
- 用户信息透传：不涉及。
- 限流/熔断：不新增；LLM 调用沿用现有 HTTP client 行为。

## 七、接口设计

### 7.1 接口设计原则

- CLI JSON 字段统一 snake_case。
- 查询类空结果不作为错误。
- 操作类 LLM Wiki 能力不暴露到 CLI。
- 非纯查询的数据变更必须明确；本期只有 query 沿用现有 log 写入。
- 错误码和失败条件必须可脚本判断。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 权限/认证 | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|
| `mdx-cli llm-wiki query [--json] <question...>` | 终端/Agent | MDX CLI socket server | 本机 socket | 非严格幂等，写 query log | 本文 | 默认纯文本 |
| `mdx-cli llm-wiki search <query...>` | 终端/Agent | MDX CLI socket server | 本机 socket | 是 | 本文 | JSON 输出 |

### 7.3 接口明细

#### 7.3.1 `mdx-cli llm-wiki query [--json] <question...>`

- 路径/方法：Unix socket `~/.mdx/cli.sock`，JSON line request/response。
- 请求头：不涉及。
- 请求参数：
  - `--json`: optional，输出完整 JSON。
  - `question...`: required，多词 join 后 trim。
- 响应参数：
  - 默认文本：`answer`
  - JSON：

```json
{
  "ok": true,
  "answer": "回答文本",
  "references": [
    { "path": "wiki/concepts/example.md", "title": "example", "snippet": "..." }
  ],
  "insufficient_context": false
}
```

- 错误码：
  - `invalid_question`: question 为空。
  - `no_workspace`: 无 active workspace。
  - `llm_wiki_not_ready`: 当前 workspace 不是 LLM Wiki。
  - 其他沿用 `WorkspaceError`，如 LLM 配置/调用/文件读取错误。
- 业务校验：
  - 只能使用当前 Workspace root。
  - paused 不阻止 query。
- 数据变更：
  - 成功进入 `llm_wiki_query_sync` 后沿用当前行为写入 `log.md`。
- 日志字段：
  - `log.md`: `query <question>`。

#### 7.3.2 `mdx-cli llm-wiki search <query...>`

- 路径/方法：Unix socket `~/.mdx/cli.sock`，JSON line request/response。
- 请求头：不涉及。
- 请求参数：
  - `query...`: required，多词 join 后 trim。
- 响应参数：

```json
{
  "ok": true,
  "results": [
    { "path": "wiki/concepts/example.md", "title": "example", "snippet": "..." }
  ]
}
```

空结果：

```json
{
  "ok": true,
  "results": []
}
```

- 错误码：
  - `invalid_query`: query 为空。
  - `no_workspace`: 无 active workspace。
  - `llm_wiki_not_ready`: 当前 workspace 不是 LLM Wiki。
  - 其他沿用 `WorkspaceError`。
- 业务校验：
  - 只能使用当前 Workspace root。
  - paused 不阻止 search。
- 数据变更：无。
- 日志字段：无。

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：本地 CLI 能力，无服务端灰度。
- 灰度开关：不新增。
- 验证指标：
  - CLI protocol tests 通过。
  - `cargo test` 通过。
  - README 命令说明准确。
- 放量节奏：随桌面 app/CLI binary 发布。

### 8.2 降级方案

- 降级触发条件：新 CLI 命令存在严重错误。
- 降级行为：回滚到上一版本 binary；已有 UI LLM Wiki 功能不受影响。
- 用户影响：仅 CLI query/search 不可用。
- 恢复方式：发布修复版本。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| Workspace Mode CLI | 新增二级命令 | 扩展 protocol/server | Codex/开发者 | cargo tests |
| LLM Wiki UI | 不主动影响 | 无 | Codex/开发者 | 确认 CLI 不发 UI event |
| Document Mode | 不支持 | 无 | Codex/开发者 | 现有 document tests |
| README | 新增说明 | 更新三语 README | Codex/开发者 | 文档 review |

### 8.4 回滚方案

- 回滚条件：CLI 协议导致现有命令回归，或 query/search 输出破坏自动化。
- 回滚步骤：回滚相关 commit。
- 数据回滚：不涉及；query 可能已追加 `log.md`，该用户数据不自动回滚。
- 配置回滚：不涉及。
- 风险：旧 CLI/新 app 或新 CLI/旧 app 混用时新命令不可用，但现有命令应不受影响。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：本地 CLI stderr JSON。
- 业务异常：`error_code`。
- 重试异常：不新增。
- 超时：socket bootstrap 沿用现有 8 秒等待；LLM 请求沿用现有 LLM client 行为。
- 关键接口指标：不新增远程指标。
- 告警渠道：不涉及。

### 9.2 性能与容量

- TPS/吞吐：本地 CLI 低频调用。
- CPU/内存/磁盘 IO/网络 IO：
  - search 读取 wiki markdown，受 wiki 文件数量影响。
  - query 在 search 基础上调用 LLM，受网络和 provider 延迟影响。
- 数据容量：不新增持久数据；query 追加 log。
- 缓存容量：不新增缓存。
- 跑批耗时：不涉及。
- 是否压测：不需要，单机本地功能。

### 9.3 可靠性与兜底

- 幂等击穿：search 幂等；query 追加 log，不保证严格幂等。
- 并发失效：多个 CLI query 可能同时写 log，沿用现有 `append_log_entry` 文件写策略；计划阶段需要确认是否已有安全写保障。
- 冷热备：不涉及。
- 兜底：
  - search 可在无 LLM 配置时工作。
  - query 无上下文返回 insufficient，而不是失败。

## 十、排期与规划

### 10.1 建议拆分

1. 协议和 CLI 参数扩展：新增 request/response、子命令解析、输出策略测试。
2. Server handler：current root、LLM Wiki ready 校验、query/search 调用和错误映射。
3. 文档和 smoke 验证：README 更新、cargo test、CLI smoke 说明。

### 10.2 Planning Handoff

`plan` 可以直接决定：

- `CliResponse` 中 `references/results` 的具体 Rust 类型和 serde skip 策略。
- `llm_wiki_not_ready` 校验是直接调用 `detect_llm_wiki_workspace`，还是检查必要路径后转换错误。
- 是否新增 helper 将 `WorkspaceError` 映射到 `CliResponse`。
- 具体测试文件和测试用例组织。

必须回到 `clarify` 或 `spec` 的情况：

- 要新增 headless / `--root`。
- 要暴露 init、scan、ingest、lint、graph、digest。
- 要让 CLI 影响 UI 状态。
- 要改变 query 写 `log.md` 的行为。
- 要新增别名或顶层命令。
- 要引入 ranking、limit、stdin、流式输出。

## 十一、QA

### 11.1 测试策略

- Rust unit tests：
  - `CliRequest` 能 parse/serde `llm-wiki-query`、`llm-wiki-search`。
  - `mdx-cli` 参数解析支持多词 join。
  - query 默认文本输出只打印 answer。
  - query `--json` 输出 snake_case JSON。
  - search 空结果输出 `results: []`。
  - 非 LLM Wiki workspace 返回 `llm_wiki_not_ready`。
  - 无 workspace 返回 `no_workspace`。
- Existing regression：
  - 现有 CLI open/list/content/insert/save/close tests 不回归。
  - LLM Wiki search/query tests 不回归。
- Manual smoke：
  - 打开 LLM Wiki workspace 后执行 `mdx-cli llm-wiki search <term>`。
  - 配置 LLM 后执行 `mdx-cli llm-wiki query <question>`。

### 11.2 验证命令

```bash
cargo test
npm test -- --run features/llm-wiki/lib/llm-wiki-client.test.ts
npm run lint
npm run build
```

如本期没有前端代码变更，计划阶段仍可保留 `npm run lint` / `npm run build` 作为集成验证。

### 11.3 验收标准

- `mdx-cli llm-wiki query raw 目录是什么` 在 LLM Wiki workspace 中输出 answer 文本。
- `mdx-cli llm-wiki query --json raw 目录是什么` 输出 snake_case JSON。
- `mdx-cli llm-wiki search raw 目录` 输出 snake_case JSON 和 results。
- 空 search 输出 `results: []` 且 exit 0。
- 普通 workspace 返回 `llm_wiki_not_ready`。
- CLI 不触发 init/scan/ingest/lint/graph/digest。
- CLI 不改变 UI 状态。
