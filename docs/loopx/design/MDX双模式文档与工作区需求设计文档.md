# MDX双模式文档与工作区设计文档

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿，基于 clarify 结果形成 Document Mode 与 Workspace Mode 双模式设计 | 2026-06-04 | Codex |

## 二、需求信息

### 2.1 需求背景

- 背景：MDX 当前实现是单一 Workspace Mode。用户希望 MDX 在打开单个 Markdown 文档时保持轻量，不显示文件树和 LLM Wiki；直接启动应用或打开文件夹时继续作为完整工作区使用。
- 需求目的：将 MDX 定位和实现调整为双模式本地 Markdown 应用：单文件入口是轻量 Document Mode，文件夹入口是 Workspace Mode，并可选升级为 LLM Wiki 知识库。
- 目标用户/使用方：用 MDX 快速编辑单个 Markdown 文件的用户；用 MDX 管理文件夹、工作区和 LLM Wiki 知识库的用户；继续通过 `mdx-cli` 操作 Workspace Mode 的本地自动化/Agent。
- 需求链接：无外部需求链接。
- 关联原始材料：
  - `.loopx/intake/clarify-mdx-document-workspace-modes-20260604-111142.md`
  - `README.zh-CN.md`
  - `features/workspace/components/workspace-app.tsx`
  - `features/workspace/components/workspace-shell.tsx`
  - `features/workspace/hooks/use-workspace-bootstrap.ts`
  - `features/workspace/lib/types.ts`
  - `src-tauri/tauri.conf.json`

### 2.2 需求范围

- 本期范围：
  - 新增 Document Mode：只接受已有 `.md/.markdown` 单文件。
  - 新增顶层 app session / window role，区分 `document` 和 `workspace`。
  - macOS bundle 声明 `.md/.markdown` 文件关联。
  - 处理 macOS 系统打开文件事件：单文件或多文件打开对应 Document Mode 窗口。
  - Document Mode 使用当前编辑器体验和实时目录，不显示文件树、LLM Wiki、多标签。
  - Document Mode 支持保存、关闭未保存保护、标题栏脏状态、外部修改保存检查。
  - Document Mode 图片资产优先保存到当前 Markdown 同目录 `.assets/`，不可写时 fallback 到 `~/.mdx/assets`。
  - Workspace Mode 保持现有功能：文件树、多标签、目录、LLM Wiki tab、CLI、直接启动恢复最近 workspace。
  - Workspace Mode 主窗口第一版唯一；Document Mode 可多窗口。
  - 更新 README / 产品说明为双模式定位。
- 非目标：
  - Document Mode 不做多标签。
  - Document Mode 不做新建、另存为、重命名、移到废纸篓、刷新。
  - Document Mode 不纳入 CLI / Agent 自动化。
  - Document Mode 不解析或跳转 `[[wikilink]]`。
  - 不做实时文件系统监听。
  - 不做自动保存。
  - 不支持 `.mdx`。
  - 不验收 Windows/Linux 文件关联和打开事件。
  - Workspace Mode 文件树打开 `.md` 不改为 Document Mode。
- 决策边界：
  - 可由 plan 决定：文件命名、局部组件拆分、具体 CSS、错误文案微调、Document outline 默认宽度常量。
  - 必须回 spec：改变 Document Mode 是否多标签、把 Document Mode 纳入 CLI、支持 `.mdx`、支持应用内打开单文件入口、改变图片资产默认位置。
  - 必须回 clarify：是否允许多个 Workspace Mode 主窗口、是否恢复 Document Mode 会话、是否引入实时监听或自动保存。
- 依赖方：
  - Tauri 2 macOS 文件关联和 open-file 事件能力。
  - 当前 `@do-md/react` 编辑器集成。
  - 当前 Workspace Mode 文件保存、图片资产、outline 解析等能力。
  - macOS Finder / Launch Services。
- 约束条件：
  - 第一版只按 macOS 验收。
  - 文件关联只声明 MDX 可打开 `.md/.markdown`，不强制设置为默认应用。
  - Document Mode 可以打开 workspace 外任意位置的 Markdown 文件。
  - Symlink 文件打开时必须在打开阶段解析真实路径，之后读取和保存固定使用真实路径。

### 2.3 可行性分析

- 业务可行性：双模式符合用户入口意图。单文件打开是轻量编辑器，文件夹打开是完整工作区，能降低普通文档编辑时的复杂度。
- 技术可行性：现有 editor、outline、save guard、dialog、window、state store 能力可复用，但需要新增顶层 session/window role 和 Tauri open-file 处理。
- 团队接受能力：属于跨前端、Rust/Tauri、配置、状态和文档的中大型 brownfield 改动，需要先拆计划分阶段实现。
- 时间成本：中等偏高。复杂点在 macOS cold launch open-file 事件、唯一 Workspace 窗口、菜单按窗口角色启用、跨窗口冲突提示。
- 资源成本：无服务端资源；需要 macOS 本地打包验证。
- 替代方案：
  - 在 WorkspaceShell 中隐藏文件树和 LLM Wiki 来模拟 Document Mode：实现较快，但保留 rootPath/fileTree/tabs/LLM hook，心智和架构都不干净，拒绝。
  - 直接把单文件所在目录作为 workspace 打开：会误触发 LLM Wiki 和文件树，违背入口意图，拒绝。
  - 将 Document Mode 纳入 CLI：能力更统一，但第一版协议改造过大，拒绝。
