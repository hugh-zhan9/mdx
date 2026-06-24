# Markdown语法插件化编辑器内核设计文档

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿 | 2026-06-22 | Codex |

## 二、需求信息

### 2.1 需求背景

- 背景：近期修复 HTML fallback、`details` 表单 HTML、代码块 Markdown 高亮、脚注、`Command+A` 等问题时，多次出现改动一个语法影响另一个语法的风险。
- 需求目的：把 Markdown 编辑器内核按语法域插件化，使每个语法的 schema、parser、serializer、NodeView、input rules、clipboard 和测试闭环在同一模块内维护。
- 目标用户/使用方：MDX 桌面应用的 Markdown 编辑器、Workspace/Document 模式、后续编辑器功能开发者。
- 需求链接：当前会话 `$clarify` 澄清。
- 关联原始材料：
  - `.loopx/intake/clarify-markdown-syntax-plugin-kernel-20260622194440.md`
  - `docs/loopx/specs/editor.md`
  - `.loopx/memory/MEMORY.md`

### 2.2 需求范围

- 本期范围：
  - 新增内部 kernel/registry 架构。
  - 使用显式 `createMdxEditorKernel(...)` 实例 API。
  - 第一阶段 registry 承载所有现有语法。
  - 独立插件化 `html`、`fallback`、`footnote`、`code`、`mermaid`。
  - 其余语法通过 `coreMarkdownSyntax` 或 `legacyMarkdownSyntax` 适配插件接入。
  - 完整插件化 clipboard：copy、paste HTML、paste Markdown。
  - repo 内调用方迁移到新 API，并删除旧公开 API 主路径。
- 非目标：
  - 不提供用户可配置的插件启用/禁用 UI。
  - 不提供第三方外部插件 API。
  - 不借迁移改变已确认的用户可见行为。
  - 不迁移到第三方 Markdown/MDX 编辑器内核。
- 决策边界：
  - Markdown 是唯一文档真源。
  - unsupported Markdown 必须 fallback 保真。
  - ProseMirror schema 启动时一次性合并，运行时不动态增删。
  - 核心贡献同步；异步仅存在于 NodeView/render service。
- 依赖方：
  - `packages/mdx-editor` parser/schema/serializer/react/plugins/clipboard。
  - `features/editor`、workspace/document 集成。
  - 综合 Markdown 语法检查文档。
- 约束条件：
  - 不能破坏现有文档 round-trip。
  - 不能丢失 unsupported Markdown 源码。
  - 第一阶段是 breaking API migration，必须全 repo 验证。

### 2.3 可行性分析

- 业务可行性：该改造不改变产品目标，主要降低编辑器功能迭代风险。
- 技术可行性：现有能力已经按 parser、schema、NodeView、serializer 等层分布，具备抽象为 contribution 的基础。
- 团队接受能力：需要一次集中迁移和较强测试保障；后续语法迭代成本会下降。
- 时间成本：高于普通功能，属于架构重构。
- 资源成本：主要是开发与回归测试成本，无新增外部服务。
- 替代方案：
  - 继续集中式实现：短期成本低，但不解决耦合。
  - 只拆 NodeView：无法解决 parser/serializer/clipboard 互相影响。
  - 迁移第三方内核：范围过大，且可能破坏已有保真策略。
- 关键风险：clipboard 完整插件化、公开 API 删除、schema 合并顺序、legacy 适配插件行为漂移。

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 将 Markdown 语法能力组织为内部插件。
  - 用 registry 统一合并 schema、调度 parser、创建 NodeViews、生成 editor plugins、处理 serializer 与 clipboard。
  - 保持现有用户行为与 Markdown 保真。
- 总体思路：
  - 并行新增 `packages/mdx-editor/kernel/` 和 `packages/mdx-editor/syntax/`。
  - 先在新 registry 内跑通目标插件和 legacy/core 适配插件。
  - 使用 golden tests 对比旧行为。
  - 一次性切换 repo 内调用方到新 kernel API。
  - 删除旧公开 API 主路径。
