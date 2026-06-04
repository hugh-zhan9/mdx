# MDX Document Mode / Workspace Mode 澄清上下文包

## Intent And Desired Outcome

用户计划将 MDX 调整为两种明确模式：

- Document Mode：单 Markdown 文档模式。
- Workspace Mode：工作区模式。

核心目标是让单文件打开保持轻量：只显示 Markdown 编辑器和目录，不出现文件树、LLM Wiki、后台扫描等复杂工作区能力。直接启动 MDX 或在 MDX 内打开文件夹时进入 Workspace Mode，保留文件树、标签页、目录和可选 LLM Wiki 知识库能力。

用户重要原话：

- “我的计划是，当用户打开的是一个 单一的 markdown 文档，那就不需要llm-wiki，文件树 这些复杂的功能，简单的markdown 编辑器+目录就好。”
- “但是当用户是直接启动的 mdx 应用，或者是在 mdx应用打开的文件夹，就需要。”
- “我计划将 mdx 调整为1. Document Mode：单 Markdown 文档模式 和 2. Workspace Mode：工作区模式 的两种模式”

## Brownfield Evidence

- 当前 `README.zh-CN.md` 将 MDX 定位为“本地桌面 Markdown 工作区编辑器”，核心功能是单根本地工作区、文件树、多标签、标题目录、CLI。
- 当前 `WorkspaceApp` 只渲染 `WorkspaceShell` 或 workspace empty state，没有 Document Mode 顶层分支。
- 当前 `useWorkspaceBootstrap` 启动路径：
  - 直接启动读取 `~/.mdx/state.json`。
  - 有 `recentWorkspaceRoot` 则恢复 workspace。
  - 否则调用 `chooseWorkspaceRoot()` 选择文件夹。
  - `chooseWorkspaceRoot()` 只打开文件夹，不支持单文件选择。
- 当前 `WorkspaceState` 数据模型固定为 `rootPath + fileTree + tabs + panel + search`。
- 当前 `WorkspaceShell` 总是挂载 `useLlmWikiWorkspace(workspace.rootPath)`，并在右侧提供 `目录 / LLM Wiki` tab。
- 当前 Tauri 配置 `src-tauri/tauri.conf.json` 未声明 `.md/.markdown` 文件关联。
- 当前 Rust/Tauri 没有单文件 Document Mode 的 open-file event 处理路径。
- 当前 CLI 模型围绕 Workspace Mode，`CliWorkspaceSnapshot` 包含 `root_path`、active tab 和 tabs。

## Decisions