- 关键风险：
  - Tauri 默认创建窗口和 macOS open-file event 顺序可能导致冷启动时多出 workspace 窗口。
  - 菜单项当前是全局菜单，需要根据 focused window role 正确启用/分发。
  - 同一路径同时在 Workspace tab 和 Document window 未保存时，第一版只能提示，不能同步内容。
  - 图片 fallback 到全局 assets 后的链接策略需要明确实现，避免破坏 Markdown 可移植性。

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 明确 MDX 的两个产品模式和入口：Document Mode 对应单 Markdown 文件；Workspace Mode 对应直接启动和文件夹。
  - 让 Document Mode 不加载文件树、LLM Wiki、workspace scan、CLI snapshot。
  - 保持 Workspace Mode 现有能力不回退。
  - 建立多窗口角色管理，为后续窗口菜单和打开事件提供稳定边界。
- 总体思路：
  - 引入顶层 `AppSession` / window role。窗口创建时决定渲染 `DocumentShell` 或 `WorkspaceShell`。
  - Rust/Tauri 管理唯一 Workspace window 和多个 Document windows。
  - macOS open-file event 只针对 `.md/.markdown` 创建或聚焦 Document window。
  - DocumentShell 复用 editor 和 outline 能力，但使用单文件 state，不依赖 `WorkspaceState`。
  - 保存逻辑拆出 Document file IO 和 conflict guard，不走 workspace root。
- 核心模块：
  - App Session / Window Role Manager。
  - Document Bootstrap。
  - Document Shell。
  - Document File Commands。
  - Document Save Guard。
  - Document Asset Manager。
  - Workspace Mode Compatibility Layer。
  - README / Product Docs。
- 主要难点：
  - 冷启动文件打开不创建 Workspace Mode 主窗口。
  - 多窗口菜单正确分发。
  - Document Mode 单文件读写和 symlink 固定目标安全。
  - 外部修改检测和跨 Workspace tab 冲突提示。
- 技术指标：
  - 单文件打开不得触发 `scan_workspace`、`llm_wiki_detect_workspace` 或 raw ingest。
  - Direct launch 只创建/聚焦一个 Workspace Mode 主窗口。
  - 多个 Markdown 文件打开时每个路径最多一个 Document window。
  - 保存前外部修改检测基于打开/上次保存后的文件指纹。

### 3.2 整体架构设计

- 业务模式：
  - Document Mode：单 Markdown 文档编辑器。
  - Workspace Mode：Markdown 文件夹工作区，可选 LLM Wiki 知识库。
- 系统边界：
  - 前端负责模式 UI、编辑状态、outline、dirty guard、用户确认。
  - Rust/Tauri 负责窗口角色、文件关联事件、安全文件 IO、状态持久化、菜单事件。
  - CLI 仅连接 Workspace Mode。
- 上下游系统：
  - 上游：macOS Finder/open event、用户直接启动、MDX 内打开文件夹、CLI 请求。
  - 下游：本地 Markdown 文件、同目录 `.assets/`、`~/.mdx/assets`、`~/.mdx/state.json`。
- 应用架构：
  - `WorkspaceApp` 演进为顶层 `AppShell` 或按 window payload 渲染不同 shell。
  - `WorkspaceShell` 保留现有 workspace 结构。
  - 新增 `DocumentShell`，包含 editor area 和 right outline。
  - Tauri 新增 window registry，记录 document real path 到 window label 的映射，以及唯一 workspace window。
- 技术架构：
  - React/Next 保持静态前端。
  - Tauri window label 体现 role，例如 `workspace-main`、`document-<id>`。
  - 前端通过启动参数或 Tauri command 获取当前 window role/session。
  - 文件读写 commands 分为 workspace commands 和 document commands。
