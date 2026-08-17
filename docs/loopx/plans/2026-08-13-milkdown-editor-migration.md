---
source: docs/loopx/design/2026-08-12-milkdown-editor-migration/需求设计文档.md
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
    depends: [P-001, P-002]
  - id: P-004
    status: done
    depends: [P-003]
  - id: P-005
    status: done
    depends: [P-004]
  - id: P-006
    status: done
    depends: [P-002, P-004, P-005]
  - id: P-007
    status: done
    depends: [P-003, P-004, P-005, P-006]
  - id: P-008
    status: done
    depends: [P-007]
---

# Milkdown 主编辑器迁移实施计划

## Goal And Boundaries

交付一个以 Milkdown/ProseMirror DOM view 为唯一 WYSIWYG 主编辑表面的 MDX 桌面应用，并恢复共享同一 document session 的 CodeMirror 源码模式。完成后，Workspace Mode 和 Document Mode 保持现有文件树、标签、Outline、图片、wikilink、查找替换、CLI、dirty、draft recovery、external conflict 和 fingerprint 安全行为；Markdown 仍是唯一持久化内容；Rust layout/font/PDF 只服务只读 publishing。

计划执行受以下已批准边界约束：

- 产品代码只能通过 MDX-owned `MarkdownEditorAdapter` 使用编辑器；Milkdown context、ProseMirror positions/plugin keys、CodeMirror view 和私有 DOM 不越过 package 边界。
- 不引入 Electron、ColaMD watcher/dirty/file state、整体 `editor.ts`、deprecated `@milkdown/plugin-math@7.5.9`、长期双 editor 开关或运行时旧 editor fallback。
- 未知/不安全 Markdown 必须可见且保真；未编辑 source-preserving slice 逐字保留。safe HTML、clipboard 和 Mermaid preview 遵守详细设计的安全合同。
- dirty 外部变化不覆盖内存内容；draft 只在保存成功或显式丢弃后删除；backend fingerprint rejection 保留全部可恢复状态。
- CLI 公开 command、flag、payload、stdout/stderr、JSON 和 exit code 不变。selection/insert 只改变内部 source-coordinate adapter 实现。
- 产品入口切换前取得全部 `TC-*` 的资格证据；切换后重新运行完整集成验证。回滚只依赖应用版本/Git revert，不迁移 Markdown。
- `surfaceMode`、editor revision、ProseMirror/CodeMirror state 都不进入持久化 schema。未来若需 hard file-size limit、CLI 变更、语法降级或文件状态变化，必须返回 `clarify`/`spec`。
- 2026-08-13 的新鲜基线为 `npm test`：102 个 test files、704 个 tests 全部通过。执行期间不得把基线问题当作已知豁免。

计划 frontmatter 的状态更新是执行控制元数据，不扩大各 slice 的业务写入边界。执行者按 frontmatter 依赖顺序推进；每个 slice 验证通过后才可开始其依赖项。

## P-001 建立稳定 adapter 与基础 Milkdown DOM editor

交付新的 `packages/mdx-editor` 产品入口：对外只暴露设计第七章的 document snapshot、UTF-16 source selection、change event、diagnostic、handle 和 pinned command 语义；对内由 React 生命周期管理基础 Milkdown/ProseMirror DOM view。引入的 Milkdown packages 使用同一受支持版本线并由 lockfile 精确锁定，基础 commonmark/GFM、history、composition、clipboard 和 selection 能在不依赖 hybrid layout geometry 的隔离 fixture 中运行。

完成条件是空文档、普通 Markdown、emoji/组合字符、selection、undo/redo、clipboard 和重复 mount/unmount 的 package contract 测试通过；stale document/revision change 被拒绝；ProseMirror doc 和 adapter state 可由 canonical Markdown 重建；`features/**` 尚无需知道 Milkdown 私有对象。

> writes: `package.json`, `package-lock.json`, `packages/mdx-editor/index.ts`, `packages/mdx-editor/adapter/**`, `packages/mdx-editor/milkdown/**`, `packages/mdx-editor/test/**`
> anchors: `AC-001`, `AC-002`, `AC-003`, `AC-007`, `AC-010`, `AC-015`; `D-001`, `D-002`, `D-003`, `D-012`; `TC-001`, `TC-009`, `TC-014`
> verify: `npm test -- packages/mdx-editor`；`npm run lint -- packages/mdx-editor package.json`；检查 `npm ls` 中 Milkdown 包版本对齐且不存在 `@milkdown/plugin-math`/Electron
> review: 独立检查 adapter 是否泄漏框架私有类型、是否形成第二份 canonical content，以及依赖是否违反 React/Tauri/版本锁定边界

