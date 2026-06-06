# Karpathy 风格 LLM Wiki 改造澄清上下文

## Intent And Desired Outcome

用户明确要求把当前 MDX 的 LLM Wiki 范围扩大，做“最贴近 Karpathy 的 LLM Wiki 的实现”。目标不是修补现有 `search_wiki_pages` 的关键词匹配，而是让 MDX 的 LLM Wiki 子系统接近以下工作方式：

- `raw/` 是 immutable facts source，query time 不从 raw documents 重新 RAG。
- `wiki/` 是 LLM 持续维护、整理、交叉引用和综合过的 Markdown wiki。
- `AGENTS.md` 是 schema/rules，约束 LLM 像 wiki maintainer，而不是 generic chatbot。
- 核心操作为 `ingest / query / lint`，并保留 MDX 已有 `digest/综述` 作为把 query 综合沉淀为 `wiki/syntheses/*.md` 的显式入口。

## In Scope

- Schema：
  - 强化默认 `AGENTS.md`，定义页面类型、稳定链接规范、引用规范、index/log 职责、ingest/query/digest/lint 工作流。
- Ingest：
  - LLM 自动写入 wiki 页面。
  - 一个 raw source 可以更新多个页面：`wiki/sources/*`、`wiki/entities/*`、`wiki/concepts/*`、`wiki/syntheses/*`、`index.md`、`log.md`。
  - Ingest 必须读取 raw source、`purpose.md`、`AGENTS.md`、`index.md`、以及由 index/wiki-aware retrieval 定位出的相关既有 wiki pages。
  - Ingest 生成 source summary，并更新/合并 entity、concept、synthesis、index、log。
- Query：
  - 禁止 query-time raw RAG。
  - 先读 `index.md`，让 LLM 选择相关 wiki page paths。
  - 后端读取这些 pages，并顺着 wikilinks 扩展一跳。
  - 基于整理过的 wiki pages 综合回答并带引用。
  - Query 默认只写 `log.md`，不自动写回 wiki 页面。
- Digest/综述：
  - 作为显式沉淀入口，把一次综合写成 `wiki/syntheses/*.md`。
  - Digest 使用与 query 相同的 index-driven page selection 和 wikilink expansion。
  - 成功后更新 `index.md` 和 `log.md`。
- Lint：
  - 机械 lint 永远可运行。
  - LLM lint 在有 LLM 配置时运行。
  - 输出断链、孤儿页、index 缺失、backlink 缺失、source provenance 缺失、链接格式问题、潜在矛盾、过时陈述、重复页面、重要概念缺页、进一步调查问题。
- CLI：
  - 扩展 CLI，不只保留 query/search。
  - 第一版至少覆盖 `status`、`ingest`、`query`、`digest`、`lint`、`search`。
- UX：
  - Query/digest/ingest 的 LLM 阶段需要前端阶段状态。
  - 解决“正在查询”黑箱体验。
  - LLM timeout 从当前 600 秒降到 60-120 秒区间。
  - 支持取消长时间运行的 query/digest/ingest。

## Non Goals

- 第一版不做 query-time raw document RAG。
- 第一版不要求 hybrid BM25/vector/rerank。中等规模 wiki 先以 `index.md` 为导航入口。
- Query 默认不把每个回答自动写成新 wiki 页面。
- 不把每次 ingest 做成人工 diff 确认流程。人通过阅读 wiki、看 log、跑 lint 审阅。
- 不重写整个编辑器或工作区文件系统。

## Decision Boundaries

- 用户已确认：范围包含 schema、ingest、query、digest、lint 五块。
- 用户已确认：ingest 接受自动写入 wiki，多页面更新允许。
- 用户已确认：query 不默认自动写回 wiki；沉淀通过显式 digest/综述。
- 用户已确认：query/digest 接受两阶段 LLM 调用。
- 用户已确认：页面路径继续用 ASCII slug，正文 wikilink 使用稳定路径加 alias，例如 `[[entities/karpathy|Karpathy]]`。
- 用户已确认：lint 包含机械 lint 和可选 LLM 语义 lint。
- 用户已确认：CLI 纳入本次范围。
- 用户已确认：阶段状态、较短 timeout、取消能力纳入本次范围。

## Constraints

- 当前工作区已有未提交改动，不能回滚用户或既有改动。
- 当前 LLM HTTP timeout 是 600 秒，且 chat 模式走 streaming fallback。长时间“正在查询”通常是后端 LLM 请求未返回。
- 当前 `search_wiki_pages` 是完整 query 字符串 `line.contains(query)`，与目标设计冲突。
- 当前 `llm_wiki_query_sync` 和 `llm_wiki_digest_sync` 都依赖 `search_wiki_pages`。
- 当前前端和 CLI 都调用同一个 Rust 后端服务，正确改造点应在 Rust 后端公共上下文构建层。
- 当前生成路径安全规则偏向 ASCII slug，用户确认继续使用 ASCII slug。

## Success Criteria

- Query：
  - 对自然语言问题不再用整句 `contains` 做上下文查找。
  - 后端先读 `index.md`，选择相关 wiki pages，再生成回答。
  - 回答 references 指向实际读取的 wiki pages。
  - 无上下文时说明 index/wiki 中没有足够上下文，而不是 raw 中无匹配。
  - Query 写 `log.md`。