- 数据流转：
  1. 用户直接启动 MDX：Rust 聚焦或创建 workspace window，前端执行 workspace bootstrap。
  2. 用户从 Finder 打开 `.md`：Rust 解析真实路径，聚焦已有 document window 或创建 document window，前端读取单文件。
  3. DocumentShell 编辑内容，解析 outline，更新 dirty 和标题栏。
  4. Cmd+S 保存时检查磁盘指纹，必要时确认覆盖，写回真实路径。
  5. 关闭 Document window 时如 dirty，提示保存 / 丢弃 / 取消。

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| 直接启动 MDX | 用户点击 app 图标 | Tauri Window Manager, WorkspaceApp | 聚焦唯一 Workspace window；无则创建；前端恢复 recent workspace 或选择文件夹 | 恢复失败显示 workspace error/empty state | Workspace Mode |
| Finder 打开单 Markdown | macOS open-file event | Tauri open handler, Document Bootstrap | 过滤 `.md/.markdown`，解析真实路径，聚焦已有 document 或创建新 document window | 文件无效则打开 document error window | Document Mode |
| Finder 打开多个 Markdown | 一次 open 多路径 | Tauri open handler | 对每个合法 Markdown 执行单文件流程 | 非 Markdown 跳过并可提示 | 多个 Document windows |
| Document 保存 | Cmd+S/菜单 | DocumentShell, Document File Commands | 比较打开指纹和当前磁盘指纹，未变化则写入；变化则确认覆盖 | 写失败提示；取消则保持 dirty | 文件保存 |
| Document 关闭 | 用户关闭窗口 | DocumentShell, Tauri close event | dirty 时弹保存/丢弃/取消；无 dirty 直接关闭 | 保存失败不关闭；取消不关闭 | 窗口关闭或保留 |
| 打开文件夹 | Document menu/Workspace empty state | Menu Dispatcher, Workspace Window Manager | 聚焦唯一 workspace window，执行 choose workspace | 用户取消则保持当前状态 | Workspace Mode |
| Workspace 文件树打开 Markdown | 用户点击 workspace 文件树 | FileTreePanel, WorkspaceShell | 仍在 workspace tab 中打开/复用 | 读取失败提示 | Workspace tab |
| LLM Wiki | Workspace Mode 中打开文件夹 | WorkspaceShell, LLM Wiki hook | 普通文件夹显示初始化入口；LLM Wiki workspace 可处理 raw/wiki | Document Mode 完全不触发 | 知识库能力 |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| Window Role Manager | 管理窗口身份 | 唯一 workspace window、多 document window、路径去重、聚焦 | Tauri window APIs | Rust 侧为准 |
| App Session Bootstrap | 前端获取当前窗口 session | `document` / `workspace` / error session | Tauri command/window payload | 替代单一 WorkspaceApp 假设 |
| DocumentShell | 单文档 UI | 编辑器、目录、保存、关闭保护、标题栏 | editor adapter, outline parser | 不挂载 LLM Wiki |
| Document File Commands | 单文件 IO | 解析真实路径、读取、写入、指纹 | Rust fs | 不依赖 workspace root |
| Document Asset Manager | 图片保存 | 同目录 `.assets/` 优先，全局 fallback | existing assets logic | 插入相对/可用链接 |
| Menu Dispatcher | 菜单按窗口分发 | 保存、关闭窗口、打开文件夹，禁用 workspace-only 项 | focused window role | 需要避免误触发 |
| WorkspaceShell | 工作区 UI | 文件树、tabs、outline、LLM Wiki、CLI | 现有模块 | 行为保留 |
| Documentation | 产品定位 | README 双模式说明 | docs | 验收项 |

### 3.5 新增/调整功能说明

- 前端新增 Document Mode UI，不复用 WorkspaceState 作为单文件状态。
- Rust/Tauri 新增文件关联、open-file event、window registry、document file commands。
- Workspace Mode 启动路径调整为只在直接启动或打开文件夹时执行。
- 全局菜单需要根据 focused window role 启用和分发。
- README 更新为“双模式本地 Markdown 应用”。

## 四、详细设计

### 4.1 App Session 与窗口角色详细设计

#### 4.1.1 需求内容

- 入口：应用启动、Finder 打开文件、Document Mode 中打开文件夹、Workspace Mode 选择文件夹。
- 操作人/调用方：macOS、用户、Tauri app lifecycle、前端 bootstrap。
- 前置条件：macOS 桌面版。
- 输出结果：每个窗口拥有明确 role，前端渲染对应 shell。

#### 4.1.2 方案设计

- 核心逻辑：
  - Rust 维护 `workspace_window_label: Option<String>`。
  - Rust 维护 `document_windows: BTreeMap<RealPath, WindowLabel>`。
  - 直接启动：聚焦 workspace window；不存在则创建 workspace window。
  - open-file：对每个 Markdown 路径解析真实路径，聚焦已有 document window 或创建新 document window。
  - 前端启动时调用 `get_window_session` 获取 `{ kind: "workspace" }` 或 `{ kind: "document", filePath, displayPath, realPath }`。
- 状态流转：
  - `none` → `workspace`
  - `none` → `document`
  - `workspace` + open file → `workspace` + `document`
  - `document` 打开文件夹 → `document` + `workspace`
- 数据变更：
  - 运行时 window registry 更新。
  - 不写入 `~/.mdx/state.json` 的 Document session。
- 计算公式：无。
- 幂等设计：
  - 同一 real path 重复打开只聚焦已有 document window。
  - Direct launch 重复触发只聚焦唯一 workspace window。
- 权限/越权控制：
  - Document real path 由 Rust 打开时解析并保存到 session，不从前端任意传入切换。
- 异常处理：
  - 路径不存在、权限不足、非普通文件时创建 document error session。
- 补偿/重试：
  - error window 可关闭，也可打开文件夹进入 Workspace Mode。
- 日志与审计：
  - debug log 记录 open-file 路径、role、聚焦/创建结果。

#### 4.1.3 流程步骤

