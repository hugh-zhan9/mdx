---
source: docs/loopx/design/2026-08-17-memory-engine-adoption/详细设计.md
status: done
slices:
  - id: P-001
    status: done
    depends: []
  - id: P-002
    status: done
    depends: [P-001]
  - id: P-003
    status: done
    depends: [P-002]
  - id: P-004
    status: done
    depends: [P-002]
  - id: P-005
    status: done
    depends: [P-003]
  - id: P-006
    status: done
    depends: [P-004, P-005]
  - id: P-007
    status: done
    depends: [P-003]
  - id: P-008
    status: done
    depends: [P-006, P-007]
  - id: P-009
    status: done
    depends: [P-008]
---

# 记忆引擎迁移到 mempal 实施计划

## Goal And Boundaries

交付一个建立在 mempal library crate 之上的记忆功能：素材（evidence）与结论（knowledge）两层，全局单库 `~/.mdx/memory/palace.db` 按 wing 区分工作区，混合检索（BM25 + 向量 + RRF）、按分级组装的运行时上下文、以及有门禁和审计的结论生命周期。完成后编辑器的其它能力——文件树、标签、编辑、LLM Wiki、导出——行为不变。

设计已经定死的结论，执行期间不重新讨论：

- 依赖 crates.io 的 `mempal-runtime`（默认 features 已含 model2vec，并 re-export 了 store-sqlite / agent-memory / embed 所需的一切），**不 fork、不 vendor、不改上游**。需要改上游才能做到的事，先提 issue，不在本仓库打补丁。
- inbox（待确认）、working context、Markdown projection 三个概念**抛弃**，不映射、不留别名、不做兼容垫片。
- 记忆只有 SQLite 一个后端；PostgreSQL 后端、存储迁移界面、`postgres` crate 依赖一并删除。
- 结论提升走「蒸馏时自动挂支持证据 + 采纳时写人工确认作为验证证据」，`enforce_gate` 恒为 true，`allow_counterexamples` 恒为 false，不做批量采纳。
- 嵌入模型首次使用时由用户确认后下载；模型不可用时记忆写入整体 fail fast，不降级成关键词模式，不写零向量。
- 旧数据不做 schema 迁移：旧 `<workspace>/memory/**` 原地只读保留，只提供一次性的「导入为素材」，且 inbox 与 working.md 不导入。
- 产品界面不出现上游名称；`dao/shu/qi` 分级不上界面，界面词汇是「素材 / 结论」。

执行边界与已知的中间态：

- **模块路径要先腾出来。** `src-tauri/src/memory.rs` 与 `memory/mod.rs` 不能共存（E0761），所以 P-002 先把它整体搬成 `memory/legacy.rs` 并在新的 `mod.rs` 里 `pub use legacy::*;`。调用方写法不变，新旧实现从此在同一目录里各占各的文件，P-009 删 `legacy.rs`。
- 对外协议（Tauri 命令、CLI、MCP 工具、已安装的 agent 技能文本）是一次明确的破坏性变更。P-006 之后旧命令消失，P-008 之前面板尚未改完，**这段区间应用不可发布**。计划内不发版。
- 新旧两套实现会在 P-002 到 P-009 之间同时存在于源码树中，但**任何时刻只有一套接到界面和对外协议上**。因此「仓库里还搜得到 `memory_inbox`」在 P-009 之前是预期状态，不构成任何一片的失败判据。
- **详细设计 9.5 的 CLI / MCP 工具清单按草案执行。** 该清单两次提请确认未获单独裁决，而用户在 2026-08-17 授权「全部做完之后再报告」，据此按草案推进：清单是已裁决口径（协议破坏性变更、删除 inbox/working 概念）的机械推导，且尚未发布，撤销成本仅限改名。最终报告须显式标注这一假设。
- 界面词汇（「素材 / 结论」）、嵌入模型实际体积与是否降级到 `potion-base-8M`、是否启用上游 Phase-2 knowledge card，三项仍未裁决。它们不改变本计划的结构；执行期间若需要定，走 `spec` 记录。
- Git 纪律：任何提交、推送、合并都要用户明确要求。

基线（2026-08-17 采集，执行期间不得把基线问题当作已知豁免）：

- 前端 `npx vitest run`：129 个 test files、1524 个 tests 全部通过。
- `cargo test -p mdx`：553 + 36 + 17 通过，0 失败，1 ignored。
- `cargo test -p pdf-core -p font-core` 全部通过；`cargo check -p mdx` 除既有 dead_code 警告外干净。

