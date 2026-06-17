# 自研Markdown所见即所得内核设计文档

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿，基于 clarify 结果形成自研 Markdown WYSIWYG 内核替换方案 | 2026-06-17 | Codex |

## 二、需求信息

### 2.1 需求背景

- 背景：当前 MDX 的 Markdown 编辑核心依赖 `@do-md/react`。仓库证据显示该内核以 `.packages/@do-md/dist/index.js`、`index.cjs`、`style.css` 编译产物提供，`LICENSE` 声明其使用 PolyForm Noncommercial License 1.0.0，`types/do-md-react.d.ts` 明确称其为 closed-source kernel。
- 需求目的：实现 MDX 自己拥有的 Markdown-native 所见即所得编辑内核，最终完全移除闭源内核依赖，并在功能、兼容性、源码保真、编辑体验上达到或超过当前内核。
- 目标用户/使用方：当前用户本人、MDX 桌面端 Workspace Mode / Document Mode、`mdx-cli` 和本地 Agent 自动化。
- 需求链接：无外部 PRD。
- 关联原始材料：
  - 澄清记录：`.loopx/intake/clarify-self-owned-markdown-wysiwyg-kernel-20260617154047.md`
  - 现有编辑器长期规则：`docs/loopx/specs/editor.md`
  - 测试长期规则：`docs/loopx/specs/testing.md`
  - 当前内核 adapter：`features/editor/components/editor-kernel-adapter.tsx`
  - 当前 editor bridge：`features/editor/hooks/use-editor-bridge.ts`
  - 当前 editor pane：`features/editor/components/editor-pane.tsx`

### 2.2 需求范围

- 本期范围：
  - 新建 `packages/mdx-editor/`，作为自研编辑内核源码包。
  - 基于 ProseMirror 实现 WYSIWYG 编辑状态、transaction、selection、commands、node views 和 React 集成。
  - 自研 Markdown schema、parser -> editor doc 映射、serializer、命令系统、插件系统、DOM contract。
  - 允许使用 `micromark` / mdast / remark-gfm 等开源 Markdown 解析生态，但 MDX 规格测试是权威；不兼容关键场景时重写相关层。
  - 允许使用 CodeMirror 6 做源码模式。
  - 支持 CommonMark + GFM + MDX 扩展：wikilink、Mermaid、frontmatter、math、footnote、Obsidian 风格 callout。
  - 源码保真优先，未编辑区域尽量复用原始 Markdown。
  - 提供 WYSIWYG 主模式和源码模式。
  - 提供工具栏、选区浮动菜单、块级 handle、表格上下文菜单。
  - 迁移 Workspace Mode、Document Mode、CLI、图片、find/replace、Mermaid、outline scroll、wikilink 点击到新内核。
  - 最终删除 `.packages/@do-md/dist/`、`types/do-md-react.d.ts`、`tsconfig.json` 中 `@do-md/react` path。
- 非目标：
  - 不保留长期双内核切换。
  - 不兼容旧 `DOMD-*` DOM class 名称；只保留用户行为兼容。
  - 不做多人实时协作、CRDT/Yjs、块 ID 强制写入、数据库文档模型主存储。
  - 不做 Notion 式块数据库。
  - 不做内置图片编辑、裁剪、标注。
  - 第一版不做表格合并单元格、单元格块级内容、Excel 级公式。
  - 不把 Mermaid、math、callout、wikilink 保存成私有格式。
- 决策边界：
  - 可由 plan 决定：文件拆分、模块命名、fixture 组织、ProseMirror 插件实现顺序、解析库初始组合、工具栏视觉细节。
  - 必须回 spec：改变 Markdown-native 主存储、放弃源码保真优先、改变 CLI 外部语义、改变 dirty/save/reload 合约、引入长期双内核切换。
  - 必须回 clarify：要求完全不使用 ProseMirror 或 Markdown 解析生态、要求第一版超大文档全量流畅 WYSIWYG、要求第一版发布通用 npm 产品。
- 依赖方：
  - ProseMirror 生态，预期 MIT 开源。
  - CodeMirror 6，预期 MIT 开源。
  - Markdown 解析生态，如 micromark/mdast/remark-gfm。
  - Mermaid、Prism、现有图片 asset、workspace、CLI、recovery 模块。
- 约束条件：
  - 当前用户是唯一用户，不需要用户可见灰度或双内核开关。
  - 文件仍以普通 `.md/.markdown` 为唯一真相。
  - 运行时内存可保存 source map / dirty map / original source range，但不能落盘为隐藏文档模型。
  - 第一阶段性能目标：10k 行 / 1MB 文档可流畅编辑；100k 行 / 10MB 文档可打开、搜索、保存，但不承诺完全流畅 WYSIWYG。

### 2.3 可行性分析

