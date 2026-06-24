# MDX macOS原生质感与编辑阅读体验第一阶段设计文档

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿 | 2026-06-24 | Codex |

## 二、需求信息

### 2.1 需求背景

- 背景：
  - 用户明确将 MDX 定位为 macOS 桌面应用，希望具备 macOS 原生质感。
  - 当前产品已经定位为 desktop-first Markdown workspace，但现有窗口壳层与界面仍偏跨平台 Web 桌面工具风格。
  - 用户同时提出更长远的 TeX 风格排版愿景，但已确认不纳入第一阶段。
- 需求目的：
  - 在不改变现有编辑器真相模型和信息架构的前提下，提升 macOS 桌面应用质感与默认阅读舒适度。
- 目标用户/使用方：
  - macOS 上写作、维护本地 Markdown 工作区的开发者、技术写作者、研究者、agent-assisted note takers。
- 需求链接：
  - 当前会话需求与澄清问答。
- 关联原始材料：
  - [MDX macOS原生质感与编辑阅读体验第一阶段设计提案](/Users/zhangyukun/project/mdx/docs/loopx/design/MDX%20macOS%E5%8E%9F%E7%94%9F%E8%B4%A8%E6%84%9F%E4%B8%8E%E7%BC%96%E8%BE%91%E9%98%85%E8%AF%BB%E4%BD%93%E9%AA%8C%E7%AC%AC%E4%B8%80%E9%98%B6%E6%AE%B5%E8%AE%BE%E8%AE%A1%E6%8F%90%E6%A1%88.md)
  - [.loopx/intake/clarify-mdx-macos-native-feel-and-editor-reading-baseline-20260624141632.md](/Users/zhangyukun/project/mdx/.loopx/intake/clarify-mdx-macos-native-feel-and-editor-reading-baseline-20260624141632.md)
  - [PRODUCT.md](/Users/zhangyukun/project/mdx/PRODUCT.md:1)
  - [docs/loopx/specs/editor.md](/Users/zhangyukun/project/mdx/docs/loopx/specs/editor.md:1)

### 2.2 需求范围

- 本期范围：
  - macOS 窗口壳层增强
  - Workspace / Document Mode 共享视觉语言
  - toolbar / sidebar / tab strip / panel / empty state / status block 的 macOS-first 重塑
  - 正文编辑/阅读体验基线：版心、行高、留白、块级节奏、内容块层次
  - light / dark / system 三主题统一
  - 菜单与快捷键轻量统一
- 非目标：
  - Knuth–Plass、OpenType MATH、自研公式排版、阅读模式、信息架构重构、命令系统重构
- 决策边界：
  - Markdown 仍是唯一文档真相
  - 不改 Workspace / Document 的主流程语义
  - macOS-first，其他平台仅保证可用
  - 允许 Tauri/Rust 平台隔离改动
- 依赖方：
  - Tauri window configuration
  - Workspace / Document React shell
  - 共享 UI 控件与全局主题 token
- 约束条件：
  - 遵守产品“calm, precise, local-first”与“避免 heavy glass panels”约束
  - 不破坏 editor spec 中现有 DOM contract、fallback、round-trip 行为
  - 验收需覆盖浅/深色和两种窗口模式
- 触发的辅助 skills：architecture-designer

### 2.3 可行性分析

- 业务可行性：
  - 需求与产品定位一致，可显著提升用户对“桌面工具”的直观判断。
- 技术可行性：
  - 当前 Tauri 窗口集中由 `WebviewWindowBuilder` 创建，具备收敛窗口 appearance helper 的条件。
  - 当前主题 token 和 Workspace / Document shell 已相对集中，适合做分层重塑。
- 团队接受能力：
  - 风险集中在窗口壳层与跨模式视觉统一，范围可控。
- 时间成本：
  - 中等。低于排版引擎工程，但高于普通样式微调。
- 资源成本：
  - 主要是前端和 Tauri 桌面层设计与验证成本，不涉及额外基础设施。
- 替代方案：
  - 只改 CSS；直接做排版引擎；重做信息架构。均已在提案中拒绝。