## P-002 交付复杂语法、source preservation 与安全边界

交付由 `createMdxMilkdownPlugins()` 组合的 syntax layer：frontmatter、footnote、wikilink、Mermaid、math、callout 都有结构化 parse/schema/serialize/NodeView/clipboard 行为；safe HTML 使用显式 source block 和 sanitized inert preview；未知或不能安全结构化的语法进入 visible source-preserving fallback。现有语法 fixture 可以作为行为 oracle，但旧 kernel API 不再是产品组合权威。

完成条件是每个 syntax family 都能 parse、编辑、serialize、reopen；mixed fixture 覆盖 plugin 交界；未编辑 fallback 的 source slice 按原 bytes/line ending 比较；HTML script/event attribute/javascript URL、伪造 clipboard metadata 和 Mermaid 错误均不执行危险内容；math 不依赖 deprecated package，preview 错误不破坏 source。

> writes: `packages/mdx-editor/syntax/**`, `packages/mdx-editor/milkdown/**`, `packages/mdx-editor/react/**`, `packages/mdx-editor/test/**`
> anchors: `AC-004`, `AC-013`, `AC-015`; `D-002`, `D-006`, `D-007`; `TC-002`, `TC-012`, `TC-014`
> verify: `npm test -- packages/mdx-editor/syntax packages/mdx-editor/milkdown packages/mdx-editor/react`；`npm run lint -- packages/mdx-editor`；安全 fixture 与 fallback fixture 分别给出无脚本执行和 byte-for-byte source 证据
> review: 对本 slice 的精确 diff 做独立安全与兼容审查，重点检查 sanitizer/clipboard trust boundary、fallback serializer 和 plugin ownership；Critical/Important 发现修复后重新验证

## P-003 交付共享 session 的 CodeMirror 源码模式

交付 adapter 内的全局 CodeMirror source surface 和受控 `surfaceMode`。WYSIWYG 与 source 互斥可见，读取/修改同一 Markdown revision、dirty/draft/conflict 和 UTF-16 source selection；模式切换 flush 当前事务并映射 selection，不持久化 mode，也不建立第二条保存路径。

完成条件是 WYSIWYG→source 编辑→WYSIWYG round-trip 保持内容和 dirty；未知语法通过 fallback 正常切回；fatal visual parse 时留在 source、保留 canonical Markdown、dirty/draft 与 last-stable visual cache并给出定位诊断，源码仍可保存，修复后可再次切回；切换期间的 stale revision、clean reload 和重复请求具有确定结果。

> writes: `packages/mdx-editor/source/**`, `packages/mdx-editor/adapter/**`, `packages/mdx-editor/index.ts`, `packages/mdx-editor/test/**`
> anchors: `AC-004`, `AC-012`, `AC-013`; `D-004`, `D-005`; `TC-011`, `TC-012`
> verify: `npm test -- packages/mdx-editor/source packages/mdx-editor/adapter packages/mdx-editor/test`；`npm run lint -- packages/mdx-editor`；模式切换测试断言只有一个 canonical Markdown 和一个 dirty/draft/conflict owner
> review: 独立检查 fatal parse 是否可能覆盖 source、mode 切换是否双写，以及 selection 映射是否拆分 surrogate/composition 范围

## P-004 接入 Workspace/Document session 并保持文件安全

让 Workspace Mode 与 Document Mode 在非生产资格路径中都能用同一个 `EditorPane`/adapter 编辑真实 session Markdown，同时保持现有 dirty、draft recovery、external watcher、diff/conflict、discard 和 fingerprint compare-and-write 所有权。editor change 带 documentId/baseRevision 回到 session；clean reload 是明确 replace，dirty external change 不向 adapter 发送覆盖性 snapshot。

完成条件是两种窗口通过同一安全场景：clean atomic replace 更新 baseline；dirty external modification 保留用户编辑并进入 conflict；recovery draft 穿过 clean reload；保存成功或显式 discard 才删除 draft；fingerprint rejection 和 discard cleanup failure 都保留可恢复状态；快速切 tab 后旧 editor 回调不能串写其他文档。此 slice 不把 old/new editor 暴露成用户级设置。