- 业务可行性：用户明确要求去闭源依赖，且当前仅单用户使用，可以接受不做双内核回退，业务决策清晰。
- 技术可行性：ProseMirror 能覆盖编辑状态、selection、transaction、undo、schema、plugin 等底层难题；MDX 可把研发重点放在 Markdown 映射、源码保真和业务集成。
- 团队接受能力：工程量高，但可以通过 `packages/mdx-editor/` 独立包、规格测试先行和现有 `EditorKernelAdapter` 边界分阶段推进。
- 时间成本：高。难点集中在局部源码保真、复杂 Markdown 方言、IME、表格、图片、Mermaid、CLI selection 和旧 DOM contract 迁移。
- 资源成本：本地前端包，无后端资源；新增依赖需要许可证检查和打包体积评估。
- 替代方案：
  - 继续使用 `@do-md/react`：短期最低成本，但闭源和商业授权风险继续存在。
  - 直接使用 Tiptap：实现快，但高层封装会限制 MDX 对 Markdown schema、serializer、源码保真的控制。
  - 从 contenteditable 层完全手写：控制力最高，但 IME、selection、undo、嵌套结构风险过高。
  - 只做源码编辑器：无法满足所见即所得和更强大体验。
- 关键风险：
  - 局部源码保真和 ProseMirror transaction 的映射复杂。
  - CommonMark + GFM + 多扩展组合测试面大。
  - IME 和剪贴板行为需要真实浏览器手动验收。
  - 大文档全量 ProseMirror doc 可能触及性能上限，后续可能需要增量解析或分块渲染。

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 完全替换闭源 `@do-md/react`。
  - 保持 Markdown 文件可迁移、可审计、可被其他编辑器读取。
  - 在 WYSIWYG、源码模式、表格、图片、链接、Mermaid、math、callout 等体验上超过当前内核。
  - 保持 Workspace/Document Mode 和 CLI 外部行为兼容。
- 总体思路：
  - 新建 `packages/mdx-editor/`，内部实现 parser、schema、serializer、commands、plugins、React 组件和测试 fixtures。
  - 使用 ProseMirror 管理可编辑文档和交互。
  - 使用 Markdown 解析生态读取 CommonMark/GFM/扩展语法，构建带 source range 的中间模型。
  - 序列化时依据 dirty map：未编辑区域复用原始 Markdown，编辑过的节点稳定输出。
  - 提供新的 MDX editor DOM contract，迁移现有 find/replace、Mermaid、outline、selection scope。
  - 最后替换旧 adapter 引用并删除闭源 dist。
- 核心模块：
  - Markdown parser/source map
  - Editor schema
  - Serializer/source preservation
  - Command system
  - Input rules and keymaps
  - Node views and UI overlays
  - Source mode
  - React adapter
  - App integration bridge
  - Spec fixtures and verification
- 主要难点：
  - 局部编辑后的源码保真。
  - wikilink、Mermaid、math、footnote、callout 与 CommonMark/GFM 的组合。
  - IME、undo/redo、selection、paste/drop。
  - 表格结构化编辑和 GFM 输出。
  - 替换当前 DOMD 相关测试和 helper。
- 技术指标：
  - 10k 行 / 1MB 文档流畅编辑。
  - 100k 行 / 10MB 文档可打开、搜索、保存。
  - 打开未编辑文档后保存不得全文件重排。
  - CLI selection 字段兼容当前协议。

### 3.2 整体架构设计

- 业务模式：本地优先 Markdown 桌面编辑器，WYSIWYG 为主，源码模式为安全出口。
- 系统边界：
  - `packages/mdx-editor/` 负责通用编辑内核。
  - `features/editor/` 负责 MDX 应用集成，包括图片 asset、CLI bridge、Mermaid layer、find/replace、workspace/document mode。
  - Rust/Tauri 仍负责文件系统、状态持久化、CLI socket 和原有系统能力。
- 上下游系统：
  - 上游：Markdown 文件内容、CLI insert/selection/focus 请求、用户键盘/鼠标/粘贴/拖拽输入。
  - 下游：Markdown 字符串、selection snapshot、DOM contract、图片 asset 存储、Mermaid render。
- 应用架构：
  - `MdxEditorProvider` 初始化编辑状态和 source map。
  - `MdxEditorView` 渲染 ProseMirror view 和 overlay UI。
  - `useMdxEditorBridge` 暴露 `currentMarkdown`、`focus`、`insertText`、`insertImage`、`selection`、`resetMarkdown`。
  - `EditorPane` 消费新的 bridge，减少对内核内部 DOM 的假设。
- 技术架构：
  - Parser：Markdown text -> parsed tokens / AST -> MDX intermediate document with source ranges -> ProseMirror doc。
  - Runtime：ProseMirror state + plugins + node views + dirty/source metadata。
  - Serializer：ProseMirror doc + original source map + dirty map -> Markdown text。
  - Source mode：CodeMirror text editor 与 WYSIWYG 共享 Markdown 文本真相。