- Digest：
  - 使用 index-driven context。
  - 成功写 `wiki/syntheses/<slug>.md`，更新 `index.md` 和 `log.md`。
- Ingest：
  - 读取已有 index/wiki context 后再生成/合并页面。
  - 支持一个 raw source 更新多个 wiki 页面。
  - source/entity/concept 页面包含来源信息或可追溯引用。
- Lint：
  - 机械 lint 可在无 LLM 配置下运行。
  - LLM lint 可在有配置时输出语义问题。
- CLI：
  - `mdx-cli llm-wiki` 覆盖 status/ingest/query/digest/lint/search。
- UX：
  - 长操作可见阶段、可取消、超时合理。
- 验证：
  - Rust 单元测试覆盖 selection、wikilink expansion、query/digest、lint、CLI。
  - 前端测试覆盖阶段状态和取消。
  - `npm run lint`、`npm run test`、`cd src-tauri && cargo test`、`npm run build` 通过。

## Brownfield Evidence

- `src-tauri/src/llm_wiki_query.rs`
  - `search_wiki_pages` 遍历 `wiki/` 下 Markdown。
  - `matching_line` 当前使用 `line.contains(query)`。
  - `write_digest_page` 写 `wiki/syntheses/<title>.md` 并更新 `index.md`、`log.md`。
  - `mechanical_lint_report` 主要检查断链。
- `src-tauri/src/llm_wiki.rs`
  - `llm_wiki_query_sync` 直接调用 `search_wiki_pages(&root, &question)`。
  - `llm_wiki_digest_sync` 直接调用 `search_wiki_pages(&root, &format!("{title}\n{prompt}"))`。
  - `build_query_context` 当前只读取 search results 前 8 个页面。
  - `llm_wiki_search` 当前也复用 `search_wiki_pages`。
- `src-tauri/src/llm_wiki_ingest.rs`
  - ingest prompt 已读 raw、purpose、AGENTS、index。
  - generation prompt 允许输出 source/entity/concept/synthesis/index/log/progress 文件块。
  - parser 和 writer 有路径白名单和 cache/log 写入。
  - 当前没有成熟的“从 index 选择相关既有页面再 merge”的上下文层。
- `src-tauri/src/llm_wiki_fs.rs`
  - 默认初始化 `raw/`、`wiki/`、`index.md`、`log.md`、`purpose.md`、`AGENTS.md`、`llm-wiki-progress.md`、`.llm-wiki/*`。
  - `DEFAULT_AGENTS_MARKDOWN` 已有基础 schema，但不够严格。
  - graph builder 已能扫描 wikilinks。
- `src-tauri/src/llm_wiki_llm.rs`
  - `LLM_REQUEST_TIMEOUT_SECS` 当前为 600。
  - chat mode 优先 streaming，再 fallback non-stream。
- 既有设计文档 `docs/loopx/design/MDX本地优先LLMWiki工作区需求设计文档.md` 已描述完整 LLM Wiki 方向，但当前实现未完全达到。

## Inferences

- 当前“提问一直正在查询”更可能是后端 LLM request 未 resolve/reject，而不是 React state 本身错误。
- 最小但方向正确的 shared abstraction 应是 `WikiContextSelector` 或等价模块，由 query、digest、ingest 共用。
- 为了保持安全和可测，应让 LLM page selection 输出严格 JSON paths，后端校验 paths 后再读文件。
- LLM lint 可以先作为报告型能力，不自动修改 wiki，避免语义修复造成不可控写入。

## Rejected Alternatives

- 只把 `line.contains` 换成 token search：仍然不是 Karpathy 的 index-first wiki navigation。
- Query-time raw RAG：违背用户明确要求和 Karpathy 风格。
- 每次 query 自动写 wiki：会污染 wiki，用户已接受显式 digest。
- 每次 ingest 人工确认 diff：与 LLM 作为 wiki maintainer 的核心不符，用户接受自动写入。
- 第一版直接做 vector/rerank：复杂度高，且中等规模应先以 `index.md` 导航。

## Residual Risks

- 两阶段或多阶段 LLM 调用会增加延迟，需要阶段状态、取消、timeout 控制。
- LLM 选页 JSON 可能格式错误，需要 parser、fallback、错误提示。
- ASCII slug + alias 链接会让 prompt 更严格，否则 LLM 可能继续生成 `[[中文标题]]` 或 `[[Karpathy]]`。
- Ingest 自动合并 entity/concept 页面可能覆盖重要人工编辑，需要安全写入、日志和 lint。
- LLM lint 语义判断可能误报，第一版应报告而不自动修复。

## Conversation Summary And Important User Wording

- 用户指出当前实现肯定有问题，并关心 Karpathy 的 LLM Wiki 原始设计应如何落地。
- 用户要求：“我需要把范围扩大，做最贴近Karpathy 的 LLM Wiki的实现”。
- 用户确认范围包含 schema、ingest、query、digest、lint。
- 用户确认 ingest 自动写入、query 不默认自动沉淀、两阶段 LLM、稳定路径 wikilink、分层 lint、CLI、阶段状态/超时/取消。

## Handoff Recommendation

`needs_spec`

原因：这是跨后端服务、CLI、前端状态、schema 文档、LLM prompt、文件契约和测试策略的架构改造，需要先写设计文档，再进入实施计划。