> writes: `features/editor/components/editor-pane.tsx`, `features/editor/components/editor-kernel-adapter.tsx`, `features/editor/hooks/use-editor-bridge.ts`, `features/editor/lib/editor-types.ts`, `features/editor/**/*.test.{ts,tsx}`, `features/document/components/**`, `features/workspace/components/editor-stage.tsx`, `features/workspace/components/workspace-shell.tsx`, `features/workspace/lib/**`, `features/workspace/**/*.test.{ts,tsx}`, `packages/mdx-editor/adapter/**`
> anchors: `AC-001`, `AC-002`, `AC-005`, `AC-006`, `AC-010`, `AC-012`; `D-001`, `D-004`, `D-005`, `D-010`; `TC-001`, `TC-003`, `TC-004`, `TC-005`, `TC-011`
> verify: `npm test -- features/document features/editor features/workspace packages/mdx-editor/adapter`；`npm run test:workspace`；`npm run lint -- features/document features/editor features/workspace packages/mdx-editor/adapter`
> review: 对精确 diff 做独立数据安全审查，验证 editor 没有文件 IO/dirty/draft 删除能力，clean/dirty race、fingerprint rejection 和 tab identity 均 fail safe

## P-005 迁移 Outline、wikilink、find、图片与 CLI 命令

把所有编辑器相关产品集成迁到稳定 source-coordinate adapter。Outline 从 syntax index 读取 heading range；wikilink plugin 直接发布 target/alias 事件；find/replace 使用 active-surface semantic search/decorations而非 rendered DOM scan；图片资产仍由 Tauri 存储并在 pinned selection 插入；CLI 保持公开合同，只把内部 focus/insert/scroll dispatch 改为带 document/revision/selection 的至多一次命令。

完成条件是相同 command suite 在 WYSIWYG/source 两种表面成立；preview chrome 和 syntax UI 不重复计入 find；异步图片/CLI 文本在可映射本地事务后仍落到 pinned logical position；clean reload、restore、closed tab 或无法可信映射时明确拒绝而不是使用当前 caret；非 TTY/pipe、JSON、人类输出和 exit behavior 无公开变化；feature/workspace code 不查询 Milkdown 私有 DOM 或保留框架 position。

> writes: `features/editor/components/**`, `features/editor/hooks/**`, `features/editor/lib/**`, `features/workspace/components/**`, `features/workspace/lib/**`, `packages/mdx-editor/adapter/**`, `packages/mdx-editor/milkdown/**`, `packages/mdx-editor/source/**`, `src-tauri/src/cli_server.rs`, `src-tauri/src/bin/mdx_cli.rs`, `src-tauri/src/**/*cli*test*.rs`
> anchors: `AC-007`; `D-003`, `D-008`, `D-009`; `TC-006`, `TC-007`
> verify: `npm test -- features/editor features/workspace packages/mdx-editor`；`cargo test --manifest-path src-tauri/Cargo.toml cli`；运行现有 CLI help、非 TTY success/error 和 JSON smoke，比较命令、字段、stdout/stderr 与 exit code；`rg` 证明 feature/workspace 无 Milkdown plugin key/private DOM 集成
> review: 独立检查 CLI 公共兼容、commandId 至多一次、pinned selection race 和异步资产完成后的跨文档写入风险

## P-006 隔离只读 publishing 与编辑故障域

交付只接收 immutable `{documentId, revision, markdown}` 的 publishing adapter，把现有 Rust/WASM layout、font 和 PDF 调用保留在 read-only preview/export 路径。publishing 可以使用同一复杂语法语义 fixture，但不接收 editor handle、dirty/draft setter、selection 或 interactive hit-test capability；导出期间继续编辑时，生成物绑定触发时 revision。

完成条件是 layout/PDF/图片读取/输出路径错误均只返回 publishing error/warning，Markdown、dirty、selection、draft 和 conflict 前后不变；屏幕与 PDF 的标题、正文、链接、图片、代码、数学等内容语义一致而不比较像素；不存在浏览器打印伪装 native success，也不存在 publishing 反向进入 interactive caret/selection 的依赖。

> writes: `features/editor/lib/pdf-export-client.ts`, `features/editor/lib/pdf-export-client.test.ts`, `features/editor/lib/**publishing**`, `packages/mdx-editor/publishing/**`, `packages/mdx-editor/layout-ir/**`, `packages/mdx-editor/react/**preview**`, `src-tauri/src/layout_pdf.rs`, `src-tauri/src/layout_pdf_tests.rs`, `src-tauri/crates/layout-core/**`, `src-tauri/crates/font-core/**`, `src-tauri/crates/pdf-core/**`
> anchors: `AC-008`, `AC-009`; `D-011`; `TC-008`
> verify: `npm test -- features/editor/lib/pdf-export-client.test.ts packages/mdx-editor/publishing packages/mdx-editor/layout-ir`；`cargo test --manifest-path src-tauri/Cargo.toml layout_pdf`；依赖图与 fault-injection 证据证明 publishing 无 editor mutation path
> review: 独立检查 publishing failure isolation、snapshot revision 一致性、受控图片读取和 native PDF 错误是否可能影响 session