1. Tauri 收到 launch 或 open-file 输入。
2. 判断是否有文件路径。
3. 无路径则进入 workspace direct launch。
4. 有路径则过滤 `.md/.markdown`。
5. 对每个合法路径解析 real path。
6. 查 document registry，已有则聚焦；否则创建 document window。
7. 前端获取 session 并渲染对应 shell。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 单文件冷启动 | 只创建 Document window | 不弹 workspace | debug log |
| 直接启动已有 workspace window | 聚焦已有窗口 | 不重复开主窗口 | debug log |
| 多个文件同时打开 | 每个路径一个窗口 | 多窗口 | debug log |
| 同一路径重复打开 | 聚焦已有窗口 | 保留未保存修改 | debug log |
| 非 Markdown 被系统交给 MDX | 不进入 Document Mode，显示错误或忽略 | 错误提示 | warn log |

### 4.2 DocumentShell 详细设计

#### 4.2.1 需求内容

- 入口：Document window 创建成功。
- 操作人/调用方：用户。
- 前置条件：session kind 为 document。
- 输出结果：轻量 Markdown 编辑器 + 目录。

#### 4.2.2 方案设计

- 核心逻辑：
  - DocumentShell 只包含 header、editor、outline。
  - 不渲染 FileTreePanel、TabStrip、LlmWikiPanel。
  - 不调用 `useLlmWikiWorkspace`。
  - 不调用 `scan_workspace`。
  - 目录从当前 Markdown H1-H6 实时解析。
  - 顶部显示文件名，完整路径放 tooltip 或弱状态文本。
- 状态流转：
  - `loading` → `ready`
  - `loading` → `error`
  - `ready` → `dirty` → `saved`
- 数据变更：
  - 内存中保存 markdown、dirty、file fingerprint、outlineCollapsed。
  - 不持久化 document session。
- 计算公式：
  - dirty = 当前 markdown 与上次保存 markdown 不一致。
  - title = dirty ? `● ${fileName} - MDX` : `${fileName} - MDX`。
- 幂等设计：
  - 重复 load 同一 session 不应清空 dirty 内容。
- 权限/越权控制：
  - DocumentShell 不接受用户输入路径切换；所有 filePath 来自 session。
- 异常处理：
  - 读取失败显示 error view。
  - 保存失败弹错误并保持 dirty。
- 补偿/重试：
  - 用户可再次保存。
- 日志与审计：
  - console warn 记录 save/load 失败。

#### 4.2.3 流程步骤

1. 获取 document session。
2. 调用 read document command 读取内容和 fingerprint。
3. 渲染 editor 和 outline。
4. 用户编辑触发 markdown 更新和 dirty。
5. Cmd+S 调用保存流程。
6. 关闭窗口时进入 dirty guard。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 文件名相同路径不同 | 顶部文件名相同，tooltip 显示完整路径 | 可区分路径 | 无 |
| 目录折叠 | 当前窗口内临时折叠 | 关闭后不恢复 | 无 |
| wikilink 点击 | 忽略或提示单文档模式不支持 | 不跳转 | warn log 可选 |
| `.mdx` 文件 | 不进入 Document Mode | 错误提示 | warn log |

### 4.3 Document 文件读写与保存冲突详细设计

#### 4.3.1 需求内容

- 入口：Document window load、Cmd+S、关闭保存。
- 操作人/调用方：DocumentShell。
- 前置条件：real path 已解析。
- 输出结果：安全读取/保存单 Markdown 文件。

#### 4.3.2 方案设计

- 核心逻辑：
  - 打开时 canonicalize 输入路径，解析 symlink，固定 real path。
  - 只允许 `.md/.markdown`。
  - 读取真实文件并生成 fingerprint。
  - 保存前重新读取当前磁盘 fingerprint。
  - 若 fingerprint 与上次加载/保存 fingerprint 不同，提示覆盖保存 / 取消。
  - 覆盖保存后更新 fingerprint 和 saved markdown。
- 状态流转：
  - `clean` → `dirty`
  - `dirty` + save + no conflict → `clean`
  - `dirty` + save + conflict + cancel → `dirty`
  - `dirty` + save + conflict + overwrite → `clean`
- 数据变更：
  - 本地文件内容。
  - 内存 fingerprint。
- 计算公式：
  - fingerprint 可由 metadata mtime/size + content hash 组成；plan 可选择具体实现。
- 幂等设计：
  - 连续保存同内容不重复提示冲突。
- 权限/越权控制：
  - 保存只写 session real path。
  - 不重新跟随 display path symlink。
- 异常处理：
  - 文件删除：保存提示文件不存在，可由用户取消；第一版不做另存为。
  - 权限不足：显示错误。
- 补偿/重试：
  - 失败保持 dirty。
- 日志与审计：
  - 保存冲突可记录 debug log。

#### 4.3.3 流程步骤

1. read_document_file 返回 content、realPath、displayPath、fingerprint。
2. 用户编辑。
3. save_document_file 传入 expected fingerprint 和 content。
4. Rust 比较当前 fingerprint。
5. 无冲突写入。
6. 有冲突返回 conflict error，前端询问。
7. 用户选择覆盖时调用 overwrite save。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| symlink 打开后被替换 | 保存仍写打开时 real path | 不受 link 变化影响 | debug log |
| 文件外部修改 | 保存前提示覆盖/取消 | 避免静默覆盖 | 无 |
| 文件被删除 | 保存失败，不自动另存为 | 错误提示 | warn log |
| 文件变为目录 | 保存失败 | 错误提示 | warn log |

