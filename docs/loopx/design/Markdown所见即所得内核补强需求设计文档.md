# Markdown所见即所得内核补强设计文档

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿，基于用户反馈重新定义自研 WYSIWYG 内核补强范围 | 2026-06-18 | Codex |

## 二、需求信息

### 2.1 需求背景

- 背景：用户反馈新增自研编辑器内核“问题很大”：所见即所得模式需要可实时编辑；当前不能复制，基础 Markdown 显示没有实现，标题和加粗缺失。仓库证据显示当前 `packages/mdx-editor/` 已有 ProseMirror schema 骨架，但 parser、plugins、commands、clipboard 和高级节点能力明显不足。
- 需求目的：继续补强当前 ProseMirror 自研 Markdown WYSIWYG 内核，使其成为可实时编辑、可复制、结构化支持基础和高级 Markdown 的主编辑体验。
- 目标用户/使用方：MDX Workspace Mode / Document Mode 用户，现有 save/dirty/recovery/CLI selection 和 insert 集成。
- 需求链接：无外部 PRD。
- 关联原始材料：
  - `.loopx/intake/clarify-editor-wysiwyg-and-mhtml-preview-20260618144226.md`
  - `docs/loopx/specs/editor.md`
  - `docs/loopx/design/自研Markdown所见即所得内核需求设计文档.md`
  - `packages/mdx-editor/**`
  - `features/editor/components/editor-pane.tsx`
  - `features/editor/components/editor-kernel-adapter.tsx`

### 2.2 需求范围

- 本期范围：
  - 继续使用并补强当前 ProseMirror 自研内核，不回退闭源内核。
  - WYSIWYG 为主模式，实时编辑、撤销/重做、复制/粘贴、选择、保存链路可用。
  - 移除全局“源码”模式切换。
  - 保留块级源码编辑兜底，用于解析失败或复杂未知块，保证不丢内容和可保存。
  - 基础 Markdown 结构化实时编辑：H1-H6、段落、换行、加粗、斜体、删除线、行内代码、链接、图片、有序/无序列表、引用块、fenced code block。
  - 高级 Markdown 结构化实时编辑：表格、任务列表、脚注、math、callout、Mermaid。
  - Mermaid 作为结构化块，源码编辑和预览实时同步，错误在块内显示，不破坏 Markdown fence。
  - Math 作为行内/块级结构节点，支持点击编辑 LaTeX 源码并实时渲染。
  - 复制按 WYSIWYG 语义验收：纯文本目标可读，富文本目标尽量保留格式，复制回 MDX 保持结构。
- 非目标：
  - 不恢复旧 `@do-md/react` 闭源内核。
  - 不保留长期双内核切换。
  - 不保留全局源码/WYSIWYG 切换。
  - 不做 Mermaid 可视化图形编辑器。
  - 不做完整公式编辑器或公式工具面板。
  - 不做多人协作、CRDT/Yjs、私有 JSON 文档主存储。
  - 不把 HTML/MHTML 文件预览纳入编辑器内核。
- 决策边界：
  - plan 可决定依赖库、插件拆分、实现顺序、fixture 组织、局部 UI 细节。
  - 必须回 spec：改变 Markdown 文件为唯一持久化真相、恢复全局源码模式、引入闭源或非商业限制许可内核、改变 CLI 外部协议。
  - 必须回 clarify：要求 Mermaid 可视化编辑器、完整公式编辑器、多人协作、私有块数据库。
- 依赖方：
  - ProseMirror 生态。
  - Markdown 解析/序列化生态，可引入 MIT/Apache/BSD 等许可证依赖。
  - Mermaid、KaTeX/数学渲染、现有 image asset、find/replace、outline、CLI sync、save/recovery。
- 约束条件：
  - Markdown 文件仍是唯一持久化真相。
  - Source map / dirty map / editor metadata 只能存在内存中。
  - 解析失败不能丢内容，必须可通过块级源码兜底编辑和保存。
  - `docs/loopx/specs/editor.md` 的 `data-mdx-*` DOM contract 继续作为集成边界。

### 2.3 可行性分析