- 关键风险：
  - macOS titlebar/material 渐进增强复杂度
  - 版心与宽内容的平衡
  - 多模式、多主题截图验收覆盖不足导致回归

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 让 MDX 第一阶段在 macOS 上呈现原生 document app 质感，同时提升默认编辑阅读舒适度。
- 总体思路：
  - 先统一窗口壳层与主题 token，再统一 Workspace / Document shell，最后优化正文版心与内容块层级。
- 核心模块：
  - Tauri window appearance helper
  - app/global theme token
  - shared control surfaces
  - Workspace shell
  - Document shell
  - editor reading baseline styles
- 主要难点：
  - 平台隔离、窗口拖拽区与交互控件兼容、浅深色统一、宽内容与版心平衡
- 技术指标：
  - 不破坏现有功能回归
  - 深浅色、Workspace/Document 模式截图均达到统一视觉标准
  - 菜单与快捷键行为保持兼容

### 3.2 整体架构设计

- 业务模式：
  - 本地优先 Markdown 桌面编辑器，含 Workspace 与 Document 双模式。
- 系统边界：
  - Rust/Tauri 负责窗口创建与原生菜单。
  - Next/React 负责视觉结构、surface、编辑区与内容展示。
- 上下游系统：
  - 上游无外部服务依赖。
  - 下游为现有 editor kernel、LLM Wiki、Memory 功能模块。
- 应用架构：
  - 新增“window appearance + theme system + shell surface”这一跨层约束，不改业务状态机。
- 技术架构：
  - macOS 专属窗口属性通过 Rust/Tauri helper 注入
  - 前端通过统一 token 与 class 体系收口
  - 非 macOS 回退到现有窗口逻辑和近似样式
- 数据流转：
  - 不新增业务数据流
  - 仅新增视觉主题、平台外观和布局约束的静态流转

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| Workspace 窗口创建 | 新开或聚焦工作区窗口 | Tauri window builder, workspace shell | 创建或聚焦窗口，应用 macOS appearance，渲染统一 toolbar/sidebar/editor shell | macOS 能力不可用时回退普通外观 | 可用工作区窗口 |
| Document 窗口创建 | Finder/Open With 打开文档 | Tauri window builder, document shell | 创建文档窗口，应用同系外观，渲染单文档编辑区和大纲 | macOS 能力不可用时回退普通外观 | 可用文档窗口 |
| 主题初始化 | 首屏加载或系统主题变化 | root layout, theme preference | 解析 `light/dark/system`，设置统一 token | 浏览器/系统事件不可用时保留当前主题 | 正确主题外观 |
| 编辑区阅读展示 | 打开 Markdown 文档 | editor shell, editor styles | 套用版心、正文节奏、内容块层级 | 宽内容进入可滚动容器，不破坏布局 | 更舒适的阅读编辑体验 |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| 窗口外观模块 | 统一窗口 appearance | titlebar 融合、拖拽区、平台回退 | Tauri/Rust | macOS 专属增强 |
| 主题 token 模块 | 统一主题语言 | light/dark/system、surface 层级 | `app/globals.css` | 不改业务逻辑 |
| 共享控件模块 | 工具栏、按钮、tabs、headers 统一 | icon button/text button/panel header | React components | 继续使用 lucide |
| Workspace shell 模块 | 工作区壳层视觉统一 | header、left panel、right panel、tab strip、banner surface | workspace components | 信息架构不变 |
| Document shell 模块 | 单文档壳层视觉统一 | title area、editor stage、outline panel | document components | 与 workspace 共享视觉语言 |
| 编辑阅读基线模块 | 提升正文体验 | 版心、行高、内容块 spacing、公式/代码块视觉融入 | editor pane + globals | 不改编辑器模型 |

### 3.5 新增/调整功能说明

- 桌面端 / 壳层：
  - 调整窗口 appearance 与顶部 draggable region
- 前端 UI：
  - 调整全局 token、shared controls、Workspace shell、Document shell、editor baseline
- 菜单层：
  - 轻量统一菜单项与快捷键语气
- 非功能：
  - 增加多模式、多主题截图和手工验证要求

### 3.6 专项设计检查