- 数据流转：
  - 打开文件：Markdown -> parser -> editor doc/source map -> WYSIWYG。
  - 编辑：ProseMirror transaction -> dirty metadata -> current Markdown memo。
  - 保存：serializer 输出 Markdown -> Workspace/Document save。
  - 源码模式切换：WYSIWYG serialize -> CodeMirror text；返回时 parse text -> editor doc。

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| 打开 Markdown | 用户打开 tab 或 Document Mode | Workspace/Document、MdxEditor、parser | 读取 Markdown，解析 source map，创建 ProseMirror doc，渲染 WYSIWYG | 解析失败时进入源码模式并保留原文 | 可编辑文档 |
| WYSIWYG 编辑 | 用户键盘、鼠标、菜单操作 | ProseMirror、commands、serializer | transaction 更新 doc 和 dirty map，桥接层计算 currentMarkdown | 不支持节点作为 opaque/source block 保留 | dirty Markdown |
| 源码模式切换 | 用户切换源码模式 | serializer、CodeMirror、parser | WYSIWYG 序列化为文本，源码编辑后重新解析 | 解析失败停留源码模式并提示 | 统一 Markdown 文本 |
| 保存 | 用户或 CLI save | editor bridge、workspace save | serializer 输出 Markdown，沿用现有保存/冲突检测 | 保存失败保持 dirty 和恢复数据 | 磁盘 Markdown |
| CLI insert/selection | `mdx-cli` 请求 | CLI socket、EditorPane、bridge | focus 编辑器，插入文本或读取 selection snapshot | 无活动 editor 返回现有错误语义 | CLI 响应 |
| 图片粘贴/拖拽 | 粘贴或 drop 图片 | EditorPane、asset storage、editor command | 图片存储到 `.assets/`，插入 image node | 存储失败提示并不改文档 | Markdown image |
| Mermaid 预览 | 文档包含 mermaid fence | parser、node view、Mermaid renderer | 识别 fenced code，渲染预览，可切回源码编辑 | Mermaid 渲染失败显示 MDX 错误 UI | 预览和源码保真 |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| `packages/mdx-editor/parser` | Markdown 解析和 source map | CommonMark/GFM/扩展解析、opaque 保留 | micromark/mdast 可选 | 库不兼容则重写相关层 |
| `packages/mdx-editor/schema` | 编辑模型 | block/inline nodes、marks、attrs | ProseMirror model | 不写私有格式 |
| `packages/mdx-editor/serializer` | Markdown 输出 | 未编辑源码复用、局部重写 | source map、dirty map | 核心风险点 |
| `packages/mdx-editor/commands` | 编辑命令 | marks、links、tables、images、blocks | ProseMirror commands | UI 和 CLI 共用 |
| `packages/mdx-editor/plugins` | 编辑增强 | input rules、keymap、history、clipboard、IME guard | ProseMirror plugins | 需要浏览器验收 |
| `packages/mdx-editor/react` | React 集成 | Provider、View、toolbars、menus、hooks | React 19 | 被 `features/editor` 消费 |
| `features/editor` 集成层 | 应用适配 | CLI bridge、find/replace、Mermaid、outline、图片 | MDX workspace | 替换旧 adapter |

### 3.5 新增/调整功能说明

- 新增 `packages/mdx-editor/` 内核包。
- 新增 MDX editor DOM contract：
  - `data-mdx-editor-root`
  - `data-mdx-text`
  - `data-mdx-syntax`
  - `data-mdx-code-block`
  - `data-mdx-node-type`
  - `data-mdx-mermaid-preview`
- 调整 `features/editor/components/editor-kernel-adapter.tsx`：从包装 `@do-md/react` 改为包装 `packages/mdx-editor/react`。
- 调整 `features/editor/hooks/use-editor-bridge.ts`：改用新 bridge API，保留对外返回字段。
- 调整 DOM helper：`visible-text-search`、`mermaid-dom`、`keyboard-selection-scope`、`markdown-line-scroll` 从 `DOMD-*` 迁移到 data attribute。
- 调整测试：DOMD fixtures 替换为 MDX DOM contract fixtures。

## 四、详细设计

### 4.1 Markdown Parser And Source Map 详细设计

#### 4.1.1 需求内容

- 入口：`parseMarkdown(markdown, options)`。
- 操作人/调用方：`MdxEditorProvider`、源码模式返回 WYSIWYG、测试 fixtures。
- 前置条件：输入为 UTF-8 Markdown 字符串。
- 输出结果：ProseMirror doc、source map、opaque ranges、diagnostics。

#### 4.1.2 方案设计

- 核心逻辑：
  - 使用 Markdown parser 生成带位置的 AST/token stream。
  - 将 AST 映射为 MDX intermediate document，再映射为 ProseMirror doc。
  - 每个可保真节点记录 source range、原始文本、语法风格属性，例如 fence char/length、list marker、heading style、table alignment。
  - 不理解但合法的 Markdown/HTML 作为 opaque block/inline 保留。