引入 mempal **之前**的体积与构建基线（P-001 完成时采集，`cargo build --release -p mdx`，依赖缓存已热）：

| 项 | 值 |
|---|---|
| `target/release/mdx` | 25,780,672 B |
| `target/release/mdx-cli` | 13,339,760 B |
| `target/release/mdx-mcp` | 11,671,392 B |
| release 重建耗时 | 80.6 s（real） |

引入 mempal **之后**：

| 项 | 引入前 | P-002 后 | 全部完成后 | 总增量 |
|---|---|---|---|---|
| `target/release/mdx` | 25,780,672 B | 25,912,608 B | 32,043,088 B | +6.26 MB |
| `target/release/mdx-cli` | 13,339,760 B | 13,436,640 B | 18,611,392 B | +5.27 MB |
| `target/release/mdx-mcp` | 11,671,392 B | 11,770,352 B | 16,597,824 B | +4.93 MB |

P-002 之后只 +129 KB，是因为那时只用到了开库和 embedder；真正把 ingest / search / context / knowledge / brief 都接上之后涨到 +6.26 MB。这是同时删掉了自研存储、索引、PostgreSQL 后端和 6279 行测试之后的净增量。参照点：rusqlite 0.32 → 0.37 本身约 +467 KB。

## P-001 依赖与工具链前置

把 `rusqlite` 从 0.32 升到 0.37、`rust-version` 从 1.77.2 抬到 1.85，并确认 mempal 的 crate 真的能从 crates.io 解析下来。这一片不引入记忆行为改动——它单独存在是因为 `libsqlite3-sys` 声明了 `links = "sqlite3"`，同一依赖图里不允许两个版本，所以升级是准入条件而不是重构。

影响面是三个文件里的 39 处 `rusqlite::` 调用：`search_index.rs`（3 处）、`memory_storage_sqlite.rs`（15 处）、`memory_tests.rs`（21 处）。注意这三个都属于记忆层，工作区搜索是 `workspace_search.rs`，一行 rusqlite 都没有，本片不碰它。这也意味着本片的 API 适配工作在 P-009 会随文件一起删除，唯一长期留存的是两处版本号——照做即可，它是让依赖装进来的通行费。

同时把「引入 mempal 之前」的体积与冷编译基线量下来（`cargo build --release` 的产物大小与耗时），否则 P-002 之后就再也测不到「前」了。

完成条件是：升级前后的测试结果逐项一致，没有任何断言为迁就新 API 被放宽；`cargo tree` 里 `libsqlite3-sys` 只有一个版本；`cargo add --dry-run mempal-runtime@0.9` 能解析到 crates.io 上的真实版本；体积与耗时基线已记录。