- 核心模块：
  - Kernel API
  - Syntax registry
  - Syntax plugin contribution types
  - Parse context and fallback policy
  - Clipboard pipeline
  - Independent syntax plugins
  - Legacy/core adapter syntax
- 主要难点：
  - ProseMirror schema 稳定合并。
  - block/inline parser 优先级和冲突处理。
  - clipboard paste HTML 的行为保真。
  - Mermaid 与 code fence 逻辑独立后的漂移防控。
- 技术指标：
  - 现有相关测试通过。
  - 新增插件级与 registry 测试。
  - 综合文档 parse/render/serialize 验证通过。

### 3.2 整体架构设计

- 业务模式：本地优先 Markdown 编辑器，Markdown 文本为唯一持久化事实。
- 系统边界：本设计仅覆盖 `packages/mdx-editor` 内核和 repo 内调用方迁移，不覆盖外部第三方插件生态。
- 上下游系统：
  - 上游：Workspace/Document 模式传入 Markdown、image loader、code tokenizer、mermaid renderer 等服务。
  - 下游：ProseMirror schema/view/plugins、React NodeViews、serializer、clipboard。
- 应用架构：
  - `features/editor` 创建 kernel 实例并传入服务。
  - `packages/mdx-editor/kernel` 构建 schema、registry 和运行时能力。
  - `packages/mdx-editor/syntax/*` 提供语法贡献。
- 技术架构：
  - 插件贡献 `schema`、`parse`、`serialize`、`nodeViews`、`editorPlugins`、`clipboard`、`fixtures`。
  - registry 按 `phase` 和 `priority` 调度。
  - fallback policy 是内核 invariant。
- 数据流转：
  - Markdown -> kernel parser -> ProseMirror doc -> editor view/NodeViews -> serializer/clipboard -> Markdown/HTML。

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| Kernel 创建 | 编辑器初始化 | `createMdxEditorKernel`、syntax registry | 合并 syntax contributions，构建 schema、parser、serializer、plugins、clipboard | schema name 冲突或 phase 冲突直接 throw | kernel 实例 |
| Markdown 解析 | 打开文档或外部更新 | parser registry、parse context、fallback policy | 按 phase/priority 调度 block/inline parser，分配 source slice | 无插件匹配时生成保真 fallback | ProseMirror doc + source slices |
| Markdown 序列化 | 保存文档 | serializer registry | 按 node type 分发到插件 serializer | 缺失 serializer 时按 fallback policy 或显式错误处理 | Markdown |
| NodeView 创建 | ProseMirror view 初始化 | nodeView registry | 按 node type 创建插件 NodeView | 缺失 NodeView 使用 schema DOM 或报错 | Editor UI |
| Clipboard copy/paste | 用户复制/粘贴 | clipboard registry | copy 输出 HTML/Markdown，paste HTML/Markdown 经插件管线转 doc | unsupported paste 内容 fallback 保真 | 文档变更或剪贴板内容 |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| Kernel | 对外新 API | 创建 schema/parser/serializer/nodeViews/plugins/clipboard | syntax registry | 替代旧公开 API |
| Registry | 插件合成与调度 | phase/priority、schema 合并、冲突检测 | syntax plugins | 启动时固定 |
| Parse Context | 插件解析协作 | `parseInline`、`parseBlocks`、`allocateSourceSlice`、`emitFallback` | registry/fallback policy | 禁止插件互相直接调用 parser |
| Fallback Policy | 内容保真安全网 | unsupported source fallback 决策 | fallback 插件表现层 | 内核 invariant |
| Syntax Plugins | 语法域实现 | schema、parse、serialize、NodeView、input/keymap、clipboard、fixtures | kernel types | 内部插件 |
| Clipboard Pipeline | 剪贴板行为 | copy/paste HTML/Markdown 插件化 | syntax plugins | 第一阶段完整纳入 |

### 3.5 新增/调整功能说明

- 新增显式 kernel API：