## P-007 建立切换前资格门槛与发布证据

交付可重复的 100 KiB/1 MiB mixed-syntax fixtures、release-like Tauri performance harness、macOS 真实交互/a11y checklist，以及依赖/provenance/license/禁用路径审计。资格构建可以包含不进入生产导航或设置的隔离 editor fixture，但不得形成用户可见 old/new switch。

完成条件是 Apple M5 10-core、16 GB、macOS 26.4 或不低于该基准的 Apple Silicon Mac 上，按 `D-015` 的采样定义达到首次可编辑、输入/IME p95、mode switch 和 long-task 门槛；中文拼音、emoji/组合字符、跨块 selection、undo/redo、clipboard、drag、键盘、VoiceOver 和 WCAG 2.1 AA 有真实证据；Tauri build 无 Electron、ColaMD file state/整体 editor、deprecated math；任何实质复制的独立 ColaMD plugin 都能追溯到固定 commit/path并保留 MIT notice，无复制则记录 behavior-only reference。全部 `TC-001`–`TC-014` 在产品入口切换前有资格证据。

> writes: `scripts/**`, `packages/mdx-editor/test/**`, `features/editor/**/*.test.{ts,tsx}`, `features/workspace/**/*.test.{ts,tsx}`, `src-tauri/**/*test*.rs`, `package.json`, `package-lock.json`, `THIRD_PARTY_NOTICES*`, `docs/**license**`, `docs/loopx/design/2026-08-12-milkdown-editor-migration/**`
> anchors: `AC-001`–`AC-015`; `D-001`–`D-013`, `D-015`; `TC-001`–`TC-014`
> verify: `npm test`；`npm run lint`；`npm run build`；`npm run build:app`；按 `D-015` 运行新 performance harness并保存 fixture checksum、环境元数据和原始 measurement artifact；完成 macOS IME/VoiceOver/WCAG checklist；运行 dependency/import/provenance/license scans且零禁项
> review: 独立审查完整资格证据，不以 debug build、减配 fixture、平均值替代 p95、自动化模拟替代真实 IME/VoiceOver，也不允许许可证清单与实际 diff 不一致

## P-008 切换唯一产品入口并清理旧交互路径

将 Workspace Mode 和 Document Mode 的生产 Markdown 入口原子切到通过资格验证的 adapter，移除或封闭旧 self-owned kernel/hybrid DOM+Canvas 主编辑入口、interactive WASM layout snapshot、custom caret/selection/hit-test 和 feature 私有 DOM scan。只读 publishing 所需 layout/font/PDF 代码与明确 read-only preview 保留；开发 fixture 不进入生产导航/设置或长期 runtime fallback。

完成条件是生产依赖图中只有一个 Milkdown Markdown 主编辑入口；两个窗口、两种 surface 和全部 feature/file/publishing 场景在最终产物重新通过；`features/**` 不再导入旧 hybrid interaction API；Tauri release-like build 可安装/启动；同一 Markdown 文件可由回滚应用版本打开而无需 migration。长期 editor spec、相关测试和运行验证脚本与最终架构一致，旧 TeX/hybrid 交互断言不再被当作现行产品合同。

> writes: `features/editor/**`, `features/document/**`, `features/workspace/**`, `packages/mdx-editor/**`, `app/**`, `scripts/**`, `docs/loopx/specs/editor.md`, `docs/loopx/design/2026-08-12-milkdown-editor-migration/**`, `package.json`, `package-lock.json`
> anchors: `AC-001`–`AC-015`; `D-001`, `D-003`, `D-008`, `D-010`, `D-011`, `D-012`, `D-013`, `D-014`, `D-016`; `TC-001`–`TC-014`
> verify: `npm test`；`npm run lint`；`npm run build`；`npm run build:app`；`cargo test --manifest-path src-tauri/Cargo.toml`；最终 import/dependency/DOM scan 证明无 production hybrid interaction、Electron、deprecated math 或 user-level editor switch；在安装的 Tauri app 上重跑 Workspace/Document、source switch、file safety、CLI、publishing、IME/a11y smoke 与版本回滚 smoke
> review: 对最终 exact diff、删除项和 release evidence 做独立审查；确认没有误删 publishing 能力、没有隐藏兼容 shim/双写、所有 Critical/Important 发现已修复并新鲜复验

## Integration And Final Verification