> writes: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/search_index.rs`, `src-tauri/src/memory_storage_sqlite.rs`, `src-tauri/src/memory_tests.rs`
> anchors: 详细设计「二、依赖与工具链前置」三行（rusqlite、MSRV、体积实测的「前」半边）
> verify: `cargo test -p mdx`（与基线逐项比对）；`cargo clippy -p mdx --all-targets`；`cargo tree -p mdx -i libsqlite3-sys` 单版本；`cargo add --dry-run mempal-runtime@0.9`
> review: 独立检查是否有测试为迁就新 API 而放宽断言、SQL 行为是否被无意改变

## P-002 引擎骨架：腾模块路径、开库、绑定、模型、诊断

先把 `src-tauri/src/memory.rs` 搬成 `memory/legacy.rs`（`git mv` + 新 `mod.rs` 里 `mod legacy; pub use legacy::*;`），让 `memory/` 目录成立且现有调用方一行不改。然后建 `engine.rs`、`embedder.rs`、`config.rs` 与 `models/` 目录，让应用能打开 `~/.mdx/memory/palace.db`、认得当前工作区属于哪个 wing、知道嵌入模型在不在、并能报出一份诊断。这一片不写入任何记忆数据，只把地基和失败模式立起来。

`models/` 按后续切片的领域预先建好空模块（`evidence.rs` / `knowledge.rs` / `retrieval.rs` / `legacy_import.rs`）并在 `models/mod.rs` 里声明，这样 P-003 到 P-007 各自只写自己那一份，不会四片抢同一个文件。`memory/mod.rs` 里同样把后续模块声明一次到位。

engine 提供进程内单例（`Mutex<Database>`），所有后续读写排队通过；打开时校验 schema 版本与向量维度，不匹配就进只读并明确报错，绝不自动迁移。wing 绑定按工作区绝对路径记在 `~/.mdx/memory/wings.json`，路径查不到时新建，改名或移动后提供显式重绑而不是自动认亲。embedder 按「本地三件文件齐全 → 零网络；不齐全 → `embedding_model_missing`」解析，下载是用户确认后的显式动作，下到临时目录校验齐全再原子移入；维度变化时提供可中断、有进度的全量重嵌（`recreate_vectors_table` + 逐条重嵌）。配置按详细设计第十一节拆成全局与每工作区两份，读到 v2 配置时按新默认重建并留 `.v2.bak`。

完成条件是：`cargo build` 通过且现有命令行为不变（搬家没有语义改动）；库不可写时记忆整体停用而编辑器不受影响；schema 不兼容时进只读且提示明确；同一工作区重复打开得到同一个 wing，改名后不会静默分裂、需要显式重绑；没有模型时构造 embedder 返回 `embedding_model_missing`；诊断能给出库状态、模型状态、失效的项目绑定，且不泄漏上游命令行工具的名字与建议。依赖与许可写进 `THIRD_PARTY_NOTICES`。

两件事本片交付实现但不在本片验收：并发写只产生一条 drawer 需要写入路径（P-003 验收），维度不一致后的重嵌恢复需要真实下载模型（集成验证走查覆盖）。

> writes: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/memory.rs`（移动到 `memory/legacy.rs`）, `src-tauri/src/memory/**`, `src-tauri/src/lib.rs`, `src-tauri/src/assets.rs`（`mdx_home_dir` 改为 `pub(crate)` 供记忆层复用，不再抄第三份）, `THIRD_PARTY_NOTICES`
> anchors: 详细设计「一、模块结构」含 `memory.rs` 让路与依赖块、「三、存储与初始化」、「四、嵌入模型」含 4.3 重嵌、「十一、配置」；错误码 `memory_unavailable` / `schema_incompatible` / `embedding_model_missing` / `embedding_dim_mismatch` / `wing_unbound`
> verify: `cargo test -p mdx`；`cargo clippy -p mdx --all-targets`；构建产物中不含模型文件；`cargo tree -p mdx | grep mempal` 只出现一条直接依赖
> review: 独立检查搬家是否引入语义改动、是否存在未经用户确认的网络请求、是否有自动 schema 迁移或自动重绑的隐式行为

## P-003 写入路径与捕获管道

把素材写进库里。三个入口——文件、目录、纯文本——全部落在 `evidence.rs`，字段取值严格按详细设计第五节那张表。文本入口需要自己拼装 drawer，因为上游没有把「从字符串写一条素材」做成 runtime API：算内容寻址的身份、拿 per-source 锁、查重、构造、覆盖锚点、嵌入、入库，顺序固定。

锚点是这一片最容易做错的地方：`ingest_file*` 内部写死 `repo://legacy`，改不了也不必改（上下文组装的锚点链有 legacy 兜底）；但我们自己写的会话转录与人工确认记录必须显式覆盖成 `worktree://<工作区绝对路径>`，否则 `list_projects()` 报不出项目路径。room 的取值规则（首段目录 / `root` / `session` / `review`）也在这一片落地。

`capture/` 交付**终点与闸门**：一个把会话转录写成素材的入口，以及「未启用 / 未列入白名单就什么都不做」的判定。捕获默认关闭，只接受用户显式列出的 agent。同时提供 soft-delete 与彻底清除两个入口——素材一旦进库只能事后删除，这是抛弃 inbox 的直接后果，兜底手段必须同批交付。

hook → spool → queue 这几个**入口**留到 P-006 一起改。它们是被 CLI 命令拉起来的，而那套命令 P-006 才重画；现在就把入口切过来，会出现「hook 写新库、其余记忆还写 Markdown」的半切换状态，正好违反本计划「任何时刻只有一套接到对外协议上」的边界。

完成条件是：同内容同来源写两次只有一条，两个线程并发写同一内容也只有一条；三个入口都带 `source_file` 且 room 符合规则；自己写的条目锚点是 worktree 且 `list_projects()` 能报出路径；捕获关闭时 hook 不写库、不写 spool、不排队；没有模型时写入失败且不留残条；soft-delete 后检索不再命中，purge 后条目消失。