| 辅助 skill | 触发原因 | 检查内容 | 设计结论 |
|---|---|---|---|
| `architecture-designer` | 窗口壳层改造涉及平台边界、NFR、长期演进方向 | 系统边界、回退策略、模式一致性、演进空间 | 采用平台隔离 helper + 统一 token + 保持业务状态不变 |

## 四、详细设计

### 4.1 窗口外观与平台隔离详细设计

#### 4.1.1 需求内容

- 入口：
  - Workspace / Document / Document error window 创建
- 操作人/调用方：
  - 用户打开工作区、打开文档、应用启动
- 前置条件：
  - 应用运行于 Tauri 窗口环境
- 输出结果：
  - 在 macOS 下使用统一原生感窗口壳层；其他平台保持当前普通行为

#### 4.1.2 方案设计

- 核心逻辑：
  - 将 `src-tauri/src/lib.rs` 中分散的 `WebviewWindowBuilder` 配置收敛到统一 helper。
  - helper 根据平台应用不同窗口属性。
  - macOS 下优先使用隐藏/融合标题栏与可拖拽顶部区域；失败时回退普通窗口。
- 状态流转：
  - 无新增业务状态，仅在窗口创建时确定 appearance。
- 数据变更：
  - 无持久化数据变更。
- 计算公式：
  - 不涉及。
- 幂等设计：
  - 同 label 窗口已存在时仍走现有 focus 逻辑，不重复创建。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - 某项 macOS 外观能力不可用时记录 warning，使用保守外观回退。
- 补偿/重试：
  - 不做运行时重试；采用创建时回退。
- 日志与审计：
  - 增加窗口外观路径日志，便于识别 macOS 能力是否生效。

#### 4.1.3 流程步骤

1. 进入窗口创建逻辑。
2. 根据窗口角色和平台选择 appearance helper。
3. macOS 下应用 titlebar / drag region / material 相关设置。
4. 设置统一尺寸、最小尺寸与标题。
5. 创建失败则沿用现有错误传播；特性不可用则降级为普通 appearance。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| macOS 支持目标 appearance | 使用增强外观 | 原生质感更强 | info/debug |
| macOS 不支持某项能力 | 回退普通外观 | 外观稍弱，但功能正常 | warning |
| 非 macOS 平台 | 使用现有窗口逻辑 | 外观维持现状 | 无 |
| 已存在同类窗口 | 保持 focus 逻辑 | 无重复窗口 | 无 |
| 错误窗口创建 | 继续沿用现有 document error 行为 | 与当前一致 | error |

#### 4.1.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| Workspace/Document 窗口角色和 session 逻辑 | 与外观无关，避免扩大范围 | 现有窗口 session 测试 + 手工验证 |
| 窗口尺寸、最小尺寸语义 | 不属于本期需求核心 | Tauri 启动验证 |

### 4.2 主题 token 与共享控件详细设计

#### 4.2.1 需求内容

- 入口：
  - 应用首屏、系统主题变化、用户切换主题偏好
- 操作人/调用方：
  - 用户 / root layout
- 前置条件：
  - 现有 `light/dark/system` 机制存在
- 输出结果：
  - 统一的 macOS-first 视觉语言

#### 4.2.2 方案设计

- 核心逻辑：
  - 重构 `app/globals.css` 中主题 token，区分 window chrome、sidebar surface、content surface、separator、selection、hover、active、focus ring。
  - `common/components/ui-controls.tsx` 的 button/header 基类调整为更接近 macOS toolbar / panel control 的尺寸、圆角、边框和 hover。
  - 保持 lucide 图标，但统一大小、间距和线性语气。
- 状态流转：
  - 继续沿用现有 `themePreference` + system resolve 逻辑。
- 数据变更：
  - 无新增业务数据；如果需要新增少量视觉偏好字段，不得影响旧数据读取。
- 计算公式：
  - 不涉及。
- 幂等设计：
  - 多次应用同一主题结果一致。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - localStorage 不可用时仍沿用 `system` 回退。
- 补偿/重试：
  - 不涉及。
- 日志与审计：
  - 无强制要求。

#### 4.2.3 流程步骤