- 状态流转：raw Markdown -> parsed tree -> intermediate doc -> ProseMirror doc + source map。
- 数据变更：仅内存结构，不落盘。
- 计算公式：不涉及。
- 幂等设计：同一 Markdown 输入在同一 parser 版本下生成稳定 doc 和 source map。
- 权限/越权控制：不涉及。
- 异常处理：解析异常时返回 diagnostics；致命异常时进入源码模式，不丢原文。
- 补偿/重试：用户可在源码模式修复后重新解析。
- 日志与审计：开发环境可输出 parser diagnostics；生产不记录文档正文。

#### 4.1.3 流程步骤

1. 读取 Markdown 文本。
2. 执行 frontmatter、block、inline 解析。
3. 生成 source range 和原始片段引用。
4. 映射为 ProseMirror doc。
5. 返回 doc、metadata、diagnostics。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 不支持的 HTML | opaque 保留 | WYSIWYG 中显示源码块或只读块 | parser diagnostic |
| 不闭合 fence | 尽量按 Markdown parser 结果保留 | 源码模式可编辑 | diagnostic |
| 扩展语法冲突 | 规格测试决定优先级 | 稳定渲染或保真 | 测试失败 |

### 4.2 Editor Schema And Runtime 详细设计

#### 4.2.1 需求内容

- 入口：`createMdxEditorState`、`MdxEditorView`。
- 操作人/调用方：React editor 组件、commands、plugins。
- 前置条件：parser 已生成 doc 或源码模式已提供 Markdown。
- 输出结果：可交互 WYSIWYG 编辑器。

#### 4.2.2 方案设计

- 核心逻辑：
  - 定义 Markdown-first schema：doc、paragraph、heading、blockquote、list、task item、code block、table、image、link、wikilink、math、footnote、callout、frontmatter、opaque。
  - Marks 覆盖 bold、italic、strike、inline code、link 等。
  - Node attrs 保存语义属性，不保存私有持久化 ID。
  - ProseMirror plugin 管理 history、keymap、input rules、clipboard、composition guard、dirty tracking。
- 状态流转：editor state -> transactions -> updated doc + metadata。
- 数据变更：内存状态变更，通过 serializer 输出 Markdown。
- 计算公式：不涉及。
- 幂等设计：命令对当前 selection 执行；重复命令按编辑器常规 toggle/insert 行为。
- 权限/越权控制：不涉及。
- 异常处理：命令不可执行时返回 false，UI 禁用或无操作。
- 补偿/重试：undo/redo 恢复 transaction。
- 日志与审计：不记录正文。

#### 4.2.3 流程步骤

1. 根据 doc 和 plugins 创建 ProseMirror state。
2. 渲染 editor view 和 node views。
3. 用户输入触发 transaction。
4. plugins 更新 dirty map、selection snapshot、UI 状态。
5. bridge 通知应用层 Markdown 变化。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| IME composition 中输入 Markdown trigger | composition 期间不执行破坏性 input rule | 中文输入稳定 | 手动验收 |
| 复杂嵌套列表 | 遵循 ProseMirror list 行为并加 fixture | 列表缩进稳定 | 测试 |
| selection 跨 opaque 节点 | 限制编辑或整体选中 | 不丢内容 | 测试 |

### 4.3 Serializer And Source Preservation 详细设计

#### 4.3.1 需求内容

- 入口：`serializeMarkdown(editorState, sourceMap, dirtyMap)`。
- 操作人/调用方：bridge、保存、源码模式切换、测试。
- 前置条件：editor doc 和 source metadata 可用。
- 输出结果：Markdown 字符串。

#### 4.3.2 方案设计

- 核心逻辑：
  - 未编辑节点优先复用 original source slice。
  - 编辑过节点按 MDX serializer 规则输出。
  - 父子 dirty 状态向上合并，保证结构边界合法。
  - 对无法局部合并的复杂 block，重写最小安全 block 范围。
  - 保留 frontmatter、HTML、注释、空行、list marker、fence 风格等未触碰源码。
- 状态流转：doc + original source + dirty ranges -> Markdown。
- 数据变更：输出字符串，不直接写磁盘。
- 计算公式：不涉及。
- 幂等设计：未编辑文档 serialize 应输出原文；连续 serialize 不产生额外变化。
- 权限/越权控制：不涉及。
- 异常处理：serializer 失败时阻止保存，提示用户切源码模式或报告错误。
- 补偿/重试：保留当前 editor state，不清 dirty。
- 日志与审计：错误日志不得包含完整正文，可包含节点类型和位置。

#### 4.3.3 流程步骤

1. 遍历 editor doc。
2. 根据 dirty map 判断节点复用原文或重写。
3. 合并 Markdown 片段。
4. 校验输出可再次 parse。
5. 返回 Markdown。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 未编辑文档 | 返回原文 | 保存无 diff | fixture |
| 编辑列表中一个 item | 重写最小列表范围 | 其他段落不变 | fixture |
| opaque HTML 被移动 | 整块原文移动或转源码模式 | 内容不丢 | diagnostic |