> writes: `src-tauri/src/memory/evidence.rs`, `src-tauri/src/memory/capture/**`, `src-tauri/src/memory/models/evidence.rs`
> anchors: 详细设计「五、领域模型」含 5.1 内容模板、「六、写入路径」含 6.1 捕获与 6.2 锚点、「三、存储与初始化」3.2 的 room 规则、「十四、测试」中的并发写用例；错误码 `memory_busy`
> verify: `cargo test -p mdx memory::evidence memory::capture`；用真实工作区跑一次目录导入并确认 `list_projects()` 的 `path` 非空
> review: 独立检查身份计算与锁顺序是否与上游 MCP 的写入路径一致、捕获白名单是否真的默认为空、删除入口是否覆盖软删与彻底清除

## P-004 读取路径：检索、上下文、摘要、recall

把四个读取面接出来：`search`（混合检索，结果带 `drawer_id` 与 `source_file`）、`context`（按 `dao_tian → dao_ren → shu → qi` 组装，`dao_tian` 预算默认 1）、`brief`（确定性摘要）、以及三者组合成的 `recall`。

`recall` 保留原名但换掉返回体：不再有 `working` 与 `threads` 字段，改为 `context` + `brief` + `hits`。这不是给被删概念留别名——「给我这个任务需要的上下文」这件事没变，变的是实现。但它确实是一次**公开契约变更**：已经装在用户机器上的 agent 技能文本按旧返回体写的，所以这一片的 diff 要独立复核。检索参数默认值取自全局配置。

完成条件是：检索结果每条都能追回源文件；上下文包里 `dao_tian` 条目不超过预算；`include_cards` 默认关闭；`recall` 的返回体里不存在 `working` 与 `threads`；库为空时四个面都返回空结果而不是报错。

> writes: `src-tauri/src/memory/retrieval.rs`, `src-tauri/src/memory/models/retrieval.rs`
> anchors: 详细设计「八、读取路径」全部四个命令与默认值
> verify: `cargo test -p mdx memory::retrieval`；对同一 query 比对 search 与 context 的引用一致性
> review: 独立检查 `recall` 返回体变更是否与技能文本、CLI、MCP 三处的消费方一致，是否残留 `working` / `threads` 的兼容字段

## P-005 结论生命周期：蒸馏、门禁、采纳、降级、反例

交付结论从候选到采纳的完整链路。蒸馏把选中的素材作为支持证据建一条候选结论；采纳时先写一条人工确认记录（固定模板，含时间、确认人、结论 id、被复核的证据）作为验证证据，再带着它调提升，`enforce_gate` 为 true。门禁失败时把上游 `GateReport.reasons` 原样返回，不改写、不吞掉。降级必须带证据引用，反例通过独立入口写入并挂到结论上。

不做批量采纳。一次一条，每条留一条确认记录——门禁在这个方案里已经退化成记账，批量会让记账也失去意义。

实现时撞上两处上游约束，设计据此修正：`prepare_distill` 只接受 `qi` 与 `dao_ren`，**`shu` 建不出来**（`knowledge_distill.rs:249`），所以结论只有「具体」（qi）和「规律」（dao_ren，门槛 ≥2 条支持证据）两档；降级的 `reason_type` 必须是 `contradicted / obsolete / superseded / out_of_scope / unsafe` 之一（`knowledge_lifecycle.rs:223`），退役时要选一个，这反而是该记进审计的信息。

完成条件是：蒸馏产出的候选自动带上支持证据；采纳一次点击即通过门槛并在库里留下确认记录与审计事件；挂上反例后同一条结论提升被拒且理由可读；降级不带证据时被拒；未提升的候选不出现在 `context` 结果里。

> writes: `src-tauri/src/memory/knowledge.rs`, `src-tauri/src/memory/models/knowledge.rs`
> anchors: 详细设计「七、提升路径」含 7.1 反例入口；错误码 `gate_failed` / `invalid_evidence_ref`
> verify: `cargo test -p mdx memory::knowledge`；一条端到端用例走完素材 → 蒸馏 → 采纳 → 出现在 context → 记反例 → 降级
> review: 独立检查人工确认记录是否真实可追溯（不是为了过门槛编造的空记录）、`enforce_gate` 是否存在被绕过的路径、批量采纳是否真的没有后门