```ts
const kernel = createMdxEditorKernel({
  syntax: defaultMarkdownSyntax(),
  services: {
    imageLoader,
    codeTokenizer,
    mermaidRenderer,
  },
});

kernel.schema;
kernel.parseMarkdown(markdown);
kernel.serializeMarkdown(doc);
kernel.createNodeViews();
kernel.createEditorPlugins();
kernel.clipboard;
```

- 第一阶段独立插件目录：
  - `packages/mdx-editor/syntax/html`
  - `packages/mdx-editor/syntax/fallback`
  - `packages/mdx-editor/syntax/footnote`
  - `packages/mdx-editor/syntax/code`
  - `packages/mdx-editor/syntax/mermaid`
- 适配插件目录：
  - `packages/mdx-editor/syntax/core`
  - `packages/mdx-editor/syntax/legacy`

## 四、详细设计

### 4.1 Kernel API 详细设计

#### 4.1.1 需求内容

- 入口：`createMdxEditorKernel(options)`
- 操作人/调用方：`features/editor`、测试、Workspace/Document editor integration。
- 前置条件：传入 syntax 集合和可选服务。
- 输出结果：固定 schema 和一组编辑器运行时能力。

#### 4.1.2 方案设计

- 核心逻辑：
  - 接收 syntax plugin 数组。
  - 按声明顺序和依赖检查构建 registry。
  - 合并 schema specs。
  - 生成 parser、serializer、nodeViews、ProseMirror plugins、clipboard handlers。
- 状态流转：kernel 创建后不可变；服务可作为闭包注入 NodeView/render service。
- 数据变更：不涉及持久化数据，只影响内存中的 editor runtime。
- 计算公式：不涉及。
- 幂等设计：相同 syntax 和 services 创建的 kernel 行为应一致。
- 权限/越权控制：不涉及。
- 异常处理：
  - schema node/mark 同名冲突 throw。
  - phase/priority 非法 throw。
  - 缺失必需插件 contribution 在启动测试中暴露。
- 补偿/重试：不涉及。
- 日志与审计：开发期错误以 throw/test failure 暴露。

#### 4.1.3 流程步骤

1. 调用方创建 syntax 集合。
2. `createMdxEditorKernel` 规范化 syntax 列表。
3. registry 校验插件 id 唯一、依赖存在、schema 无冲突。
4. 构建 ProseMirror schema。
5. 返回不可变 kernel 实例。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| schema 同名冲突 | 启动 throw | 开发/测试失败 | 不涉及 |
| 插件缺失 serializer | 测试失败；运行时显式错误或 fallback | 开发可见 | 不涉及 |
| 服务缺失 | 相关 NodeView 降级或报错，按插件定义 | 用户可能看到降级 UI | 不涉及 |

### 4.2 Syntax Plugin Contribution 详细设计

#### 4.2.1 需求内容

- 入口：每个 syntax plugin 导出 `createXxxSyntax()` 或 `xxxSyntax()`。
- 操作人/调用方：kernel registry。
- 前置条件：插件声明 id、phase、priority、schema、parser、serializer 等贡献。
- 输出结果：可被 registry 合成的 contribution。

#### 4.2.2 方案设计

- 核心逻辑：
  - 插件按语法域封装，可管理多个 node。
  - 插件贡献完整语法生命周期。
  - `phase` 用于 block/inline/clipboard/schema/nodeview 等调度分层。
  - `priority` 用于同 phase 冲突判定。
- 状态流转：插件定义是静态描述；运行时状态归 NodeView 或 ProseMirror plugin 管理。
- 数据变更：不涉及持久化。
- 异常处理：贡献格式非法在 registry 初始化时报错。

#### 4.2.3 流程步骤

1. 插件声明 schema specs。
2. 插件声明 parser handlers。
3. 插件声明 serializer handlers。
4. 插件声明 NodeView/editor plugin/input/keymap/clipboard contributions。
5. 插件声明 fixtures/tests。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 两插件抢同一语法 | 通过 phase/priority 决定，必须有冲突 fixture | 用户无感 | 测试覆盖 |
| 插件直接 import 其他 parser | 设计禁止，代码评审阻止 | 不涉及 | 测试/CR |
| 插件 async parser | 禁止 | 不涉及 | 类型约束 |