### 4.4 Document 图片资产详细设计

#### 4.4.1 需求内容

- 入口：Document Mode 中粘贴/插入图片。
- 操作人/调用方：编辑器图片保存 adapter。
- 前置条件：当前 document 已有 real path。
- 输出结果：图片保存并在 Markdown 中插入链接。

#### 4.4.2 方案设计

- 核心逻辑：
  - 首选目录：document 所在目录 `.assets/`。
  - 若创建/写入失败，fallback 到 `~/.mdx/assets`。
  - 首选成功时插入 `.assets/<hash>.<ext>` 相对链接。
  - fallback 时插入可被 MDX 加载的全局 assets 链接。具体链接格式由 plan 根据现有 assets loader 决定，但必须在 README 或错误提示中说明便携性限制。
- 状态流转：无独立状态。
- 数据变更：
  - document sibling `.assets/` 或 `~/.mdx/assets` 新增图片。
  - Markdown 内容插入图片链接。
- 计算公式：
  - 继续使用内容 hash 去重。
- 幂等设计：
  - 相同图片内容可复用同一资产文件。
- 权限/越权控制：
  - sibling `.assets/` 写入只基于 document real parent。
  - fallback 只能写入 `~/.mdx/assets`。
- 异常处理：
  - 两个位置都失败则提示图片保存失败。
- 补偿/重试：
  - 用户可重新粘贴或保存图片。
- 日志与审计：
  - fallback 时可 warn。

#### 4.4.3 流程步骤

1. 编辑器请求保存图片。
2. Rust/asset adapter 尝试写 document parent `.assets/`。
3. 成功则返回相对链接。
4. 失败则写 `~/.mdx/assets`。
5. 返回 fallback 链接并提示或记录。

#### 4.4.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 文档目录不可写 | fallback 全局 assets | 可提示便携性降低 | warn log |
| 全局 assets 不可写 | 保存图片失败 | 错误提示 | warn log |
| 同名 hash 已存在 | 复用 | 无重复文件 | 无 |

### 4.5 菜单与快捷键详细设计

#### 4.5.1 需求内容

- 入口：macOS app menu、Cmd+S、关闭窗口、打开文件夹。
- 操作人/调用方：用户、focused window。
- 前置条件：有 focused MDX window。
- 输出结果：菜单动作发给正确窗口和模式。

#### 4.5.2 方案设计

- 核心逻辑：
  - 菜单分发以 focused window role 为准。
  - Document Mode 启用：保存、关闭窗口、打开文件夹。
  - Workspace Mode 启用现有：打开文件夹、新建 Markdown、新建文件夹、重命名、移到废纸篓、刷新、保存、关闭标签页。
  - Document Mode 中打开文件夹：聚焦/创建唯一 Workspace window，并在该窗口执行 choose workspace。
- 状态流转：菜单 enabled state 随 focus window 变化。
- 数据变更：无。
- 计算公式：无。
- 幂等设计：
  - 没有 workspace window 时只创建一个。
- 权限/越权控制：
  - Document window 不应收到 workspace-only menu event。
- 异常处理：
  - 分发失败 console warn。
- 补偿/重试：用户可重试菜单动作。
- 日志与审计：debug log 可选。

#### 4.5.3 流程步骤

1. 用户点击菜单。
2. Rust 找 focused window。
3. 根据 window role 决定 enable/dispatch。
4. 前端执行对应模式动作。

#### 4.5.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| Document focused 点击新建文件夹 | 禁用或隐藏 | 不可点击 | 无 |
| Document focused 点击打开文件夹 | 聚焦 workspace 并打开选择器 | Document 保留 | debug log |
| 无 focused window | 优先 workspace，否则任一 window | 尽量可用 | warn log |

### 4.6 Workspace Mode 兼容详细设计

#### 4.6.1 需求内容

- 入口：直接启动、打开文件夹、Workspace 文件树操作、CLI。
- 操作人/调用方：用户、CLI/Agent。
- 前置条件：Workspace window。
- 输出结果：现有 workspace 行为保留。

#### 4.6.2 方案设计

- 核心逻辑：
  - WorkspaceShell 保留文件树、多标签、目录、LLM Wiki。
  - 普通文件夹仍显示 LLM Wiki tab，提供初始化/配置入口。
  - LLM Wiki ready 时保留 raw ingest、query、digest、lint、graph。
  - 文件树打开 Markdown 仍打开 workspace tab。
  - CLI snapshot 继续只包含 Workspace Mode。
- 状态流转：沿用现有 WorkspaceState。
- 数据变更：沿用 `~/.mdx/state.json` 的 workspace 持久化。
- 计算公式：无。
- 幂等设计：
  - 唯一 Workspace window。
- 权限/越权控制：
  - 沿用 workspace root guard。
- 异常处理：
  - 沿用现有 workspace 错误处理。