### 4.4 Source Mode 详细设计

#### 4.4.1 需求内容

- 入口：用户切换源码模式。
- 操作人/调用方：用户、EditorPane。
- 前置条件：当前文档已加载。
- 输出结果：CodeMirror Markdown 文本编辑器。

#### 4.4.2 方案设计

- 核心逻辑：
  - WYSIWYG -> source：先 serialize 当前 editor state，作为 CodeMirror 文本。
  - source -> WYSIWYG：解析 CodeMirror 文本，成功则更新 editor doc，失败则停留源码模式。
  - 两种模式共享同一个 Markdown 文本真相，不引入额外持久化。
- 状态流转：wysiwyg | source。
- 数据变更：源码模式编辑直接更新 Markdown 文本和 dirty state。
- 计算公式：不涉及。
- 幂等设计：模式切换不应引入无意义 diff。
- 权限/越权控制：不涉及。
- 异常处理：解析失败展示错误并保留源码编辑内容。
- 补偿/重试：用户修复源码后重试切换。
- 日志与审计：不记录正文。

#### 4.4.3 流程步骤

1. 用户点击源码模式。
2. serializer 输出 Markdown。
3. CodeMirror 加载文本。
4. 用户编辑。
5. 返回 WYSIWYG 时 parse 文本。

#### 4.4.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| serializer 失败 | 阻止进入源码模式或进入只读原文对照 | 显示错误 | 错误日志 |
| 源码解析失败 | 留在源码模式 | 可继续编辑 | diagnostic |
| 外部 reload | 沿用现有 dirty/recovery 策略 | 不丢草稿 | 现有测试 |

### 4.5 App Integration 详细设计

#### 4.5.1 需求内容

- 入口：`EditorPane` 渲染、CLI command、图片粘贴/拖拽、find/replace、Mermaid、outline。
- 操作人/调用方：WorkspaceShell、Document Mode、CLI socket。
- 前置条件：新内核 React adapter 可用。
- 输出结果：现有用户行为兼容。

#### 4.5.2 方案设计

- 核心逻辑：
  - 保留 `features/editor/components/editor-kernel-adapter.tsx` 文件作为应用边界，但内部改为新内核。
  - `use-editor-bridge` 暴露当前应用需要的稳定 API，不暴露 ProseMirror 细节。
  - 迁移 DOM helper 到新 data attribute。
  - Mermaid 优先作为 code block node view 能力；现有 preview layer 可在迁移期复用，但选择器必须改为新 contract。
  - find/replace 继续搜索可见文本，排除 `data-mdx-syntax` 和 `data-mdx-mermaid-preview`。
  - CLI selection snapshot 由 editor state/selection 计算，不直接依赖 DOM 文本拼接。
- 状态流转：应用 markdown prop -> editor state -> currentMarkdown -> app dirty/save。
- 数据变更：与现有 workspace reducer/save 流程兼容。
- 计算公式：selection before/after 按 Markdown 文本上下文计算，默认 contextChars 与当前行为兼容。
- 幂等设计：reset Markdown 不应触发虚假 dirty emission。
- 权限/越权控制：文件写入仍由现有 Tauri 后端控制。
- 异常处理：内核异常不得删除草稿；进入源码模式或显示 editor error。
- 补偿/重试：沿用 recovery/draft 机制。
- 日志与审计：避免记录正文。

#### 4.5.3 流程步骤

1. 替换 adapter 内部导入。
2. 更新 bridge API 调用。
3. 替换 DOM selector 和测试 fixtures。
4. 迁移 Mermaid/find/replace/outline/selection。
5. 删除旧内核 path 和 dist。

#### 4.5.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| CLI insert 时 editor 未 ready | 保持当前错误或排队语义 | CLI 得到明确响应 | 测试 |
| Mermaid preview 失败 | 显示 MDX 错误 UI，不注入 Mermaid 错误 DOM | 可回源码编辑 | 测试 |
| find/replace 命中 syntax | 排除 `data-mdx-syntax` | 不改隐藏语法 | 测试 |

## 五、存储类设计

### 5.1 库表设计

#### 5.1.1 数据库模型图

不涉及。该需求不新增数据库。Markdown 文件仍是唯一文档真相。

#### 5.1.2 表结构

| 表名 | 用途 | 主键 | 关键索引 | 数据量预估 | 备注 |
|---|---|---|---|---|---|
| 不涉及 | 不新增数据库表 | 不涉及 | 不涉及 | 不涉及 | 文档状态在内存中维护 |

字段明细：

| 字段 | 类型 | 是否必填 | 默认值 | 含义 | 来源/取值逻辑 | 备注 |
|---|---|---|---|---|---|---|
| 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

### 5.2 数据迁移/初始化