### 4.3 Parser 和 Fallback 详细设计

#### 4.3.1 需求内容

- 入口：`kernel.parseMarkdown(markdown)`。
- 操作人/调用方：编辑器 provider、测试、clipboard paste Markdown。
- 前置条件：kernel registry 已创建。
- 输出结果：`ParsedMarkdownDocument` 等价数据结构。

#### 4.3.2 方案设计

- 核心逻辑：
  - block parser 和 inline parser 由 registry 调度。
  - parser contribution 返回 `matched | notMatched | defer | fallback`，并携带 source range。
  - context 提供 `parseInline`、`parseBlocks`、`allocateSourceSlice`、`emitFallback`。
  - fallback policy 属于内核：未能结构化表示的 Markdown 必须保真。
- 状态流转：source slices 由 parse context 统一分配。
- 数据变更：生成 ProseMirror doc，不修改原 Markdown。
- 异常处理：parser 抛错时应优先 fallback 到 source_fallback，除非是开发期 schema/registry 错误。

#### 4.3.3 流程步骤

1. 将 Markdown 切成 logical lines。
2. 对每个位置按 phase/priority 请求插件匹配。
3. 插件返回结构化 node 或 fallback 指令。
4. 内核统一记录 source slice。
5. 未匹配内容走 paragraph 或 fallback policy。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| `<details>` vs HTML fallback | `html` 插件更高优先级结构化处理 details | 默认渲染，可进源码 | fixture |
| `<div>` unsupported HTML | fallback policy 保真 | 显示 rendered fallback，可编辑源码 | fixture |
| `mermaid` vs code fence | `mermaid` 插件更高优先级且完全独立 | Mermaid preview | fixture |
| callout vs blockquote | 更具体 callout 优先 | callout 渲染 | fixture |
| footnote definition vs fallback | footnote 插件优先，支持缩进续行 | 脚注渲染 | fixture |

### 4.4 Serializer 详细设计

#### 4.4.1 需求内容

- 入口：`kernel.serializeMarkdown(doc)`。
- 操作人/调用方：保存、测试、clipboard copy Markdown。
- 前置条件：doc 使用 kernel schema。
- 输出结果：Markdown 字符串。

#### 4.4.2 方案设计

- 核心逻辑：
  - serializer registry 按 node/mark type 分发。
  - 插件负责自己 node/mark 的 Markdown 输出。
  - fallback 插件输出原始 `attrs.markdown`。
- 状态流转：无。
- 数据变更：无。
- 异常处理：未知 node type 抛出开发错误，不能静默丢内容；fallback node 例外。

#### 4.4.3 流程步骤

1. 遍历 doc block。
2. 查找 node serializer。
3. 对 inline 内容递归调用 inline serializer。
4. 拼接 Markdown。

#### 4.4.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| source_fallback | 原样输出 markdown | 保真 | round-trip 测试 |
| table pipe | table 插件负责 cell escaping | 表格保存合理 | fixture |
| mermaid fence | mermaid 插件独立输出 fence | 保持 Mermaid 语法 | fixture |

### 4.5 NodeView 与 Editor Plugins 详细设计

#### 4.5.1 需求内容

- 入口：`kernel.createNodeViews()`、`kernel.createEditorPlugins()`。
- 操作人/调用方：ProseMirror editor view。
- 前置条件：kernel schema 已固定。
- 输出结果：NodeViewConstructor map 与 ProseMirror plugin array。

#### 4.5.2 方案设计

- 核心逻辑：
  - 插件贡献 node type -> NodeViewConstructor。
  - 插件贡献 input rules、keymap、decorations、interaction plugins。
  - 内核负责基础 history/baseKeymap 组合。