- 补偿/重试：沿用现有刷新/重试。
- 日志与审计：沿用现有。

#### 4.6.3 流程步骤

1. Direct launch 创建/聚焦 workspace window。
2. `useWorkspaceBootstrap` 恢复 recent workspace 或选择文件夹。
3. WorkspaceShell 挂载 LLM Wiki hook。
4. 用户通过文件树打开 tab。
5. CLI 操作 workspace tabs。

#### 4.6.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| Finder 打开 workspace 内 Markdown | Document Mode | 不影响 workspace | 可提示冲突 |
| Workspace tab dirty 且 Document 打开同路径 | Document 窗口提示 workspace 有未保存版本 | 降低冲突风险 | warn log |
| Direct launch 已有 workspace | 聚焦已有 | 不重复窗口 | debug log |

## 五、存储类设计

### 5.1 库表设计

#### 5.1.1 数据库模型图

不涉及数据库。只涉及本地 JSON 状态、运行时窗口 registry 和本地文件。

#### 5.1.2 表结构

不涉及数据库表。

字段明细：不涉及。

### 5.2 数据迁移/初始化

- DDL：不涉及。
- DML：不涉及。
- 数据回填：不涉及。
- 老数据兼容：
  - 现有 `~/.mdx/state.json` workspace state 继续有效。
  - `recentWorkspaceRoot` 只由 Workspace Mode 更新。
  - Document Mode 不写入 recent workspace，不写入 workspace tabs。
- 新老系统读写关系：
  - Workspace Mode 继续读写现有 app state。
  - Document Mode 只复用全局窗口尺寸和主题，不写入 document session。

### 5.3 缓存设计

| 场景 | Key | Value | 数据结构 | 过期时长 | 容量预估 | 失效/刷新策略 |
|---|---|---|---|---|---|---|
| Document window registry | realPath | windowLabel | Rust runtime map | 进程生命周期 | 打开的文档数量 | 窗口关闭时删除 |
| Document file fingerprint | realPath | fingerprint | 前端/后端 session field | 窗口生命周期 | 每窗口 1 条 | 保存成功后更新 |

## 六、其他组件设计

### 6.1 消息设计

不涉及跨进程消息队列。Tauri menu/open-file/window event 属于本地事件。

| 场景 | Group | Topic | 生产者 | 消费者 | 幂等键 | 失败补偿 |
|---|---|---|---|---|---|---|
| 打开文件夹菜单 | 不涉及 | `mdx-menu-open-folder` 或等价事件 | Tauri menu | focused window frontend | window label | 用户重试 |
| 保存菜单 | 不涉及 | `mdx-menu-save` 或 document save event | Tauri menu | focused window frontend | window label | 用户重试 |
| macOS 打开文件 | 不涉及 | Tauri open-file event | macOS | Rust window manager | realPath | 聚焦已有窗口 |

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| macOS file association | bundle | `.md`, `.markdown` | 打包后生效 | 声明 MDX 可打开 Markdown 文件 | 需验证 Info.plist |
| Document default size | frontend/window | 900x820 | 新窗口生效 | 无全局尺寸时使用 | 视觉需验收 |
| Document outline width | frontend | 280px | 新窗口生效 | 不持久化 | 小屏布局需验证 |

### 6.3 定时任务/批处理

不涉及。

### 6.4 技术组件

- 分布式锁：不涉及。
- 唯一 ID：Document window label 使用递增 ID 或 path hash + collision suffix。
- 加解密/验签：不涉及。
- 字典转换：window role enum、app session enum。
- Excel/文件处理：只处理 Markdown 文件和图片资产。
- 用户信息透传：不涉及。
- 限流/熔断：不涉及。

## 七、接口设计

### 7.1 接口设计原则

- Document commands 不接受 arbitrary write path；保存目标必须来自已建立的 document session real path。
- 非纯查询接口必须携带 expected fingerprint 或 overwrite 标记。
- 错误码要区分 unsupported type、not found、permission denied、external modified、not file。
- Workspace commands 保持现有契约。
- CLI contract 第一版不新增 Document Mode。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 权限/认证 | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|
| `get_window_session` | 前端 AppShell | Tauri | 本地窗口 | 是 | 本文 | 返回当前窗口 role/session |
| `read_document_file` | DocumentShell | Tauri | 本地文件权限 | 是 | 本文 | 读取真实 Markdown 文件和 fingerprint |
| `save_document_file` | DocumentShell | Tauri | 本地文件权限 | expected fingerprint | 本文 | 无冲突保存 |
| `overwrite_document_file` | DocumentShell | Tauri | 本地文件权限 | window session | 本文 | 用户确认后覆盖 |
| `save_document_asset` | editor image adapter | Tauri | 本地文件权限 | content hash | 本文 | sibling `.assets/` 优先 |
| `focus_or_create_workspace_window` | Document menu / Rust lifecycle | Tauri | 本地窗口 | 是 | 本文 | 唯一 Workspace window |

### 7.3 接口明细

#### 7.3.1 `get_window_session`