## P-006 对外协议：Tauri 命令面、CLI、MCP、agent 技能文本

按详细设计第九节重画对外契约：Tauri 命令按 9.1/9.2/9.3 收敛，CLI 与 MCP 按 9.5 收敛。`lib.rs` 里的 `registers_complete_memory_command_surface` 测试同步改成新清单——它是这次删除的守门人；`cli_protocol_tests.rs` 里对旧 variant 的引用同批更新。安装到用户机器上的 agent 技能文本整体重写。

三个面不要求命令一一对应：Tauri 面向界面，会有 `memory_projects`、`memory_model_download` 这类界面专用命令；CLI 与 MCP 面向 agent。要求一致的是同名命令语义相同、被删概念在三处都不存在。命名冲突按设计处理：`memory_promote` 继续表示「结论转成 Wiki 素材」，知识提升叫 `memory_adopt`。`memory_config_set` / `memory_config_update` 是现有命令名，不要发明 `memory_config_get`。

删掉的工具不留别名。升级后没有重跑技能修复的用户，其 agent 会调到不存在的工具——发布说明要写明这是破坏性变更，`memory_integration_status` 要能识别旧技能文本并提示重装。

完成条件是：新清单在 Tauri、CLI、MCP 三处按 9.5 落地；三个协议**新增的表面**里搜不到被删概念（旧实现文件此时仍在，整仓 grep 归 P-009 判定）；技能文本里不再出现 `memory_working_get` / `memory_inbox_add`；`mdx-mcp --workspace` 能起来并暴露新工具；旧技能文本能被检测出来；前端的命令面契约测试覆盖「新清单存在、旧清单消失」。

> writes: `src-tauri/src/lib.rs`, `src-tauri/src/cli_protocol.rs`, `src-tauri/src/cli_protocol_tests.rs`, `src-tauri/src/cli_server.rs`, `src-tauri/src/bin/mdx_mcp.rs`, `src-tauri/src/bin/mdx_cli.rs`, `src-tauri/src/memory/mod.rs`, `src-tauri/src/memory/agents.rs`, `src-tauri/src/memory/wiki_promote.rs`, `features/memory/lib/memory-client.ts`, `features/memory/lib/memory-client.test.ts`
> anchors: 详细设计「九、Tauri 命令面」9.1/9.2/9.3/9.4 与「9.5 CLI 与 MCP 的新工具集」；「十二、错误码」在命令层的暴露；「十四、测试」中的前端命令面契约测试
> verify: `cargo test -p mdx`；`npx vitest run features/memory/lib`；`grep -rn "memory_inbox\|memory_working" src-tauri/src/lib.rs src-tauri/src/cli_protocol.rs src-tauri/src/bin src-tauri/src/memory/agents.rs` 无结果；手动起一次 `mdx-mcp` 确认工具列表
> review: 独立检查是否残留兼容别名或静默降级、错误码是否在三个协议面上一致、技能文本是否还在教 agent 用已删除的工具

## P-007 数据进出：旧数据导入与导出包

两件事共用一套「库 ↔ Markdown」的渲染与解析，所以放在一片。

旧数据导入是「预检 / 执行」两步：扫描 `<workspace>/memory/**`，报告将导入多少条 memories 与 threads、跳过多少 inbox 条目、working.md 是否存在，然后逐文件导入为素材。旧目录原地不动，只读保留。导入结果是**素材，不是结论**，报告必须把这句说清楚，并给出按时间排序的前若干条方便用户挑值得蒸馏的内容。

导出／导入包（`memory_bundle.rs`）从「打包 Markdown 目录」改写成「从库渲染成 Markdown 包」，反向导入按同一份渲染格式解析。它今天依赖 `memory_fs::ensure_memory_ready`，而那个文件在 P-009 整体删除，所以没有原样存活的可能。全局单库损坏时导出包是用户唯一的备份手段，这一片决定了那条退路是否真的存在。

完成条件是：预检数字与实际导入数一致；重跑幂等；单文件失败不影响其余并出现在报告里；inbox 与 working.md 确实没有进库；报告落到 `~/.mdx/memory/import-reports/`；导出的包能被导入回一个空库并得到同样的素材与结论集合。