- 状态流转：NodeView 内部可有 UI 状态；不能改变 Markdown 真源外的持久状态。
- 异步设计：Mermaid render、image loader 等异步能力仅在 NodeView/render service 层存在。
- 异常处理：NodeView 渲染失败应显示可恢复 UI 或 fallback，不应破坏 doc。

#### 4.5.3 流程步骤

1. registry 收集 NodeView contributions。
2. registry 合并 editor plugins。
3. editor provider 使用 kernel 输出初始化 ProseMirror view。

#### 4.5.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| details summary | HTML 插件保留展开，双击或点击内容进源码 | 交互保持不变 | NodeView 测试 |
| textarea Command+A | keyboard scope 不拦截原生输入控件 | 只选中输入框内容 | 集成测试 |
| Mermaid render fail | Mermaid 插件显示错误 UI，禁止 Mermaid 自有 error DOM 污染搜索 | 可见错误状态 | fixture |

### 4.6 Clipboard 详细设计

#### 4.6.1 需求内容

- 入口：`kernel.clipboard` 和 editor clipboard ProseMirror plugin。
- 操作人/调用方：用户 copy/cut/paste。
- 前置条件：clipboard contributions 已注册。
- 输出结果：粘贴后的 doc 变更，或复制出的 Markdown/HTML。

#### 4.6.2 方案设计

- 核心逻辑：
  - copy Markdown：复用 serializer registry。
  - copy HTML：插件贡献 `toClipboardHtml(node)` 和 inline HTML renderer。
  - paste Markdown：复用 parser registry。
  - paste HTML：插件贡献 DOM recognizer/parser，将 HTML 节点转换为 ProseMirror nodes 或 Markdown 再解析。
  - unsupported HTML paste 必须 fallback 或安全降级。
- 状态流转：paste 是编辑事务；copy 不改变状态。
- 安全：HTML paste 必须继续过滤危险标签和 URL。
- 异常处理：无法识别的 HTML 走安全文本或 fallback，不得执行脚本。

#### 4.6.3 流程步骤

1. copy：遍历 selection slice，调用插件 HTML/Markdown serializer。
2. paste Markdown：调用 kernel parser，插入 doc slice。
3. paste HTML：解析 DOM，按插件优先级识别，生成 nodes 或 fallback。
4. 插入事务保留 undo/redo 行为。

#### 4.6.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 粘贴危险 HTML | sanitize，禁止脚本/危险 URL | 安全内容或文本 | security fixture |
| 粘贴 unsupported block | fallback 保真或文本化 | 不丢内容 | fixture |
| 复制 footnote/html/table | 对应插件输出合理 HTML/Markdown | 外部粘贴合理 | clipboard tests |

### 4.7 Mermaid 独立插件详细设计

#### 4.7.1 需求内容

- 入口：`mermaidSyntax()`。
- 操作人/调用方：registry。
- 前置条件：Mermaid render service 注入。
- 输出结果：`mermaid_block` schema、parser、serializer、NodeView、clipboard 行为。

#### 4.7.2 方案设计

- 核心逻辑：
  - Mermaid 插件完全独立实现 fence parsing，不复用 code 插件。
  - Mermaid parser 优先级高于 code parser。
  - Mermaid NodeView 拥有 render service、preview DOM contract、错误 UI。
  - 与 code fence 行为通过共享 fixture 防漂移。
- 状态流转：render 状态在 NodeView 内部；Markdown 内容仍在 ProseMirror doc。
- 异常处理：渲染失败显示插件错误 UI，不修改 Markdown。

#### 4.7.3 流程步骤