1. 启动时解析主题偏好。
2. 解析系统深浅色。
3. 选择对应 token 集。
4. 共享控件消费 token 展示统一外观。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| light/dark/system 正常切换 | 即时应用 token | 主题一致 | 无 |
| 系统主题变化 | 按现有 system 订阅更新 | 跟随系统 | 无 |
| localStorage 不可用 | 回退 `system` | 可用但不记忆 | 无 |
| 共享控件在深色下对比不足 | 通过 token 校正 | 可读性正常 | 设计验收发现 |

#### 4.2.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| 主题偏好 key 的兼容读取 | 避免破坏已有主题偏好 | 现有主题逻辑测试 |
| focus 可见性和键盘可访问性 | 产品可访问性底线 | 手工 + 组件测试 |

### 4.3 Workspace / Document 壳层详细设计

#### 4.3.1 需求内容

- 入口：
  - 渲染 Workspace shell 或 Document shell
- 操作人/调用方：
  - 用户打开工作区或文档
- 前置条件：
  - 窗口 session 已确定模式
- 输出结果：
  - 两种模式拥有同一 macOS-first 视觉语气

#### 4.3.2 方案设计

- 核心逻辑：
  - Workspace `header` 重塑为 macOS document toolbar：
    - 预留 traffic lights 安全区域
    - 左右工具按钮紧凑化
    - banner、message、mode toggle 统一 surface 语气
  - 左侧文件树与搜索：
    - 更接近 source list，弱化硬边框感，增强选中态和层级背景
  - `TabStrip`：
    - 由 web-like tab row 调整为更贴近原生 document tabs / segmented toolbar 感
  - 右侧面板：
    - 统一 header、tablist、scroll surface 和状态块层级
  - Document shell：
    - 共享 header / outline / editor spacing 语言，但不引入工作区工具密度
- 状态流转：
  - 不新增业务状态。
- 数据变更：
  - 无。
- 计算公式：
  - 不涉及。
- 幂等设计：
  - 重渲染不改变业务状态。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - 当某些 shell 元素在小宽度下空间不足时优先换行/截断，不遮挡按钮。
- 补偿/重试：
  - 不涉及。
- 日志与审计：
  - 不涉及。

#### 4.3.3 流程步骤

1. 根据模式渲染对应 shell。
2. 注入共享 toolbar/header/control 样式。
3. 应用 panel surface、tab strip 和 outline 统一视觉层级。
4. 保持原有交互和业务行为。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| Workspace 宽屏 | 展示完整三栏与 toolbar | 原生工具感更强 | 无 |
| Workspace 窄屏 | 优先保留编辑区可用性 | 控件可能截断，但不重叠 | 手工验收 |
| Document Mode | 采用轻量壳层 | 与 Workspace 同系但更安静 | 无 |
| LLM Wiki / Memory 面板内容复杂 | 只统一外观，不改流程 | 功能不变 | 无 |
| banner/提示较多时 | 统一为清晰 surface，不压塌 header | 可读但不显得杂乱 | 手工验收 |

#### 4.3.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| Workspace 信息架构 | 用户已确认不改 | 组件回归测试 |
| Document 单文档编辑流程 | 避免扩大范围 | 文档模式测试 |
| 右侧 panel tab 语义 | 不属于本期功能变更 | 手工验证 |

### 4.4 编辑阅读基线详细设计

#### 4.4.1 需求内容

- 入口：
  - Markdown 文档进入 EditorPane 渲染
- 操作人/调用方：
  - 用户编辑或阅读 Markdown
- 前置条件：
  - 文档内容已加载
- 输出结果：
  - 默认正文更适合长时间编辑和阅读

#### 4.4.2 方案设计

- 核心逻辑：
  - 为编辑内容区定义统一版心容器。
  - 正文、标题、列表、blockquote、code block、table、image、Mermaid、math block 使用更统一的垂直节奏和层次。
  - inline math / block math 只做视觉融入，不替换渲染引擎。
  - 宽内容保持横向滚动承载，不突破整体版面节奏。
- 状态流转：
  - 无新增编辑状态。
- 数据变更：
  - 无。
- 计算公式：
  - 仅版心与 spacing 常量；不引入排版算法。