- DDL：不涉及。
- DML：不涉及。
- 数据回填：不涉及。
- 老数据兼容：
  - 所有现有 `.md/.markdown` 文件继续按 Markdown 读取。
  - 不写入私有 sidecar 或隐藏 JSON。
  - 对旧内核曾输出的普通 Markdown 保持兼容。
- 新老系统读写关系：
  - 迁移完成后只由新内核读写 Markdown。
  - 旧 `@do-md/react` 不保留生产路径。

### 5.3 缓存设计

| 场景 | Key | Value | 数据结构 | 过期时长 | 容量预估 | 失效/刷新策略 |
|---|---|---|---|---|---|---|
| source map | editor instance id | source ranges、original slices | 内存对象 | editor 生命周期 | 与文档大小线性相关 | reset/reparse 时刷新 |
| dirty map | editor instance id | dirty node/range 标记 | 内存对象 | editor 生命周期 | 与编辑次数相关 | transaction 更新，reset 清空 |
| Mermaid render cache | fence stable key | rendered SVG/error | 内存 Map | editor 生命周期 | 与 Mermaid 块数量相关 | code/theme 变化失效 |

## 六、其他组件设计

### 6.1 消息设计

| 场景 | Group | Topic | 生产者 | 消费者 | 幂等键 | 失败补偿 |
|---|---|---|---|---|---|---|
| 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| 源码模式开关 | local | 开启 | 是 | 用户可进入源码模式 | 关闭会降低复杂 Markdown 兜底能力 |
| Mermaid 预览 | local | 开启 | 是 | 复用现有 Mermaid 能力 | 渲染错误需隔离 |
| Math 预览 | local | 开启 | 是 | 用于 `$` / `$$` 公式预览 | KaTeX 依赖体积 |

### 6.3 定时任务/批处理

| 任务 | 触发时间 | 处理范围 | 幂等 | 失败重试 | 影响评估 |
|---|---|---|---|---|---|
| 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

### 6.4 技术组件

- 分布式锁：不涉及。
- 唯一 ID：不写持久化块 ID；运行时节点可用 ProseMirror position/plugin key 管理。
- 加解密/验签：不涉及。
- 字典转换：Markdown token/node type 到 schema node type 的映射。
- Excel/文件处理：表格粘贴支持 CSV/HTML table 转 GFM table。
- 用户信息透传：不涉及。
- 限流/熔断：不涉及。

## 七、接口设计

### 7.1 接口设计原则

- 内核 API 必须隐藏 ProseMirror 细节，只暴露 MDX 应用需要的稳定操作。
- 外部应用行为兼容现有 `EditorBridge` 和 CLI 语义。
- 任何会修改文档的命令必须通过 transaction，确保 undo/redo 和 dirty map 正确。
- selection snapshot 必须从当前 Markdown 语义文本计算，字段兼容现有 CLI。
- 错误不得吞掉正文，不得自动删除草稿。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 权限/认证 | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|
| `MdxEditorProvider` | `EditorPane` | `packages/mdx-editor/react` | 本地组件 | reset 同输入幂等 | 本文 | 初始化编辑器 |
| `useMdxEditor` | `use-editor-bridge` | `packages/mdx-editor/react` | 本地 hook | 查询幂等 | 本文 | 暴露 focus/commands/state |
| `serializeMarkdown` | bridge/save/source mode | serializer | 本地函数 | 未编辑文档幂等 | 本文 | 输出 Markdown |
| `insertText` | CLI/find-replace/UI | command system | 本地函数 | 非幂等 | 本文 | 插入用户文本 |
| `insertImage` | paste/drop/UI | command system | 本地函数 | 非幂等 | 本文 | 插入 Markdown image |
| `getSelectionSnapshot` | CLI sync | editor bridge | 本地函数 | 查询幂等 | 本文 | 兼容现有 selection |

### 7.3 接口明细

#### 7.3.1 `MdxEditorProvider`

- 路径/方法：React component。
- 请求头：不涉及。
- 请求参数：
  - `initialMarkdown: string`
  - `editable: boolean`
  - `placeholder?: string`
  - `imageLoader?: (src: string) => Promise<string>`
  - `codeTokenizer?: (code: string, lang?: string) => unknown[]`
  - `onMarkdownChange?: (markdown: string) => void`
- 响应参数：children context。
- 错误码：不涉及；组件内错误以 UI error boundary/diagnostic 暴露。
- 业务校验：Markdown 输入必须为字符串。
- 数据变更：创建 editor state。
- 日志字段：错误类型、节点类型、位置；不记录正文。

#### 7.3.2 `useMdxEditor`

- 路径/方法：React hook。
- 请求头：不涉及。
- 请求参数：无。
- 响应参数：
  - `currentMarkdown: string`
  - `selection: SelectionState | null`
  - `focus(): void`
  - `resetMarkdown(markdown: string): void`
  - `insertText(text: string): void`
  - `insertImage(url: string, altText?: string, title?: string): void`
  - `getSelectionSnapshot(contextChars?: number): SelectionState | null`