1. parser 识别 ` ```mermaid ` fence。
2. 创建 `mermaid_block`。
3. NodeView 调用 render service。
4. serializer 输出 Mermaid fence。

#### 4.7.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 未闭合 Mermaid fence | 按 Mermaid 插件定义处理，需与 code 共享 fixture 比较 | 不丢内容 | fixture |
| Mermaid 语法错误 | 显示错误 UI | 可见错误 | NodeView test |

## 五、存储类设计

### 5.1 库表设计

#### 5.1.1 数据库模型图

不涉及。该需求不新增数据库模型。

#### 5.1.2 表结构

| 表名 | 用途 | 主键 | 关键索引 | 数据量预估 | 备注 |
|---|---|---|---|---|---|
| 不涉及 | 不新增持久化表 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

字段明细：

| 字段 | 类型 | 是否必填 | 默认值 | 含义 | 来源/取值逻辑 | 备注 |
|---|---|---|---|---|---|---|
| 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

### 5.2 数据迁移/初始化

- DDL：不涉及。
- DML：不涉及。
- 数据回填：不涉及。
- 老数据兼容：现有 Markdown 文档必须按原行为打开、编辑、保存；unsupported Markdown 继续 fallback 保真。
- 新老系统读写关系：迁移完成后 repo 内调用方使用新 kernel API；旧公开 API 主路径删除。

### 5.3 缓存设计

| 场景 | Key | Value | 数据结构 | 过期时长 | 容量预估 | 失效/刷新策略 |
|---|---|---|---|---|---|---|
| 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

## 六、其他组件设计

### 6.1 消息设计

| 场景 | Group | Topic | 生产者 | 消费者 | 幂等键 | 失败补偿 |
|---|---|---|---|---|---|---|
| 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| syntax registry composition | 代码层 | `defaultMarkdownSyntax()` | 否 | 第一阶段只允许代码组合，不提供用户开关 | 配置错误会导致 schema/parser 缺失 |

### 6.3 定时任务/批处理

| 任务 | 触发时间 | 处理范围 | 幂等 | 失败重试 | 影响评估 |
|---|---|---|---|---|---|
| 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 不涉及 |

### 6.4 技术组件

- 分布式锁：不涉及。
- 唯一 ID：source slice id 仍由 parse context 分配。
- 加解密/验签：不涉及。
- 字典转换：node type、phase、priority、syntax id 需要类型化定义。
- Excel/文件处理：不涉及。
- 用户信息透传：不涉及。
- 限流/熔断：不涉及。

## 七、接口设计

### 7.1 接口设计原则

- 新 API 必须显式体现 kernel 实例。
- API 参数必须区分 syntax contributions 与 runtime services。
- parser/serializer/input rules/clipboard 核心贡献必须同步。
- NodeView/render service 可异步，但异步状态不得影响 Markdown 真源。
- breaking change 必须在迁移计划中覆盖 repo 内全部调用方。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 权限/认证 | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|
| `createMdxEditorKernel(options)` | editor integration/tests | `packages/mdx-editor/kernel` | 不涉及 | 相同输入稳定输出 | 本文 | 新主入口 |
| `defaultMarkdownSyntax()` | editor integration/tests | syntax registry | 不涉及 | 是 | 本文 | 默认插件集合 |
| `kernel.parseMarkdown(markdown)` | editor provider/clipboard/tests | kernel parser | 不涉及 | 是 | 本文 | 生成 doc/source slices |
| `kernel.serializeMarkdown(doc)` | save/clipboard/tests | kernel serializer | 不涉及 | 是 | 本文 | 输出 Markdown |
| `kernel.createNodeViews()` | ProseMirror view | kernel nodeview registry | 不涉及 | 是 | 本文 | NodeView map |
| `kernel.createEditorPlugins()` | ProseMirror state | kernel plugin registry | 不涉及 | 是 | 本文 | ProseMirror plugins |
| `kernel.clipboard` | clipboard plugin | clipboard registry | 不涉及 | paste 非幂等 | 本文 | copy/paste |

### 7.3 接口明细

#### 7.3.1 `createMdxEditorKernel`

- 路径/方法：TypeScript function。
- 请求头：不涉及。
- 请求参数：
  - `syntax`: syntax plugin 数组或 syntax collection。
  - `services`: `imageLoader`、`codeTokenizer`、`mermaidRenderer` 等。
- 响应参数：
  - `schema`
  - `parseMarkdown`
  - `serializeMarkdown`
  - `createNodeViews`
  - `createEditorPlugins`
  - `clipboard`
- 错误码：不涉及；使用 throw。
- 业务校验：syntax id 唯一、schema specs 不冲突、依赖满足。
- 数据变更：无。
- 日志字段：不涉及。

#### 7.3.2 Syntax Plugin Contract

- 路径/方法：TypeScript object/interface。
- 请求参数：不涉及。
- 响应参数：插件 contribution。
- 业务校验：
  - `id` 必填且唯一。
  - `phase` 和 `priority` 必须明确。
  - schema node/mark 名称不得冲突。
  - parser contribution 不能 async。
- 数据变更：无。

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：第一阶段没有运行时灰度开关；通过测试环境和本地验证控制风险。
- 灰度开关：不提供用户开关。
- 验证指标：
  - 现有测试通过。
  - 新插件级测试通过。
  - 综合文档 round-trip 合理。
  - Workspace/Document 打开、编辑、保存关键语法正常。
- 放量节奏：合入前完成强验收；发布后重点检查 Markdown 保存差异。

### 8.2 降级方案

- 降级触发条件：新 kernel 造成无法打开/保存 Markdown、内容丢失、严重 clipboard 回归。
- 降级行为：回滚到迁移前提交。
- 用户影响：回滚前可能影响编辑器语法行为。
- 恢复方式：修复插件贡献或 registry 调度后重新发布。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| Workspace editor | 调用新 kernel API | 迁移 provider/adapter | 开发者 | 应用集成测试 |
| Document mode | 调用新 kernel API | 迁移打开/保存路径 | 开发者 | 打开保存 Markdown |
| Clipboard | 完整插件化 | 重构 copy/paste pipeline | 开发者 | clipboard tests |
| Mermaid preview | 独立插件 | 迁移 render service | 开发者 | Mermaid NodeView tests |
| Source fallback | 内核 fallback policy + 插件表现 | 保真测试 | 开发者 | fallback fixtures |

### 8.4 回滚方案

- 回滚条件：
  - 发现内容丢失或保存格式大面积变化。
  - 新 API 迁移导致核心编辑器不可用。
  - clipboard paste/copy 出现严重回归。
- 回滚步骤：
  1. 回滚插件化迁移提交。
  2. 保留或重放必要 bugfix 测试。
  3. 重新验证旧内核行为。
- 数据回滚：不涉及数据库；如用户文档已被错误保存，需要从版本/备份恢复。
- 配置回滚：不涉及。
- 风险：彻底删除旧公开 API 后回滚粒度较大，因此需要小提交和强测试。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：编辑器初始化 throw、schema 合并失败、NodeView 渲染失败。
- 业务异常：Markdown round-trip 差异、unsupported 内容未 fallback。
- 重试异常：不涉及。
- 超时：Mermaid render service 异步超时仍由 Mermaid 插件处理。
- 关键接口指标：不涉及线上指标；以测试和本地验证为主。
- 告警渠道：不涉及。

### 9.2 性能与容量

- TPS/吞吐：不涉及服务吞吐。
- CPU/内存/磁盘 IO/网络 IO：parser/clipboard 插件调度不应显著劣化大文档打开和粘贴性能。
- 数据容量：不涉及新增存储。
- 缓存容量：不涉及。
- 跑批耗时：不涉及。
- 是否压测：建议使用大型 Markdown 文档做本地性能基线对比。

### 9.3 可靠性与兜底

- 幂等击穿：kernel 创建和 parse/serialize 应稳定可重复。
- 并发失效：NodeView async render 不能写坏 doc。
- 冷热备：不涉及。
- 关键任务独立性：fallback policy 是内核 invariant，不能被插件禁用。
- 字段兜底：sourceId/source slice 由 parse context 统一分配。
- 老新数据兼容：旧 Markdown 文档必须能被新 kernel 正常打开和保存。

## 十、排期与规划

### 10.1 任务拆分与工作量评估

| 任务 | 范围 | 负责人 | 工作量 | 依赖 | 备注 |
|---|---|---|---|---|---|
| Kernel/registry 基础 | types、schema merge、phase/priority、fallback policy | 开发者 | 高 | 本设计 | 第一优先 |
| Syntax contribution contract | schema/parser/serializer/nodeview/clipboard interfaces | 开发者 | 中 | Kernel | 需类型测试 |
| 独立插件迁移 | html/fallback/footnote/code/mermaid | 开发者 | 高 | Kernel | 第一阶段重点 |
| Legacy/core adapter | 其余现有语法接入 registry | 开发者 | 中 | Kernel | 防止功能缺失 |
| Clipboard 插件化 | copy/paste HTML/Markdown | 开发者 | 高 | Syntax contract | 风险最高 |
| 调用方迁移 | features/editor、tests、exports | 开发者 | 中 | Kernel ready | breaking API |
| 验收测试 | plugin/registry/golden/app integration | 开发者 | 高 | 全部实现 | 合入门槛 |

### 10.2 计划时间

- 数据方案评审：不涉及。
- 开发开始/结束：由 `plan-to-exec` 拆分后确定。
- CR：每个迁移切片完成后需要 CR。
- 联调完成/提测：调用方迁移后。
- 测试用例评审：实现前先评审插件/registry/golden 验收矩阵。
- 测试开始/结束：随每个切片持续执行。
- 预发布：不涉及。
- 上线：随应用版本发布。
- 线上验证：打开综合文档和真实 Markdown 文件验证保存差异。

### 10.3 发布计划

1. 需求纳入发布版本。
2. 完成设计评审。
3. 生成执行计划。
4. 按计划实现 kernel/registry。
5. 迁移重点插件与 legacy adapter。
6. 切换 repo 内调用方。
7. 通过强验收。
8. 发布并观察 Markdown 编辑行为。

### 10.4 遗留问题与后续规划

| 问题 | 影响 | 处理计划 | 负责人 | 截止时间 |
|---|---|---|---|---|
| 第三方插件 API | 暂不支持外部扩展 | 后续需求明确后单独设计 | 待定 | 待定 |
| 用户禁用插件 UI | 暂不支持按语法禁用 | 后续结合 schema 兼容单独评估 | 待定 | 待定 |
| legacy/core 适配插件拆分 | 部分语法仍非独立插件 | 后续阶段逐步拆出 table/math/image/callout/list 等 | 待定 | 待定 |
| Mermaid 与 code fence 漂移 | 独立实现有重复逻辑 | 共享 fixture 长期约束 | 待定 | 持续 |

### 10.5 Planning Handoff

- `plan-to-exec` 可以决定：
  - 具体文件拆分和提交顺序。
  - TypeScript interface 命名细节。
  - 每个插件目录内文件名。
  - 测试文件拆分方式。
  - legacy/core adapter 的初始代码组织。
- 必须返回 `spec` 的事项：
  - 要暴露第三方插件 API。
  - 要改变 schema 运行时动态加载策略。
  - 要修改 fallback invariant。
  - 要改变公开 API breaking change 决策。
  - 要调整 clipboard 插件化范围。
- 必须返回 `clarify` 的事项：
  - 要改变用户可见编辑器行为。
  - 要添加插件启用/禁用 UI。
  - 要把迁移目标从内部架构改成外部生态。
- 推荐下一步：

```text
$plan-to-exec docs/loopx/design/Markdown语法插件化编辑器内核需求设计文档.md
```

## 十一、QA

### 11.1 评审记录

| 评审时间 | 评审人 | 评审问题 | 处理进展 | 结论 |
|---|---|---|---|---|
| 2026-06-22 | 用户、Codex | 插件架构边界、迁移范围、API、clipboard、fallback、Mermaid 独立性 | 已通过 clarify 固定 | 进入 spec |

### 11.2 待确认问题

- 无阻塞问题。实现计划阶段需要评估工作量和切片顺序。