- 幂等设计：
  - 相同 markdown 内容得到相同展示风格。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - 内容块样式异常时必须以可读性优先，不影响内容编辑。
- 补偿/重试：
  - 不涉及。
- 日志与审计：
  - 不涉及。

#### 4.4.3 流程步骤

1. 编辑器容器建立版心约束。
2. 正文节点与内容块消费统一排版 token。
3. 宽内容在局部滚动容器内展示。
4. 深浅色下保持相同层级逻辑。

#### 4.4.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 普通段落与标题 | 使用默认版心和节奏 | 阅读更舒适 | 无 |
| 长代码块/宽表格/Mermaid | 横向滚动，不挤压版心 | 功能可用 | 手工验收 |
| 公式 | 保持现有渲染链路，仅调整视觉语气 | 更协调但非 TeX 级 | 无 |
| HTML/图片/其他特殊节点 | 保持现有能力，必要时局部约束 | 不回归 | 手工验收 |
| 小窗口 | 版心让位于可编辑宽度 | 不至于过窄 | 手工验收 |

#### 4.4.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| Markdown 真相模型 | editor spec 约束 | parser/serializer 现有回归 |
| fallback block 行为 | 避免数据损伤 | editor spec 回归 |
| Mermaid / find-replace 合约 | 与本期视觉需求无关 | 现有相关测试 |

### 4.5 菜单与快捷键轻量统一详细设计

#### 4.5.1 需求内容

- 入口：
  - 应用菜单创建与窗口聚焦切换
- 操作人/调用方：
  - 用户通过菜单或快捷键操作
- 前置条件：
  - 现有 menu wiring 生效
- 输出结果：
  - 更符合 macOS 预期的菜单语气和窗口角色一致性

#### 4.5.2 方案设计

- 核心逻辑：
  - 保持现有菜单路由和 Workspace-only item enable/disable 机制。
  - 收敛文案、快捷键展示和窗口角色下的启停一致性。
  - 不引入新的复杂菜单层级。
- 状态流转：
  - 保持当前 focused window role 更新机制。
- 数据变更：
  - 无。
- 计算公式：
  - 不涉及。
- 幂等设计：
  - 重复 menu state 更新结果一致。
- 权限/越权控制：
  - 不涉及。
- 异常处理：
  - 菜单项状态更新失败沿用 warning 记录。
- 补偿/重试：
  - 不涉及。
- 日志与审计：
  - 保留现有 warning / role update 路径。

#### 4.5.3 流程步骤

1. 创建菜单。
2. 根据聚焦窗口角色设置 Workspace-only item 可用性。
3. 菜单触发现有命令分发。

#### 4.5.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| Workspace 聚焦 | 保持工作区相关菜单可用 | 与预期一致 | 无 |
| Document 聚焦 | 禁用 workspace-only 项 | 与预期一致 | 无 |
| 菜单状态更新失败 | 记录 warning | 极端情况下个别项状态异常 | warning |

#### 4.5.5 不变行为

| 行为/表面 | 保持不变的原因 | 验证方式 |
|---|---|---|
| 菜单命令路由 | 本期不做命令系统重构 | 现有菜单事件验证 |
| 快捷键核心语义 | 避免 muscle memory 回归 | 手工验证 |

## 五、存储类设计

### 5.1 库表设计

#### 5.1.1 数据库模型图

不涉及。本期不新增数据库或持久化模型。

#### 5.1.2 表结构

不涉及。本期不新增表结构。

字段明细：

不涉及。

### 5.2 数据迁移/初始化

- DDL：
  - 不涉及。
- DML：
  - 不涉及。
- 数据回填：
  - 不涉及。
- 老数据兼容：
  - 继续兼容现有主题偏好读取逻辑。
- 新老系统读写关系：
  - 不涉及。

### 5.3 缓存设计

不涉及。本期不新增缓存。

## 六、其他组件设计

### 6.1 消息设计

不涉及。

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| macOS window appearance strategy | macOS | 渐进增强 | 否 | 控制是否启用 titlebar/material 特性 | 不同系统版本能力差异 |
| editor content max width | all | 固定默认值 | 否 | 控制正文舒适版心 | 宽内容体验需人工校准 |