- 业务可行性：用户明确选择继续补强，且不要求保留全局源码模式；目标和非目标清晰。
- 技术可行性：ProseMirror 能支撑结构化编辑、selection、transaction、clipboard、history；难点在 Markdown 映射、source preservation、高级节点和浏览器交互。
- 团队接受能力：范围大，需要分阶段交付，但可沿现有 `packages/mdx-editor/` 和 adapter 边界推进。
- 时间成本：高。基础能力可先补齐，高级结构化节点需要多轮实现和浏览器验收。
- 资源成本：本地前端依赖和测试 fixture；不需要后端存储。
- 替代方案：
  - 回退闭源内核：短期恢复体验，但违背用户“继续补强”和自研内核目标。
  - 保留全局源码模式作为长期兜底：实现简单，但用户明确不希望保留。
  - 只做基础 Markdown：不满足用户明确要求的高级能力结构化实时编辑。
- 关键风险：
  - 表格、脚注、math、Mermaid 的 ProseMirror schema 与 Markdown serializer 难度高。
  - Clipboard 和 IME 需要真实浏览器验证，jsdom 不足。
  - 移除全局源码模式后，块级源码兜底必须可靠。

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 让 WYSIWYG 成为可用主编辑体验。
  - 结构化支持基础和高级 Markdown。
  - 删除全局源码模式 UI，但保留块级源码兜底。
  - 保持 Markdown 文件兼容和外部集成协议稳定。
- 总体思路：
  - 扩展 parser/schema/serializer 覆盖基础与高级 Markdown。
  - 建立 input rules、keymaps、commands、clipboard pipeline 和 node views。
  - 将复杂块建模为结构化 ProseMirror nodes；解析失败时退化为 editable source block。
  - 移除 `EditorPane` 的全局源码模式切换和 `SourceModeEditor` 常规入口。
  - 加强 adapter tests、kernel fixture tests 和浏览器级验收。
- 核心模块：
  - Markdown parser/source map。
  - ProseMirror schema。
  - Serializer/source preservation。
  - Commands/input rules/keymaps。
  - Clipboard/selection。
  - Node views：table、task list、footnote、math、callout、Mermaid、source fallback。
  - React adapter and app integration。
- 主要难点：
  - 高级 Markdown 与 source preservation 的组合。
  - 结构化节点内部编辑和序列化。
  - Clipboard MIME、HTML/plain text/Markdown 的互转。
  - 解析失败不丢内容。
- 技术指标：
  - 用户输入后 Markdown state 实时更新。
  - 基础 Markdown fixture 可 parse/render/edit/serialize round trip。
  - 高级节点可结构化编辑并保真保存。
  - 复制/粘贴覆盖纯文本、富文本和 MDX 内部回贴。

### 3.2 整体架构设计

- 业务模式：本地优先 Markdown WYSIWYG 编辑器。
- 系统边界：
  - `packages/mdx-editor/` 负责编辑内核。
  - `features/editor/` 负责 MDX 应用集成、图片、Mermaid render layer、find/replace、CLI bridge。
  - Rust/Tauri 继续负责文件读写、状态持久化、CLI socket。
- 上下游系统：
  - 上游：Markdown 文件、用户输入、剪贴板、CLI insert。
  - 下游：Markdown 字符串、selection snapshot、DOM contract、save/recovery。
- 应用架构：
  - `MdxEditorProvider` 管理 parse -> ProseMirror state -> serialize。
  - `MdxEditorView` 渲染 editor root 和 node views。
  - `features/editor/components/editor-kernel-adapter.tsx` 保持 app-level 兼容 API。
  - `EditorPane` 不再提供全局源码模式按钮。
- 技术架构：
  - Parser：Markdown -> AST/token stream -> ProseMirror doc + source metadata。
  - Runtime：ProseMirror state + plugins + node views + dirty/source metadata。
  - Serializer：doc + metadata -> Markdown。
  - Fallback：unsupported/invalid region -> source block node。