1. 单个 Markdown 文件通过 Finder / 系统打开时，即使位于已初始化 LLM Wiki 工作区，也进入 Document Mode。入口意图优先于文件所在位置。
2. Direct launch 不恢复 Document Mode。直接启动 MDX 进入 Workspace Mode：优先恢复最近 workspace；没有则让用户打开文件夹。
3. Document Mode 第一版不支持多标签。每个单文件打开就是一个轻量编辑窗口。
4. Document Mode 第一版只支持打开已有 Markdown 文件并原路径保存；不做新建、另存为、重命名。
5. Document Mode 保留目录，默认显示，允许当前窗口内折叠。
6. Document Mode 只接受 `.md/.markdown`；不接受 `.mdx`、PDF、Office、txt 等其他类型。
7. 已有 Workspace Mode 主窗口时，从 Finder 打开单个 Markdown 文件应打开新的 Document Mode 窗口，不替换 workspace，不改变 workspace 状态，不触发文件树或 LLM Wiki。
8. Document Mode 第一版不纳入 CLI 自动化；CLI 继续服务 Workspace Mode。
9. Document Mode 菜单只保留/启用保存、关闭窗口、打开文件夹；禁用或隐藏新建 Markdown、新建文件夹、重命名、移到废纸篓、刷新、关闭标签页。
10. Document Mode 第一版只复用全局窗口尺寸；不持久化单文档会话、目录折叠或光标位置。
11. 同一路径重复打开时，聚焦已有 Document Mode 窗口，不重新读取文件，不丢弃未保存修改。
12. Document Mode 第一版沿用当前编辑器体验，不新增显式双栏预览。
13. 需要把 MDX 注册为 macOS 可打开 `.md/.markdown` 的应用，但不强行设置为默认应用。
14. Finder 一次打开多个 Markdown 文件时，每个文件开一个独立 Document Mode 窗口；已有窗口则聚焦。
15. 被单文件打开启动时，不同时恢复 Workspace Mode 主窗口，不弹选择文件夹。
16. Document Mode 关闭窗口时如有未保存修改，和 Workspace tab 关闭一致：保存 / 丢弃 / 取消。
17. Document Mode 标题栏显示 `文件名 - MDX`；有未保存修改时显示 `● 文件名 - MDX`。
18. Document Mode 中点击“打开文件夹...”应打开或聚焦唯一 Workspace Mode 主窗口，不关闭当前 Document 窗口。
19. Document Mode 第一版不解析或跳转 `[[wikilink]]`；双链留给 Workspace Mode。
20. Document Mode 允许打开 symlink Markdown。打开时解析到真实文件路径，之后读取和保存固定操作该真实路径，避免保存时重新跟随 symlink。
21. Document Mode 允许打开 workspace 外任意位置的 Markdown 文件。
22. Document Mode 图片资产优先保存到当前 Markdown 文件同目录下 `.assets/`；如果目录不可写，再退到 `~/.mdx/assets`。
23. Document Mode 第一版不做实时文件监听，但保存前检查磁盘内容是否从打开/上次保存后变化；变化时弹出覆盖保存 / 取消，不做 merge。
24. Document Mode 第一版不做自动保存。
25. Workspace Mode 文件树中打开 Markdown 文件仍在 workspace tab 内打开，不进入 Document Mode。
26. Workspace Mode 第一版只允许一个主窗口。直接启动时若已有主窗口则聚焦。
27. Document Mode 点击“打开文件夹...”时复用唯一 Workspace Mode 主窗口：聚焦它并执行打开文件夹流程；没有则新建。
28. Document Mode 使用同一个全局窗口尺寸偏好，默认可比 Workspace Mode 窄，例如 900x820；不区分保存两套窗口尺寸。
29. Document Mode 的目录宽度和折叠状态不与 Workspace Mode panel state 共用；第一版使用固定默认宽度并只在当前窗口临时保存。
30. Document Mode 继续使用全局主题；文件树排除目录等 workspace 设置不出现在 Document Mode。
31. 第一版只按 macOS 验收。
32. 单文件打开失败时打开 Document Mode 错误窗口，显示失败原因和文件路径，不自动退回 Workspace Mode。
33. Document Mode 不支持 `.mdx`。
34. Document Mode 目录只从当前 Markdown 内容实时解析，不读取旁边文件。
35. Document Mode 顶部只显示文件名，完整路径放到 tooltip 或弱状态文本。
36. 需要更新 README / 产品文档，将 MDX 定位调整为双模式本地 Markdown 应用。
37. 直接启动 MDX 后的空状态第一版不提供“打开 Markdown 文件...”入口；应用内入口仍围绕 Workspace Mode，只提供“打开文件夹”。
38. 如果同一路径已在 Workspace tab 中打开且有未保存修改，用户又从 Finder 打开同文件，仍开/聚焦独立 Document Mode 窗口，但提示该文件已在工作区中有未保存版本。第一版不做跨窗口内容同步。
39. Workspace Mode 普通文件夹仍保留 LLM Wiki tab，作为初始化/配置入口；Document Mode 完全隐藏 LLM Wiki。
40. Workspace Mode 默认继续显示文件树。

## In Scope

- 顶层 app session 区分 Document Mode 和 Workspace Mode。
- macOS `.md/.markdown` 文件关联。
- macOS open-file event 处理。
- Document Mode 单文档窗口。
- 唯一 Workspace Mode 主窗口管理。
- Document Mode 保存、关闭保护、标题栏、目录、图片资产策略、外部修改检查。
- Workspace Mode 继续保留现有工作区、文件树、标签页、目录、LLM Wiki、CLI 行为。
- README / 产品文档定位更新。