- 路径/方法：Tauri command。
- 请求头：不涉及。
- 请求参数：当前 window label 可由 Tauri context 获取。
- 响应参数：
  - `kind`: `"workspace" | "document" | "documentError"`
  - `fileName?`
  - `displayPath?`
  - `realPath?`
  - `error?`
- 错误码：
  - `unknown_window`: 未注册窗口。
- 业务校验：窗口 label 必须存在于 registry 或为 workspace window。
- 数据变更：无。
- 日志字段：window label、kind。

#### 7.3.2 `read_document_file`

- 路径/方法：Tauri command。
- 请求头：不涉及。
- 请求参数：window/session id 或 real path token；具体由 plan 设计，不能让前端任意切换路径。
- 响应参数：
  - `content`
  - `fileName`
  - `displayPath`
  - `realPath`
  - `fingerprint`
- 错误码：
  - `unsupported_file_type`
  - `not_found`
  - `not_file`
  - `permission_denied`
  - `read_failed`
- 业务校验：真实路径扩展名必须是 `.md/.markdown`。
- 数据变更：无。
- 日志字段：realPath、error code。

#### 7.3.3 `save_document_file`

- 路径/方法：Tauri command。
- 请求头：不涉及。
- 请求参数：
  - `content`
  - `expectedFingerprint`
- 响应参数：
  - `fingerprint`
- 错误码：
  - `external_modified`
  - `not_found`
  - `not_file`
  - `permission_denied`
  - `write_failed`
- 业务校验：当前磁盘 fingerprint 必须等于 expectedFingerprint。
- 数据变更：写入 document real path。
- 日志字段：realPath、old/new fingerprint、conflict。

#### 7.3.4 `overwrite_document_file`

- 路径/方法：Tauri command。
- 请求头：不涉及。
- 请求参数：
  - `content`
- 响应参数：
  - `fingerprint`
- 错误码：同 `save_document_file`，但不返回 `external_modified`。
- 业务校验：只能由用户确认覆盖后调用。
- 数据变更：覆盖 document real path。
- 日志字段：realPath。

#### 7.3.5 `save_document_asset`

- 路径/方法：Tauri command 或扩展现有 asset command。
- 请求头：不涉及。
- 请求参数：
  - image bytes / MIME
  - document session id
- 响应参数：
  - markdown image URL
  - storage kind: `"documentAssets" | "globalAssets"`
- 错误码：
  - `asset_save_failed`
  - `permission_denied`
- 业务校验：document parent 目录来自 real path。
- 数据变更：写 `.assets/` 或 `~/.mdx/assets`。
- 日志字段：storage kind、path、fallback。

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：本地 macOS 开发构建和打包产物。
- 灰度开关：不设计运行时开关。实现期间可通过未注册 file association 的 dev 启动分阶段验证。
- 验证指标：
  - Finder 打开 `.md/.markdown` 成功进入 Document Mode。
  - Direct launch 仍进入 Workspace Mode。
  - Workspace Mode LLM Wiki 原有测试通过。
  - 保存冲突不会静默覆盖外部修改。
- 放量节奏：先本地 dev 验证，再 `npx tauri build` 验证 bundle Info.plist 和 Finder 打开。

### 8.2 降级方案

- 降级触发条件：
  - open-file 冷启动导致错误窗口或多余 workspace window。
  - 菜单误分发导致数据风险。
  - Document save conflict 误判严重。
- 降级行为：
  - 回退 file association 配置，不声明 `.md/.markdown`。
  - 保留 Workspace Mode 不受影响。
- 用户影响：
  - 单文件 Finder 打开能力暂不可用。
  - 工作区编辑和 LLM Wiki 继续可用。
- 恢复方式：
  - 修复窗口/文件事件后重新打包。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| Workspace Mode | 应保持兼容 | 不改变 WorkspaceState 语义 | Codex/用户 | npm test、cargo test、手测 |
| LLM Wiki | Document Mode 不挂载 | 保证 hook 只在 WorkspaceShell | Codex/用户 | 检查无 LLM 命令触发 |
| CLI | 继续只服务 Workspace Mode | 不扩展协议 | Codex/用户 | mdx-cli smoke test |
| macOS Bundle | 新增文件关联 | 配置 Info.plist | Codex/用户 | Finder 打开方式验证 |
| Menu | 按窗口 role 分发 | 新增 role-aware dispatch | Codex/用户 | 聚焦不同窗口手测 |

### 8.4 回滚方案

- 回滚条件：
  - Document Mode 造成 Workspace Mode 回归。
  - 打包后 app 无法正常启动或 Finder 打开异常。
- 回滚步骤：
  - 回滚 Document Mode commits 或关闭 file association 配置。
  - 保留最近稳定 Workspace Mode commit。
- 数据回滚：
  - 无 Document session 持久化，无需数据迁移。
  - `~/.mdx/state.json` 仍保持 Workspace Mode 结构。
- 配置回滚：
  - 移除 bundle file association。
- 风险：
  - 用户已手动将 MDX 设为默认 Markdown 打开应用时，回滚后需要用户自行调整 macOS 默认应用。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：本地应用无集中监控，使用 console/Tauri log。