- 数据流转：
  - 打开：Markdown -> parse -> WYSIWYG doc。
  - 编辑：transaction -> update doc -> serialize currentMarkdown -> app dirty/save。
  - 复杂块：node view 内部编辑 -> node attrs/content 更新 -> serialize。
  - 失败块：source block edit -> raw Markdown preserved or reparsed locally when possible。

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| 打开 Markdown | 打开 tab/document | Parser、Provider、View | 解析基础/高级节点，创建 editor state，渲染 WYSIWYG | 失败片段生成 source fallback block | 可编辑文档 |
| 实时编辑 | 用户输入/命令 | ProseMirror plugins、commands | transaction 更新 doc，serializer 生成 Markdown，bridge 通知 app | 命令不可用则 no-op 或禁用 | dirty Markdown |
| 复制 | 用户 `Cmd+C` | Clipboard plugin | 输出 text/plain 和 text/html，MDX 内部可带自定义 Markdown fragment | 选区异常则回退浏览器默认文本复制 | 可复制内容 |
| 粘贴 | 用户 paste | Clipboard plugin、parser | 优先处理 HTML/Markdown/plain text，转成结构节点 | 不支持内容进入 source fallback 或纯文本 | 文档变更 |
| Mermaid 编辑 | 点击 Mermaid 块 | Mermaid node view | 块内源码编辑，实时渲染预览，错误显示 | 渲染失败保留源码和错误 | Mermaid fence |
| Math 编辑 | 点击 math 节点 | Math node view | 编辑 LaTeX，实时渲染 KaTeX/等价 renderer | 渲染失败显示错误并保留源码 | math Markdown |
| 保存 | 用户/CLI save | serializer、workspace save | 输出 Markdown，沿用现有保存/冲突检测 | 保存失败保持 dirty | 磁盘文件 |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| Parser | Markdown 到 doc | CommonMark/GFM/扩展解析、source ranges、fallback block | Markdown parser libs | 规格测试权威 |
| Schema | 结构模型 | blocks、inline nodes、marks、高级节点 | ProseMirror model | Markdown-first |
| Serializer | doc 到 Markdown | source preservation、稳定输出、fallback raw | source map | 不能重排未编辑内容 |
| Commands/Input Rules | 编辑命令 | marks、headings、lists、tables、tasks、blockquote、code | ProseMirror commands | 工具栏和快捷键共用 |
| Clipboard | 复制粘贴 | text/html、text/plain、MDX fragment | ProseMirror clipboard hooks | 浏览器验收 |
| Node Views | 高级节点 UI | table、task、footnote、math、callout、Mermaid、fallback | React/DOM | 结构化编辑入口 |
| App Adapter | 应用兼容 | currentMarkdown、selection、insertText、insertImage | features/editor | CLI/save 不改协议 |

### 3.5 新增/调整功能说明

- 扩展 `packages/mdx-editor/schema/schema.ts` 覆盖高级节点。
- 扩展 `parseMarkdown` 和 `serializeMarkdown`。
- 新增 editor commands、input rules、keymaps 和 clipboard plugin。
- 新增结构化 node views。
- 移除 `EditorPane` 的全局源码模式 UI 和常规 `SourceModeEditor` 使用。
- 新增 block-level source fallback node view。

## 四、详细设计

### 4.1 Parser 与 Source Preservation 详细设计

#### 4.1.1 需求内容

- 入口：`parseMarkdown(markdown)`。
- 操作人/调用方：`MdxEditorProvider`、clipboard paste、fallback block reparse。
- 前置条件：输入 Markdown 字符串。
- 输出结果：ProseMirror doc、source slices、diagnostics。

#### 4.1.2 方案设计

- 核心逻辑：
  - 使用成熟 Markdown parser 解析 CommonMark/GFM 和扩展语法，或在现有 parser 上补足 token 支持。
  - 基础 inline mark：strong/emphasis/strike/inline_code/link/image。
  - Block：heading、paragraph、blockquote、ordered/bullet list、task list、code block、table、footnote definition、math block、callout、Mermaid。
  - Unsupported/invalid region 生成 `source_fallback` node，记录原始 Markdown。
  - 每个可保真节点记录 source range 和语法风格。