### 6.3 定时任务/批处理

不涉及。

### 6.4 技术组件

- 分布式锁：
  - 不涉及。
- 唯一 ID：
  - 继续沿用现有窗口 label / 文档 id 逻辑。
- 加解密/验签：
  - 不涉及。
- 字典转换：
  - 不涉及。
- Excel/文件处理：
  - 不涉及。
- 用户信息透传：
  - 不涉及。
- 限流/熔断：
  - 不涉及。

## 七、接口设计

### 7.1 接口设计原则

- 本期以本地 UI 与窗口配置为主，不新增外部 API。
- 若新增内部 helper 或前后端桥接参数，必须保持兼容默认值。
- 不得破坏现有菜单命令和 Tauri invoke surface。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 权限/认证 | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|
| 窗口 appearance helper | Tauri window creation | Rust/Tauri | 不涉及 | 创建时幂等 | 本文档 | 可能为内部函数 |
| 主题 token contract | React shells / controls | CSS/theme system | 不涉及 | 是 | 本文档 | 内部视觉 contract |

### 7.3 接口明细

#### 7.3.1 窗口 appearance helper

- 路径/方法：
  - Rust 内部 helper，不是外部 API。
- 请求头：
  - 不涉及。
- 请求参数：
  - window role、platform、title、size、route。
- 响应参数：
  - configured `WebviewWindowBuilder` 或等效 appearance config。
- 错误码：
  - 沿用 Tauri build error。
- 业务校验：
  - 非 macOS 不应用 macOS 特性。
- 数据变更：
  - 无。
- 日志字段：
  - role、platform、appearance strategy、fallback used。

#### 7.3.2 主题 token contract

- 路径/方法：
  - CSS / component internal contract。
- 请求头：
  - 不涉及。
- 请求参数：
  - `data-theme`、平台样式类、surface 类型。
- 响应参数：
  - 对应视觉 token。
- 错误码：
  - 不涉及。
- 业务校验：
  - token 缺失时不得导致文本不可见。
- 数据变更：
  - 无。
- 日志字段：
  - 不涉及。

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：
  - 本地开发和内部构建先行。
- 灰度开关：
  - 可通过平台判断和 appearance helper 回退实现软灰度。
- 验证指标：
  - 窗口可拖拽、按钮不被遮挡、深浅色截图、编辑器可读性。
- 放量节奏：
  - 先 macOS 验证，再检查其他平台不回归。

### 8.2 降级方案

- 降级触发条件：
  - macOS appearance 特性不可用或出现交互问题。
- 降级行为：
  - 回退普通 titlebar / 实色 surface。
- 用户影响：
  - 原生质感减弱，但功能保持可用。
- 恢复方式：
  - 修复后重新启用特性。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| Workspace shell | 视觉与布局调整 | 前端回归 | 开发 | 截图 + 交互验证 |
| Document shell | 视觉与布局调整 | 前端回归 | 开发 | 截图 + 交互验证 |
| Tauri window layer | 窗口 appearance 增强 | macOS 手工验证 | 开发 | 真机验证 |
| 菜单系统 | 轻量文案/状态统一 | 菜单测试 | 开发 | 手工验证 |

### 8.4 回滚方案

- 回滚条件：
  - 出现窗口不可拖拽、按钮遮挡、主题错乱、跨平台严重回归。
- 回滚步骤：
  - 关闭 macOS appearance helper，恢复旧 token 或旧 shell 样式。
- 数据回滚：
  - 不涉及。
- 配置回滚：
  - 回退 appearance strategy。
- 风险：
  - 视觉退回旧状态，但不应影响数据与功能。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：
  - 窗口创建失败、appearance helper fallback 频繁触发。
- 业务异常：
  - 不涉及新业务异常。
- 重试异常：
  - 不涉及。
- 超时：
  - 不涉及。
- 关键接口指标：
  - 不涉及服务端接口。
- 告警渠道：
  - 开发日志与手工验收。

### 9.2 性能与容量

- TPS/吞吐：
  - 不涉及。
- CPU/内存/磁盘 IO/网络 IO：
  - 本期应避免新增显著前端动画和重渲染。