- 错误码：不涉及。
- 业务校验：无 editor context 时返回 null 或 no-op，调用方处理。
- 数据变更：命令类方法修改 editor state。
- 日志字段：不涉及。

#### 7.3.3 `SelectionState`

- 路径/方法：TypeScript interface。
- 请求头：不涉及。
- 请求参数：`contextChars?: number`。
- 响应参数：
  - `has_selection: boolean`
  - `selected_text: string`
  - `before: string`
  - `after: string`
  - `before_truncated: boolean`
  - `after_truncated: boolean`
- 错误码：不涉及。
- 业务校验：contextChars 应限制最大值，避免 CLI payload 过大。
- 数据变更：无。
- 日志字段：不记录 selection 正文。

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：当前用户本人，本地开发和打包安装验证。
- 灰度开关：不做用户可见双内核开关；开发阶段可有测试/开发入口，但生产路径最终只有新内核。
- 验证指标：
  - 规格测试通过。
  - Workspace/Document Mode 冒烟通过。
  - CLI 合约测试通过。
  - 大文档 smoke test 达标。
  - 打开保存未编辑 fixtures 无 diff。
- 放量节奏：单用户本地替换，无外部分批。

### 8.2 降级方案

- 降级触发条件：新内核导致关键文档无法打开/保存、serializer 有丢内容风险、IME 严重不可用。
- 降级行为：在代码层回退到上一个 git 版本或暂停合并；不设计长期运行时回退。
- 用户影响：当前用户需回到旧版本继续编辑。
- 恢复方式：修复规格测试和回归问题后重新打包。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| Workspace Mode | 编辑器替换 | 更新 EditorPane/bridge | Codex | Workspace 回归 |
| Document Mode | 编辑器替换 | 复用 EditorPane 验证 | Codex | Document 回归 |
| CLI | selection/insert/content 兼容 | 更新 bridge snapshot | Codex | CLI 合约测试 |
| Mermaid | DOMD selector 迁移 | 改为新 DOM contract 或 node view | Codex | Mermaid 测试 |
| Find/Replace | DOMD selector 迁移 | 改为 `data-mdx-*` | Codex | visible text 测试 |
| Outline Scroll | DOMD root 迁移 | 改为 heading node data attr | Codex | scroll 测试 |
| 图片资产 | command 迁移 | 新 insertImage command | Codex | paste/drop 测试 |

### 8.4 回滚方案

- 回滚条件：
  - serializer fixture 发现丢内容。
  - 手动验收发现 IME 输入不可用。
  - 保存/恢复链路破坏草稿安全。
- 回滚步骤：
  - 使用版本控制回退到替换前提交。
  - 保留新增 fixtures 作为失败案例。
  - 修复设计或实现后重新进入计划。
- 数据回滚：不涉及数据库；Markdown 文件如果已被错误保存，需要依赖 git/备份/草稿恢复。
- 配置回滚：不涉及。
- 风险：不做生产双内核回退，要求替换前测试门槛足够严格。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：前端 error boundary 捕获 editor 初始化、parse、serialize、node view 异常。
- 业务异常：serializer 失败、源码解析失败、图片加载失败、Mermaid 渲染失败。
- 重试异常：源码模式解析可用户手动重试；Mermaid 可随源码变化重试。
- 超时：大文档 parse/serialize 需要开发期性能日志；第一版不做后台 worker 强要求，但设计可预留。
- 关键接口指标：parse time、serialize time、document size、node count、Mermaid render error count。
- 告警渠道：本地应用无远程告警；开发期 console/error UI，不记录正文。

### 9.2 性能与容量

- TPS/吞吐：不涉及服务端 TPS。
- CPU/内存/磁盘 IO/网络 IO：
  - parse/serialize CPU 与文档大小相关。
  - ProseMirror doc 和 source map 内存与文档大小线性相关。
  - 图片加载沿用现有本地 asset 机制。
- 数据容量：
  - 10k 行 / 1MB 文档可流畅编辑。
  - 100k 行 / 10MB 文档可打开、搜索、保存。
- 缓存容量：Mermaid render cache、source map、dirty map 均限制在 editor 生命周期。
- 跑批耗时：不涉及。
- 是否压测：需要大文档 smoke test，不要求完整压测体系。

### 9.3 可靠性与兜底

- 幂等击穿：reset Markdown 和未编辑 serialize 必须幂等。
- 并发失效：沿用现有 workspace save fingerprint 和外部变更冲突策略。
- 冷热备：不涉及。
- 关键任务独立性：parse、edit、serialize、save 分层，serializer 失败不得触发磁盘写入。
- 字段兜底：未知 Markdown/HTML 以 opaque 保真兜底。
- 老新数据兼容：普通 Markdown 文件兼容；旧 DOMD DOM class 不兼容。

## 十、排期与规划

### 10.1 任务拆分与工作量评估