- 状态流转：Markdown -> AST/tokens -> intermediate nodes -> ProseMirror doc。
- 数据变更：仅内存 metadata。
- 计算公式：不涉及。
- 幂等设计：同输入同 parser 版本产出稳定 doc。
- 权限/越权控制：不涉及。
- 异常处理：局部失败降级 fallback block，整体不可解析时用一个 fallback block 包住全文。
- 补偿/重试：用户编辑 fallback block 后可局部重试解析。
- 日志与审计：不记录正文。

#### 4.1.3 流程步骤

1. 解析 Markdown。
2. 映射基础和高级节点。
3. 记录 source slices。
4. 对失败区域生成 fallback block。
5. 返回 doc/metadata/diagnostics。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 不完整表格 | fallback block 或可修复 table node | 内容可见可编辑 | 测试 |
| 损坏 Mermaid | Mermaid node 显示错误，不丢源码 | 可修复源码 | 测试 |
| 未知 HTML | fallback block | 可编辑原文 | diagnostic |

### 4.2 Schema 与结构化节点详细设计

#### 4.2.1 需求内容

- 入口：`mdxEditorSchema`。
- 操作人/调用方：parser、commands、node views、serializer。
- 前置条件：ProseMirror runtime。
- 输出结果：可表达目标 Markdown 的结构化 doc。

#### 4.2.2 方案设计

- 核心逻辑：
  - Blocks：paragraph、heading、blockquote、bullet_list、ordered_list、list_item、task_item、code_block、table、table_row、table_cell/header_cell、footnote_definition、math_block、callout、mermaid_block、source_fallback。
  - Inline：text、image、footnote_ref、math_inline。
  - Marks：strong、emphasis、strike、inline_code、link。
  - Node attrs 保存 Markdown 语义，如 list order、task checked、table alignment、callout type/title、fence info、math delimiter。
- 状态流转：schema nodes 被 parser 创建，被 transaction 修改，被 serializer 输出。
- 数据变更：内存 doc。
- 计算公式：不涉及。
- 幂等设计：node attrs 只表达 Markdown 语义，不写私有持久 ID。
- 权限/越权控制：不涉及。
- 异常处理：非法 node 创建失败在测试中暴露。
- 补偿/重试：fallback node。
- 日志与审计：不涉及。

#### 4.2.3 流程步骤

1. 扩展 schema nodes/marks。
2. 为每类节点定义 `toDOM/parseDOM` 和 `data-mdx-node-type`。
3. 调整 parser/serializer 使用新节点。
4. 调整 DOM helper 只依赖 data contract。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 嵌套列表 | schema 允许合理嵌套 | 正常编辑 | fixture |
| 表格单元格复杂内容 | 本期可限制为 inline content | 块级内容 fallback 或禁用 | 测试 |
| callout 内复杂块 | 支持常见块，失败局部 fallback | 不丢内容 | fixture |

### 4.3 Commands、Input Rules 与 Clipboard 详细设计

#### 4.3.1 需求内容

- 入口：键盘输入、快捷键、toolbar、paste/copy。
- 操作人/调用方：用户、CLI insert。
- 前置条件：editor focused。
- 输出结果：实时结构化编辑和正确剪贴板行为。

#### 4.3.2 方案设计