## Non-Goals

- 不支持 Document Mode 多标签。
- 不做 Document Mode 新建、另存为、重命名。
- 不做 Document Mode CLI 自动化。
- 不做 Document Mode wikilink 跳转。
- 不做实时文件监听。
- 不做自动保存。
- 不支持 `.mdx`。
- 不验收 Windows/Linux 文件关联。
- 不把 Workspace Mode 文件树打开 `.md` 改为 Document Mode。

## Constraints

- 当前项目是 Tauri 2 + Next/React 桌面应用。
- 当前 MVP 主要支持 macOS。
- 现有 CLI 协议围绕 Workspace Mode，不应为 Document Mode 扩大协议范围。
- 现有 Workspace Mode 已有较多本地文件安全边界，Document Mode 的单文件读写需要独立设计，不复用 workspace root guard。
- File association 不应强行抢默认应用，只声明可打开类型。

## Success Criteria

- 从 Finder 打开 `.md/.markdown`：只出现 Document Mode 窗口，不出现文件树和 LLM Wiki。
- 直接启动 MDX：恢复或创建唯一 Workspace Mode 主窗口，不恢复最近 Document Mode。
- Workspace Mode 中打开文件夹：保留现有工作区行为和 LLM Wiki 能力。
- 已有 Workspace Mode 时，打开单文件不影响 workspace。
- 多个 Markdown 文件从 Finder 打开：每个文件独立 Document Mode 窗口。
- Document Mode 保存、关闭未保存保护、标题栏脏状态、目录解析、图片资产、外部修改检查符合上述决策。
- README 明确描述双模式定位。

## Assumptions Challenged

- 不能把 Document Mode 简化为“隐藏文件树的 Workspace Mode”，因为 WorkspaceState 依赖 rootPath、fileTree、tabs、LLM Wiki hook，会导致单文件入口仍承担工作区复杂度。
- 不能让 direct launch 恢复 Document Mode，否则“单文件入口”会污染主应用启动心智。
- 不能把 Document Mode 纳入 CLI 第一版，否则需要重做 CLI snapshot / tab model。
- 不能默认把 Document Mode 图片保存到 `~/.mdx/assets`，否则 Markdown 文档便携性差；全局 assets 只作为 fallback。

## Brownfield Inference

- 需要新增 `DocumentShell` 或类似组件，与 `WorkspaceShell` 并列。
- 需要新增顶层 `AppSession` / window role 状态，区分 `document` 和 `workspace`。
- 需要 Rust 侧管理窗口 role 与 open-file events，确保单文件打开不会触发 workspace bootstrap。
- 需要给编辑器和保存逻辑抽出可复用能力，避免复制 Workspace Mode 的 editor/save 代码。

## Residual Risks

- Tauri 2 macOS open-file event 与 initial launch 参数处理需要验证，尤其 app 冷启动时 open-file event 和默认窗口创建顺序。
- 多窗口下菜单启用状态需要按 focused window role 切换。
- 同一路径同时存在 Workspace tab 和 Document window 时，跨窗口未保存提示只能降低风险，不能保证内容同步。
- symlink 真实路径固定保存需要清楚记录 inode/mtime/hash，否则外部修改检查可能有遗漏。
- 图片资产 fallback 到 `~/.mdx/assets` 后的相对/绝对链接策略需要在 spec 中固定。

## Source Requirements

- 用户本轮 `$clarify` 对话。
- 现有 README.zh-CN.md。
- 现有 `WorkspaceApp`、`WorkspaceShell`、`useWorkspaceBootstrap`、`WorkspaceState`、`tauri.conf.json`。

## Handoff Recommendation

`needs_spec`

原因：该需求涉及产品模式、窗口生命周期、macOS 文件关联、Tauri open-file event、顶层状态模型、菜单状态、文件保存安全、图片资产策略、外部修改检查、跨窗口冲突提示和文档更新，属于跨模块架构调整。应先写正式设计文档，再进入计划拆分。