- 覆盖矩阵必须逐项证明 `AC-001`–`AC-015` → `D-001`–`D-016` → `TC-001`–`TC-014`；任何未通过项都阻止完成声明，不使用 `deferred-with-rationale` 延后已批准首版要求。
- 从新鲜绿色基线开始，在 P-007 切换前资格构建和 P-008 最终生产入口各保留一次完整 `npm test`、lint、web build、Tauri build 与 Rust test 输出。
- 最终安装产物同时验证 Workspace/Document、WYSIWYG/source、复杂语法、clean/dirty external change、draft/fingerprint、pinned CLI/image、Outline/wikilink/find、preview/PDF failure isolation。
- 静态边界检查覆盖：feature/workspace 不 import Milkdown/ProseMirror/CodeMirror 私有 editor types，不 query implementation DOM；Rust/WASM layout 不参与 input/caret/selection/hit-test；dependency tree 无 Electron 与 deprecated math；生产无 old/new editor switch。
- source-preservation、安全、性能、IME/VoiceOver、许可证 provenance 和 rollback 都需要原始证据，不能只用单元测试数量或代码结构代替用户可观察结果。
- 最终运行 `git diff --check` 并核对长期 [editor spec](../specs/editor.md) 与实际产品入口一致；不得提交、push 或 merge，除非用户另行明确要求。

完整 source-anchor 覆盖：

| Source anchors | Execution slices |
|---|---|
| `AC-001`, `AC-002`, `AC-003` | `P-001`, `P-004`, `P-007`, `P-008` |
| `AC-004` | `P-002`, `P-003`, `P-007`, `P-008` |
| `AC-005`, `AC-006` | `P-004`, `P-007`, `P-008` |
| `AC-007` | `P-001`, `P-005`, `P-007`, `P-008` |
| `AC-008`, `AC-009` | `P-006`, `P-007`, `P-008` |
| `AC-010` | `P-001`, `P-004`, `P-007`, `P-008` |
| `AC-011` | `P-007`, `P-008` |
| `AC-012` | `P-003`, `P-004`, `P-007`, `P-008` |
| `AC-013` | `P-002`, `P-003`, `P-007`, `P-008` |
| `AC-014` | `P-007`, `P-008` |
| `AC-015` | `P-001`, `P-002`, `P-007`, `P-008` |
| `D-001`, `D-002`, `D-003` | `P-001`, `P-002`, `P-005`, `P-007`, `P-008` |
| `D-004`, `D-005` | `P-003`, `P-004`, `P-007` |
| `D-006`, `D-007` | `P-002`, `P-007` |
| `D-008`, `D-009` | `P-005`, `P-007`, `P-008` |
| `D-010` | `P-004`, `P-007`, `P-008` |
| `D-011` | `P-006`, `P-007`, `P-008` |
| `D-012`, `D-013` | `P-001`, `P-007`, `P-008` |
| `D-014` | `P-008` |
| `D-015` | `P-007` |
| `D-016` | `P-008` |
| `TC-001`, `TC-002` | `P-001`, `P-002`, `P-007`, `P-008` |
| `TC-003`, `TC-004`, `TC-005` | `P-004`, `P-007`, `P-008` |
| `TC-006`, `TC-007` | `P-005`, `P-007`, `P-008` |
| `TC-008` | `P-006`, `P-007`, `P-008` |
| `TC-009`, `TC-010` | `P-001`, `P-007`, `P-008` |
| `TC-011` | `P-003`, `P-004`, `P-007`, `P-008` |
| `TC-012` | `P-002`, `P-003`, `P-007`, `P-008` |
| `TC-013` | `P-007`, `P-008` |
| `TC-014` | `P-001`, `P-002`, `P-007`, `P-008` |

## Handoff And Residual Risks

- Blockers: none。canonical spec 无开放问题，2026-08-13 新鲜测试基线全绿，slice graph 无循环依赖。
- Residual risks: Milkdown 当前公开 API 的具体封装、source-preserving serializer 的实现复杂度、WebView 大文档性能、真实 IME/VoiceOver 只能在 macOS 设备上最终判定、ColaMD 实际复制范围要随 diff 才能完成许可证核对。这些都是已定义验证门槛，不是允许降低 AC 的豁免。
- Resume note: 从 frontmatter 中第一个非 `done` slice 恢复；先重读该 slice 的 `writes/anchors/verify/review` 和当前 git diff，再执行。若事实要求改变任何 D/AC/TC，停止该 slice并按 `D-016` 返回 `spec` 或 `clarify`，不要在计划中自行改产品合同。