- 核心逻辑：
  - Input rules：`# ` heading、`- ` list、`1. ` ordered list、`- [ ]` task、`> ` blockquote、``` fence、`|` table 入口等。
  - Keymaps：Mod-B/I、undo/redo、Enter/Backspace 在 list/table/callout 中的结构行为。
  - Commands：toggle marks、set heading、insert table、toggle task、insert footnote、insert math、insert Mermaid。
  - Clipboard copy：选区序列化为 `text/plain` 和 `text/html`；内部可附加自定义 Markdown fragment。
  - Clipboard paste：优先识别内部 fragment，其次 HTML -> Markdown/doc，最后 plain text。
- 状态流转：input/clipboard -> command/transform -> transaction -> serialized Markdown。
- 数据变更：editor state 和 app markdown。
- 计算公式：不涉及。
- 幂等设计：toggle commands 遵循编辑器常规开关语义。
- 权限/越权控制：paste HTML 需要 sanitize，不执行 script。
- 异常处理：无法结构化粘贴时以纯文本或 fallback block 插入。
- 补偿/重试：undo/redo。
- 日志与审计：不记录正文。

#### 4.3.3 流程步骤

1. 注册 input rules/keymaps/commands。
2. 接管 copy/cut/paste hooks。
3. 将 transaction 后的 doc 序列化给 app。
4. 增加浏览器级测试覆盖复制粘贴。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 复制跨多个块 | 输出 plain text/html | 可粘贴到外部 | Playwright |
| 粘贴复杂 HTML | sanitize 后尽量转结构，否则 fallback | 不执行脚本 | 安全测试 |
| IME 输入 | 不触发破坏性 input rule | 中文输入正常 | 手动 |

### 4.4 高级 Node Views 详细设计

#### 4.4.1 需求内容

- 入口：结构化节点渲染和交互。
- 操作人/调用方：用户。
- 前置条件：doc 中存在 table/task/footnote/math/callout/Mermaid。
- 输出结果：结构化实时编辑。

#### 4.4.2 方案设计

- 核心逻辑：
  - Table：渲染可编辑表格，支持单元格编辑、增删行列、基础 alignment 保存。
  - Task list：checkbox 与文本同步，点击 checkbox 更新 Markdown checked 状态。
  - Footnote：inline ref 和 definition 关联；支持编辑 ref label 和 definition 内容。
  - Math：inline/block node 点击进入 LaTeX 编辑，实时渲染；错误显示原源码。
  - Callout：结构化显示 type/title/content，可编辑内容和标题。
  - Mermaid：块内源码编辑 + preview，同步刷新；错误显示在块内。
  - Source fallback：显示为可编辑源码块，保存原样；可提供“尝试解析”行为。
- 状态流转：node view UI input -> ProseMirror transaction -> node attrs/content -> serializer。
- 数据变更：editor doc。
- 计算公式：不涉及。
- 幂等设计：node view 不写私有持久字段。
- 权限/越权控制：Mermaid 使用现有 strict security；不注入 Mermaid error DOM。
- 异常处理：渲染失败显示错误，不修改源码。
- 补偿/重试：用户继续编辑源码或 undo。
- 日志与审计：不记录正文。

#### 4.4.3 流程步骤

1. 为每类高级节点增加 node view。
2. 实现交互命令。
3. 将交互变更映射为 transaction。
4. Serializer 输出对应 Markdown。

#### 4.4.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| Mermaid 语法错误 | 块内错误，不破坏源码 | 可继续编辑 | 测试 |
| Math 渲染失败 | 显示 LaTeX 和错误 | 可继续编辑 | 测试 |
| 表格粘贴大矩阵 | plan 可设上限和提示 | 不冻结 UI | 手动 |

### 4.5 App Integration 详细设计

#### 4.5.1 需求内容

- 入口：`EditorPane`、adapter、workspace/document save、CLI。
- 操作人/调用方：MDX app。
- 前置条件：新内核 API 可用。
- 输出结果：现有应用行为保持兼容。

#### 4.5.2 方案设计

- 核心逻辑：
  - `EditorPane` 移除全局源码模式 toolbar 和 `SourceModeEditor` 常规入口。
  - Adapter 保持 `currentMarkdown`、`resetMD`、`insertText`、`insertImage`、`getSelectionState` 等外部 API。
  - `data-mdx-*` DOM contract 保持 outline/find/replace/Mermaid integration 可用。
  - CLI insert/selection/content/save 外部语义不变。
- 状态流转：editor bridge -> workspace reducer -> save/recovery。
- 数据变更：现有 Markdown state。
- 计算公式：不涉及。
- 幂等设计：reset/insert 和现有语义一致。
- 权限/越权控制：不涉及。
- 异常处理：active editor 缺失沿用现有错误语义。
- 补偿/重试：现有 recovery/save conflict。
- 日志与审计：不记录正文。

#### 4.5.3 流程步骤

1. 扩展内核 API。
2. 更新 adapter。
3. 移除 global source mode UI。
4. 跑 workspace/document/CLI 相关测试。

#### 4.5.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| CLI insert 到高级节点附近 | 按当前 selection 插入或 fallback 到文本插入 | 与现有行为一致 | 测试 |
| find/replace 命中 node view | 只搜索可见文本，排除 generated UI | 结果准确 | 测试 |

## 五、存储类设计

### 5.1 库表设计

不涉及数据库。

#### 5.1.1 数据库模型图

不涉及。

#### 5.1.2 表结构

不涉及。

字段明细：不涉及。

### 5.2 数据迁移/初始化

- DDL：不涉及。
- DML：不涉及。
- 数据回填：不涉及。
- 老数据兼容：已有 `.md/.markdown` 继续打开；不支持片段进入 fallback block，不丢内容。
- 新老系统读写关系：Markdown 文件仍是唯一持久化真相。

### 5.3 缓存设计

| 场景 | Key | Value | 数据结构 | 过期时长 | 容量预估 | 失效/刷新策略 |
|---|---|---|---|---|---|---|
| Source metadata | editor instance | source ranges/dirty metadata | 内存对象 | editor 生命周期 | 与文档大小相关 | reset/open 时重建 |
| Render preview | node instance | Mermaid/math render result | 内存/DOM | node 生命周期 | 小到中 | 源码变更失效 |

## 六、其他组件设计

### 6.1 消息设计

不涉及消息。

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| 全局源码模式 | 全环境 | 禁用/移除 | 否 | 用户确认不保留 | 需要 fallback block 可靠 |

### 6.3 定时任务/批处理

不涉及。

### 6.4 技术组件

- 分布式锁：不涉及。
- 唯一 ID：footnote label 来自 Markdown；不写私有 ID。
- 加解密/验签：不涉及。
- 字典转换：Markdown token/node/mark 转换。
- Excel/文件处理：不涉及。
- 用户信息透传：不涉及。
- 限流/熔断：不涉及。

## 七、接口设计

### 7.1 接口设计原则

- 应用层 adapter API 尽量保持兼容。
- CLI 协议不变。
- Markdown serializer 输出普通 Markdown，不输出私有格式。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 权限/认证 | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|
| `MdxEditorProvider` props | Editor adapter | `packages/mdx-editor` | 不涉及 | reset 幂等 | 本文 | 接收初始 Markdown 和 change callback |
| `MdxEditorContextValue` | Adapter/EditorPane | `packages/mdx-editor` | 不涉及 | 视方法而定 | 本文 | focus、insert、selection |
| CLI editor commands | `mdx-cli` | Workspace app | socket 连接 | 现有语义 | 现有 README | 不改协议 |

### 7.3 接口明细

#### 7.3.1 `MdxEditorProvider`

- 路径/方法：React component。
- 请求头：不涉及。
- 请求参数：`initialMarkdown`、`editable`、`placeholder`、`imageLoader`、`onMarkdownChange` 等。
- 响应参数：React context。
- 错误码：不涉及。
- 业务校验：Markdown 解析失败进入 fallback，不抛出导致整页不可用。
- 数据变更：editor internal state。
- 日志字段：diagnostic 不记录正文。

#### 7.3.2 `MdxEditorContextValue`

- 路径/方法：React hook `useMdxEditor`。
- 请求头：不涉及。
- 请求参数：按方法传入，如 `insertText(text)`、`insertImage(url, altText)`。
- 响应参数：`currentMarkdown`、`selection`、命令方法。
- 错误码：不涉及。
- 业务校验：命令不可执行时 no-op 或返回 false，plan 可细化。
- 数据变更：editor state 和 Markdown。
- 日志字段：不记录正文。

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：本地单用户应用，不设用户灰度。
- 灰度开关：不做双内核开关。
- 验证指标：fixture tests、browser tests、手动编辑保存。
- 放量节奏：随本地构建发布。

### 8.2 降级方案

- 降级触发条件：某个 Markdown 片段无法结构化解析。
- 降级行为：该片段进入 block-level source fallback。
- 用户影响：局部以源码块编辑，但全局仍是 WYSIWYG。
- 恢复方式：修复 parser/schema/node view 后可结构化解析。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| Workspace/Document editor | 主编辑体验变化 | 内核补强和 UI 调整 | 前端 | 组件/浏览器测试 |
| Save/recovery | Markdown 输出更完整 | Serializer 保真 | 前端 | workspace save tests |
| CLI | 继续读取/插入/选择 | Adapter 保持兼容 | 前端/Rust | CLI protocol tests |
| Find/replace/outline | DOM contract 延续 | data-mdx 属性覆盖新节点 | 前端 | existing tests |

### 8.4 回滚方案

- 回滚条件：WYSIWYG 关键编辑/保存存在数据丢失风险。
- 回滚步骤：不建议回退闭源内核；应通过 fallback block 或局部禁用问题节点降级。
- 数据回滚：无 schema/database migration；用户文件是 Markdown。
- 配置回滚：无双内核开关。
- 风险：如果 fallback 不可靠，需暂停发布并修复。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：前端错误边界或控制台 warning。
- 业务异常：parser diagnostics、serializer mismatch、node view render error。
- 重试异常：用户可 undo 或重新打开。
- 超时：大型文档 parse/render 可在 plan 中加入大小提示。
- 关键接口指标：本地应用无集中指标。
- 告警渠道：不涉及。

### 9.2 性能与容量

- TPS/吞吐：单用户编辑。
- CPU/内存/磁盘 IO/网络 IO：ProseMirror 大文档和高级 node view 是主要 CPU/内存压力；网络不涉及。
- 数据容量：沿用原设计目标，1MB/10k 行流畅编辑，10MB/100k 行可打开搜索保存但不承诺完全流畅。
- 缓存容量：source metadata 和 render result 与文档大小相关。
- 跑批耗时：不涉及。
- 是否压测：需要大文档手动/脚本验证。

### 9.3 可靠性与兜底

- 幂等击穿：serializer 必须避免未编辑内容被无故重排。
- 并发失效：React state 和 ProseMirror state 同步需避免 stale markdown 覆盖。
- 冷热备：不涉及。
- 兜底：block-level source fallback、undo/redo、现有 draft recovery。

## 十、排期与规划

### Planning Handoff

`plan-to-exec` 可决定：

- 具体 Markdown parser/serializer 依赖。
- 高级节点实现顺序。
- ProseMirror plugin 文件拆分。
- Toolbar/inline menu 的局部 UI。
- Browser test 工具和 fixture 组织。
- Fallback block 的具体交互。

必须返回 `spec` 或 `clarify`：

- 恢复全局源码模式。
- 回退闭源内核或引入非商业限制许可内核。
- 改变 CLI 外部协议。
- Mermaid 或 math 要求可视化编辑器。
- Markdown 不再作为唯一持久化真相。

建议下一步：

```text
$plan-to-exec docs/loopx/design/Markdown所见即所得内核补强需求设计文档.md
```

## 十一、QA

- Kernel fixture tests：
  - 基础 Markdown parse/render/serialize：heading、paragraph、marks、links、images、lists、blockquote、code。
  - 高级 Markdown：table、task list、footnote、math、callout、Mermaid。
  - Unsupported/invalid syntax fallback 不丢内容。
- Component tests：
  - `MdxEditorProvider` 实时 emit Markdown changes。
  - `EditorPane` 不再显示全局源码模式。
  - Node views 交互更新 doc。
  - Adapter API 兼容。
- Clipboard/browser tests：
  - `Cmd+C` 复制 plain text 和 HTML。
  - 从外部粘贴 Markdown/HTML/plain text。
  - 复制回 MDX 保持结构。
- Integration tests：
  - Workspace save/recovery 不回归。
  - CLI content/selection/insert/save 不回归。
  - Find/replace 和 outline 对新 DOM contract 可用。
- Manual QA：
  - 中文 IME 输入。
  - 表格编辑、任务勾选、脚注编辑、math/Mermaid 错误修复。
  - 大文档打开、搜索、保存。