| 任务 | 范围 | 负责人 | 工作量 | 依赖 | 备注 |
|---|---|---|---|---|---|
| 规格测试套件 | fixtures、roundtrip、源码保真、扩展语法 | Codex | 高 | 本设计 | 替换门槛 |
| 内核包脚手架 | `packages/mdx-editor/`、构建和测试配置 | Codex | 中 | 规格测试 | 不发布 npm |
| parser/source map | Markdown -> editor doc | Codex | 高 | 解析依赖 | 核心风险 |
| schema/runtime | ProseMirror schema、plugins、commands | Codex | 高 | 内核脚手架 | 覆盖基础编辑 |
| serializer | source preservation 和局部重写 | Codex | 高 | parser/schema | 核心风险 |
| 源码模式 | CodeMirror 集成 | Codex | 中 | serializer/parser | 安全出口 |
| UI 能力 | 工具栏、浮层、表格、图片、链接 | Codex | 高 | commands | 更强大体验 |
| 应用迁移 | EditorPane、bridge、DOM helper、CLI | Codex | 高 | 内核可用 | 替换旧内核 |
| 删除旧内核 | 移除 dist/types/path | Codex | 低 | 全量验证 | 最终目标 |

### 10.2 计划时间

- 数据方案评审：不涉及数据库；需要设计评审。
- 开发开始/结束：由 `plan-to-exec` 拆分后确定。
- CR：每个阶段完成后进行。
- 联调完成/提测：应用迁移阶段完成后。
- 测试用例评审：规格测试套件阶段必须先完成。
- 测试开始/结束：贯穿开发阶段。
- 预发布：本地打包安装。
- 上线：替换本机 MDX 应用。
- 线上验证：本地真实工作区文档验证。

### 10.3 发布计划

1. 需求纳入发布版本。
2. 建立规格测试和 fixture。
3. 开发 `packages/mdx-editor/`。
4. 接入应用层开发入口验证。
5. 替换 Workspace/Document Mode 生产路径。
6. 删除旧内核依赖。
7. 运行 lint/test/cargo test 和本地打包安装验证。

### 10.4 遗留问题与后续规划

| 问题 | 影响 | 处理计划 | 负责人 | 截止时间 |
|---|---|---|---|---|
| 超大文档流畅 WYSIWYG | 100k 行文档体验可能有限 | 后续评估增量解析、分块渲染、worker | Codex | 后续阶段 |
| HTML 深度 WYSIWYG | 复杂 HTML 只能保真或源码编辑 | 第一版 opaque，后续按真实需求增强 | Codex | 后续阶段 |
| 通用 npm 发布 | 暂不作为目标 | 内核成熟后再评估包边界和许可证 | 用户/Codex | 后续阶段 |

### 10.5 Planning Handoff

- `plan-to-exec` 可以决定：
  - 具体实现阶段和提交切片。
  - 初始 Markdown parser 依赖选择。
  - ProseMirror plugin 和 command 文件拆分。
  - fixtures 文件命名和覆盖顺序。
  - UI 组件内部结构和样式细节。
- 必须返回 `spec` 的事项：
  - 改变 Markdown 文件唯一真相。
  - 放弃源码保真优先。
  - 改变 CLI 或 Workspace/Document Mode 外部合约。
  - 引入长期双内核回退。
  - 引入数据库/块 ID/协作编辑作为本期核心。
- 必须返回 `clarify` 的事项：
  - 用户要求完全不用 ProseMirror 或不用任何 Markdown parser 生态。
  - 用户要求第一版覆盖 100k 行完全流畅富编辑。
  - 用户要求本期发布独立 npm/editor 产品。
- 推荐下一步：

```text
$plan-to-exec docs/loopx/design/自研Markdown所见即所得内核需求设计文档.md
```

## 十一、QA

### 11.1 评审记录

| 评审时间 | 评审人 | 评审问题 | 处理进展 | 结论 |
|---|---|---|---|---|
| 2026-06-17 | 用户、Codex | 是否完全替换闭源内核 | 已确认最终完全替换，不做长期切换 | closed |
| 2026-06-17 | 用户、Codex | 是否允许 ProseMirror | 已确认允许 | closed |
| 2026-06-17 | 用户、Codex | 是否允许 Markdown 解析库 | 已确认允许，但不兼容关键场景需重写 | closed |
| 2026-06-17 | 用户、Codex | 是否源码保真优先 | 已确认 | closed |
| 2026-06-17 | 用户、Codex | 是否纳入源码模式和 CodeMirror 6 | 已确认 | closed |
| 2026-06-17 | 用户、Codex | 是否使用 `packages/mdx-editor/` | 已确认 | closed |

### 11.2 待确认问题

| 问题 | 需要谁确认 | 阻塞阶段 | 推荐答案 | 状态 |
|---|---|---|---|---|
| 无仍阻塞设计的问题 | 不涉及 | 不阻塞 | 进入 `$plan-to-exec` | closed |