- 数据容量：
  - 不涉及。
- 缓存容量：
  - 不涉及。
- 跑批耗时：
  - 不涉及。
- 是否压测：
  - 不涉及；以交互性能观察为主。

### 9.3 可靠性与兜底

- 幂等击穿：
  - 不涉及。
- 并发失效：
  - 不涉及新增并发模型。
- 冷热备：
  - 不涉及。
- 关键任务独立性：
  - appearance helper 应独立于业务逻辑，失败可回退。
- 字段兜底：
  - 主题/appearance 缺省值必须可用。
- 老新数据兼容：
  - 保持现有主题偏好 key 兼容读取。

## 十、排期与规划

### 10.1 任务拆分与工作量评估

| 任务 | 范围 | 负责人 | 工作量 | 依赖 | 备注 |
|---|---|---|---|---|---|
| 窗口 appearance helper | Tauri/Rust | 待定 | 待评估 | 设计确认 | macOS-only path |
| 主题 token 与共享控件 | app/globals + ui controls | 待定 | 待评估 | 设计确认 | 多主题覆盖 |
| Workspace / Document shell 重塑 | workspace/document components | 待定 | 待评估 | token 完成 | 两模式统一 |
| 编辑阅读基线 | editor styles | 待定 | 待评估 | shell 完成 | 版心与内容块节奏 |
| 验收与回归 | 截图、lint、tests、手工验证 | 待定 | 待评估 | 实现完成 | 包含 macOS 真机验证 |

### 10.2 计划时间

- 数据方案评审：
  - 不涉及。
- 开发开始/结束：
  - 待排期。
- CR：
  - 待排期。
- 联调完成/提测：
  - 待排期。
- 测试用例评审：
  - 待排期。
- 测试开始/结束：
  - 待排期。
- 预发布：
  - 待排期。
- 上线：
  - 待排期。
- 线上验证：
  - 待排期。

### 10.3 发布计划

1. 需求纳入发布版本
2. 确认 macOS appearance 与主题设计稿/约束
3. 完成代码 CR
4. 运行 lint / tests / 截图验证
5. macOS 手工验证窗口壳层与编辑体验
6. 检查非 macOS 不回归

### 10.4 遗留问题与后续规划

| 问题 | 影响 | 处理计划 | 负责人 | 截止时间 |
|---|---|---|---|---|
| Knuth–Plass 全局断行 | 高阶排版体验未实现 | 第二阶段单独立项 | 待定 | 待定 |
| OpenType MATH / TeX-like 公式布局 | 公式质量上限仍受现有渲染链路限制 | 第二阶段设计评估 | 待定 | 待定 |
| 阅读预览或专注模式 | 第一阶段不提供额外阅读面 | 后续按排版引擎方案决定 | 待定 | 待定 |

### 10.5 Planning Handoff

- `plan-to-exec` 可以决定：
  - 具体文件拆分
  - token 常量命名
  - 组件改造顺序
  - 截图验证脚本是否新增
  - 测试粒度和具体命令
- 必须返回 `spec` 的事项：
  - 若实现时需要改变编辑器文档模型、parser/serializer、fallback contract
  - 若需要新增阅读模式或第二种排版 surface
  - 若需要改动 CLI / LLM Wiki / Memory 的交互模型
- 必须返回 `clarify` 的事项：
  - 若产品方向从 macOS-first 改为 macOS-only
  - 若第一阶段范围被扩大到 Knuth–Plass 或 OpenType MATH
- 推荐下一步：

```text
$plan-to-exec docs/loopx/design/MDX macOS原生质感与编辑阅读体验第一阶段需求设计文档.md
```

## 十一、QA

### 11.1 评审记录

| 评审时间 | 评审人 | 评审问题 | 处理进展 | 结论 |
|---|---|---|---|---|
| 2026-06-24 | Codex | 第一阶段是否应包含排版引擎 | 已澄清为否 | closed |

### 11.2 待确认问题

| 问题 | 需要谁确认 | 阻塞阶段 | 推荐答案 | 状态 |
|---|---|---|---|---|
| 无 | 无 | 无 | 无 | closed |