- 业务异常：document open failed、save conflict、asset fallback、menu dispatch failed。
- 重试异常：保存失败后用户手动重试。
- 超时：不涉及远程调用。
- 关键接口指标：本地可记录 open/save 耗时用于调试。
- 告警渠道：不涉及。

### 9.2 性能与容量

- TPS/吞吐：本地交互，无服务端 TPS。
- CPU/内存/磁盘 IO/网络 IO：
  - Document Mode 只读取单文件，不扫描目录，性能应优于 Workspace Mode。
  - 多 Document windows 内存随窗口数量增加。
- 数据容量：单文件内容和图片资产。
- 缓存容量：运行时 window registry 小规模。
- 跑批耗时：不涉及。
- 是否压测：不需要压测，需手动验证大 Markdown 文件打开编辑体验。

### 9.3 可靠性与兜底

- 幂等击穿：同一路径 open-file 通过 realPath registry 聚焦已有窗口。
- 并发失效：保存前 fingerprint 检查处理外部修改。
- 冷热备：不涉及。
- 数据保护：关闭 dirty guard 和 external modified guard。
- 兜底：Document open/save 失败保留窗口和错误提示，不退回 Workspace Mode。

## 十、排期与规划

### 10.1 建议分期

- Phase 1：窗口/session 架构和 macOS 文件关联 spike，确认 cold launch open-file 行为。
- Phase 2：DocumentShell MVP，支持读取、编辑、目录、保存、关闭保护。
- Phase 3：菜单 role-aware 分发、唯一 Workspace window、打开文件夹复用。
- Phase 4：Document asset 保存、外部修改检查、跨 Workspace dirty 提示。
- Phase 5：README 更新、打包验证、回归测试。

### 10.2 Planning Handoff

`plan` 可以决定：

- 组件和文件具体命名。
- AppSession 获取方式是 window label 查询还是初始化 payload。
- Document fingerprint 的具体实现。
- Document outline 折叠 UI 细节。
- 测试文件分布和 mock 方式。
- 是否将 editor/outline 共享能力抽出到 common hook。

必须回 `spec`：

- 改变 Document Mode 不持久化会话的决策。
- 改变 Document Mode 是否纳入 CLI。
- 改变图片资产默认保存位置。
- 增加 Windows/Linux 验收。
- 增加 `.mdx` 支持。

必须回 `clarify`：

- 允许多个 Workspace Mode 主窗口。
- 直接启动恢复最近 Document Mode。
- Document Mode 增加新建/另存为/多标签。
- 引入实时文件监听或自动保存。

推荐下一步：

```text
$plan docs/loopx/design/MDX双模式文档与工作区需求设计文档.md
```

## 十一、QA

### 11.1 验收用例

| 用例 | 前置条件 | 操作 | 期望 |
|---|---|---|---|
| Finder 打开单 `.md` | MDX 未运行 | 双击/打开方式选择 MDX | 只出现 Document Mode，不出现 workspace 选择器 |
| Finder 打开多个 `.md` | MDX 可运行或未运行 | 一次打开多个文件 | 每个文件一个 Document window |
| 直接启动 | 无文件 open event | 点击 MDX app | 进入 Workspace Mode，恢复 recent workspace 或选择文件夹 |
| 已有 workspace 后打开 `.md` | Workspace window 存在 | Finder 打开 Markdown | 新开/聚焦 Document window，workspace 不变 |
| 重复打开同文件 | Document window dirty | Finder 再次打开同路径 | 聚焦已有窗口，不重新读取，不丢失 dirty |
| 保存外部修改冲突 | Document 打开后外部改文件 | Cmd+S | 提示覆盖保存/取消 |
| 关闭 dirty document | Document 有未保存修改 | 关闭窗口 | 保存/丢弃/取消 |
| Workspace 文件树打开 `.md` | Workspace Mode | 点击文件树 Markdown | 在 workspace tab 打开 |
| Document 图片粘贴 | 文档目录可写 | 粘贴图片 | 保存到同目录 `.assets/` |
| Document 菜单 | Document focused | 查看菜单 | workspace-only 项禁用或隐藏 |
| LLM Wiki 隔离 | Finder 打开 LLM Wiki raw 文件 | 打开 `.md` | 不触发 LLM Wiki 检测/ingest |

### 11.2 自动化验证建议

- 前端 Vitest：
  - App session routing。
  - Document dirty/title/close guard。
  - Outline from current markdown only。
  - Workspace Mode 不受 document session 影响。
- Rust tests：
  - `.md/.markdown` 类型判断。
  - symlink real path 固定。
  - document fingerprint conflict。
  - window registry 同路径聚焦逻辑。
  - unsupported file error。
- 集成/手动：
  - macOS Finder open。
  - 打包后 file association。
  - 多窗口菜单分发。
  - Workspace/Document 同路径 dirty 提示。

### 11.3 残余风险

- Tauri macOS open-file event 冷启动行为需要 spike，可能影响计划顺序。
- Menu role-aware enabled state 可能受 Tauri menu API 限制，必要时降级为前端收到后 no-op。
- 全局 assets fallback 链接格式可能和现有 editor image loader 有差异，需要实现前验证。