> writes: `src-tauri/src/memory/import_legacy.rs`, `src-tauri/src/memory/bundle.rs`, `src-tauri/src/memory/models/legacy_import.rs`
> anchors: 详细设计「十、旧数据导入」、「九、Tauri 命令面」9.1 中的导出／导入包重写、「十五、删除清单」中 `memory_bundle.rs` 的改写要求；错误码 `legacy_import_failed`
> verify: `cargo test -p mdx memory::import_legacy memory::bundle`；对一个真实的旧记忆工作区跑预检 + 导入 + 重跑，比对三次结果；导出后导入空库做一次往返
> review: 独立检查是否有任何路径会修改或删除旧目录、跳过规则是否与设计一致、往返是否丢字段

## P-008 面板改造

把记忆面板接到新契约上：概览、素材、结论、本次上下文、Agent 集成、诊断六个 tab，数据来源与动作按详细设计第十三节。「待确认」tab 删除，其角色由「结论」里的候选态承担；「会话」并入「素材」；「工作上下文」变成只读的上下文预览。设置页里的「迁移预检 / 开始迁移」两步流程与它的存储后端选择一并移除。

结论 tab 是这一片的重点：按状态分组，采纳按钮旁边显示门禁报告，失败时把理由原样呈现，降级与记反例各有入口。视觉沿用现有主题与共享控件，不做新的设计语言。同时补上详细设计要求的边界测试：扫描 `features/memory` 的 DTO，禁止上游类型与词汇泄漏。

完成条件是：六个 tab 各自的空态、加载态、错误态都能显示；采纳流程在失败时回滚乐观更新并显示门禁理由；面板与设置页里不出现 wing / drawer / dao_tian 这类上游词汇；旧的 inbox 与 working 相关组件、状态、设置项全部移除；边界测试存在并通过。

> writes: `features/memory/**`, `features/workspace/components/settings-button.tsx`, `features/workspace/components/settings-button.test.tsx`, `features/workspace/components/workspace-shell.tsx`, `features/workspace/lib/workspace-views.ts`
> anchors: 详细设计「十三、面板契约」、「五、领域模型」中「分级不上界面」、「一、模块结构」与「十四、测试」中的依赖边界测试
> verify: `npx vitest run features/memory features/workspace`；`npx eslint features/memory features/workspace`；人工走一遍素材 → 蒸馏 → 采纳 → 上下文预览
> review: 独立检查上游词汇是否泄漏到界面文案与 DTO、错误态是否吞掉了后端给的原因

## P-009 删除旧实现与文档改写

> 执行期发现与处置：旧实现是一个互相引用的簇，`memory_fs` / `memory_store` / `memory_thread` 被 daemon、capture、queue、agent_events、promote 依赖，删任何一个都要先把这些重写到新引擎上。本片因此先做了三件重写，再删：
>
> 1. **daemon 重写**（`memory/daemon.rs`）：路由表收成新模型的十八条，inbox review、working context、index rebuild、storage migration 这些路由整体消失（请求它们得到 404 而不是空成功）；hook 事件改为「把转录存成素材 + 按需给这一轮的上下文」，任何失败都返回 200 并说明原因——hook 不该成为 session 卡死的理由。
> 2. **hook 入口重写**：`mdx-cli memory hook` 直接构造新 daemon 的请求，不再经旧的 spool / queue / agent_events 三张表。P-003 交付的 `capture::record_session` 从此有了真实调用方。
> 3. **wiki 提升重写**（`memory/wiki_promote.rs`）：从库里渲染成 `raw/promoted/` 下的 Markdown，带出处 frontmatter，同名不覆盖（wiki 可能已经 ingest 过前一份）。
>
> 这三件做完，`spool` / `queue` / `agent_events` 三个文件失去了全部调用方，与旧簇一并删除。`memory_hooks.rs` 只剩下一个纯格式化函数（45 行）。

删掉详细设计第十五节列出的全部旧文件——inbox、working、projection、两套存储与迁移、自研检索与索引（含 `search_index.rs`，它 `use crate::memory_models`，是记忆的自研索引而不是工作区搜索）、LLM 蒸馏、Markdown 读写、以及 P-002 搬进去的 `memory/legacy.rs`——连同 `memory_tests.rs` 和只服务于记忆存储的 `postgres` 依赖。新测试在前面各片已经建立，这里不做搬运：旧测试测的是不再存在的概念。

同批改写文档：`docs/loopx/specs/memory.md` 的 21 个章节里只有 Promote Contract 与 Relationship to LLM Wiki 保留小改，其余整体重写；用户文档 `docs/memory-usage.md` 与 `docs/memory-agent-backend.md` 同样重写。不留过渡期的双份口径。

完成条件是：第十五节的删除清单在源码树中清空；`src-tauri/src/` 下不再有记忆层的平铺 `memory_*.rs`；`postgres` 从 `Cargo.toml` 消失；整仓搜索被删概念只在 `docs/loopx/design/**` 与 `docs/loopx/plans/**` 这类历史记录里命中；全量测试绿。

> writes: `src-tauri/src/memory_*.rs`（删除）, `src-tauri/src/search_index.rs`（删除）, `src-tauri/src/memory/legacy.rs`（删除）, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `docs/loopx/specs/memory.md`, `docs/memory-usage.md`, `docs/memory-agent-backend.md`, `docs/loopx/design/2026-08-17-memory-engine-adoption/详细设计.md`（实现期间的偏差写进修订记录）
> anchors: 详细设计「十五、删除清单」；设计提案「需要同步改写的既有文档」（跨文档锚点，来源在提案而非详细设计）
> verify: `cargo test -p mdx`；`npx vitest run`；`grep -rln "memory_storage_postgres\|memory_projection\|memory_inbox\|working\.md" src-tauri features docs` 只命中 `docs/loopx/design` 与 `docs/loopx/plans`
> review: 独立检查是否有仍被引用的删除项、spec 与用户文档是否还残留已抛弃概念的契约

## Integration And Final Verification

- 全量回归：`cargo test -p mdx -p pdf-core -p font-core`、`npx vitest run`、`cargo clippy --workspace --all-targets`、`npx eslint`，全部与基线比对，无新增失败与新增告警。
- 端到端一次真实走查：新工作区启用记忆 → 下载模型 → 导入旧数据 → 捕获一次会话 → 检索 → 蒸馏 → 采纳 → 在上下文预览里看到它 → 记一条反例 → 降级 → 导出包 → 导入回空库 → 彻底清除。
- 失败路径：断网启动、模型目录被删、库文件只读、schema 版本被人为改高、以及**应用与 `mdx-mcp` sidecar 两个进程同时写同一个库**（设计只用进程内 Mutex，跨进程只有 SQLite 写锁与上游 5s 咨询锁，这条必须实测出可接受的行为而不是假设）。五种情况都要给出明确错误且不留半条数据。
- 破坏性变更交付物：发布说明写明删除的命令与工具、面板能检测旧技能文本并提示重装、`memory_integration_repair` 能把三种 agent 的技能文本刷新到新工具集。
- 体积与构建成本：用 P-001 记录的「前」基线对比「后」，写回详细设计的修订记录。
- 确认「本期不做」的项没有被顺手做进去：Phase-2 knowledge card、外发布锚点、近似内容去重告警、跨字体缺字回退。

## Handoff And Residual Risks

- Blockers: 无。三个阻塞决定（PostgreSQL 删除、模型下载、提升门禁落地方式）已于 2026-08-17 裁决并写入设计。P-006 有一个前置确认项（9.5 的 CLI / MCP 清单），不阻塞 P-001 到 P-005。
- Residual risks:
  - 上游 0.9.0 的未知缺陷。锁 `Cargo.lock`；遇到必须改上游的问题先提 issue，本地补丁只作临时手段并记到期时间。
  - rusqlite 升级可能牵出连锁问题，所以 P-001 单独成片、单独验绿。它适配的 39 处调用后来都会被删除，这是通行费不是浪费。
  - P-006 到 P-008 之间应用不可发布。若期间需要发版，必须先完成 P-008 或回退到 P-005 的提交点。
  - 跨进程并发只靠 SQLite 写锁与上游咨询锁（Windows 上是空实现）。集成验证里有一条专门测它；若结果不可接受，需要回到 `spec` 决定是否把 sidecar 的写入改成经由应用进程。
  - 素材进库即持久，敏感内容只能事后删除。捕获白名单与删除入口在 P-003 同批交付，缺一不可。
- Resume note: 从 frontmatter 的 slice 状态恢复。若在 P-002 到 P-009 之间中断，源码树里会同时存在新旧两套记忆实现（旧的在 `memory/legacy.rs` 与平铺的 `memory_*.rs` 里），这是预期状态；判断进度看新命令是否已接到界面（P-008）与旧文件是否已删除（P-009），不要凭源码里还搜得到 `memory_inbox` 就认为没开工。
