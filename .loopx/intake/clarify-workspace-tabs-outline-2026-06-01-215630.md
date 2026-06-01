# MDX 工作区、标签页、文件夹树与文档标题目录澄清记录

## Intent And Desired Outcome

用户希望基于 `ref/domd` 参考项目，在 `/Users/hugh/project/mdx` 创建自己的桌面 Markdown 编辑器。核心目标是从 DOMD 当前单文件编辑器形态，演进为桌面优先的工作区编辑器：

- 左侧文件夹树
- 中间多标签编辑器
- 右侧当前文档标题目录
- 保留 `@do-md/react` 编辑内核作为 MVP 黑盒依赖
- 保留 CLI socket / CLI 驱动能力

用户原话包括：

- “我希望基于这个项目做一款自己的编辑器，当前最重要的是增加目录和文件夹的功能”
- “我期望是左侧是文件夹树，右侧是文档标题目录。 二者都可以折叠。”
- “桌面版优先，web端我认为可以删除掉。我不需要web端”
- “ref/domd 作为参考源码不直接改，在 /Users/hugh/project/mdx 里创建/迁移你自己的编辑器项目”

## In Scope Work

- 在 `/Users/hugh/project/mdx` 中创建/迁移项目，`ref/domd` 只作为参考，不直接修改。
- 复制 DOMD 应用层和 Tauri 壳作为起点，产品名改为 `MDX`。
- bundle identifier 使用 `com.hugh.mdx`。
- CLI 名称使用 `mdx-cli`。
- 本地配置目录使用 `~/.mdx`。
- 桌面版/Tauri 优先，移除 Web 产品形态。
- 单窗口单根文件夹工作区。
- 多标签页，标签页只对应文件。
- 左侧文件夹树：
  - 显示文件夹、`.md`、`.markdown`。
  - 不显示 `.mdx`。
  - 文件夹在前，文件在后，同类自然排序，不区分大小写。
  - 默认隐藏 dotfiles/dotfolders；`.assets` 作为工作区资产目录需要被保留，不应误删。
  - 空文件夹显示。
  - 递归扫描，跳过 `node_modules`、`.git`、`dist`、`build`、`.next`、`target`。
  - 目录规模超过阈值时提示并停止深层扫描或要求缩小工作区。
  - 支持选择/切换根文件夹、新建文件夹、新建 Markdown 文件、重命名文件/文件夹、删除文件/文件夹、手动刷新、拖拽移动、名称搜索。
  - 删除移动到 macOS 废纸篓，失败时提示，不做永久删除。
  - 搜索仅搜索文件/文件夹名称，过滤左侧树并高亮匹配，不做全文搜索。
  - 外部磁盘变化 MVP 不实时监听，提供手动刷新。
- 新建 Markdown 文件：
  - 创建为 `Untitled.md`。
  - 如存在则使用 `Untitled1.md`、`Untitled2.md` 模式。
  - 第一次保存时要求用户输入正式文件名。
  - 重命名冲突时阻止并提示，不自动追加数字。
- 标签页：
  - 点击文件树文件时，如果已打开则切换 tab，否则新开 tab。
  - dirty tab 可直接切换。
  - 关闭 dirty tab 时弹确认：保存、放弃、取消。
  - 切换根文件夹/关闭窗口时，如存在 dirty tabs，统一处理未保存文件。
  - tab 状态按工作区分别记忆。
- 右侧标题目录：
  - 从当前 tab Markdown 内容解析 `#` 到 `######`。
  - 无层级限制。
  - 点击标题滚动到对应标题。
  - 编辑后实时更新目录。
  - 同名标题按出现顺序匹配。
  - 不要求 URL hash/锚点。
- 布局：
  - 左侧文件夹树默认展开，宽度可拖拽调整，可折叠。
  - 中间编辑区。
  - 右侧标题目录默认展开，宽度可拖拽调整，可折叠。
  - 不需要移动端适配。
- 应用状态：
  - 保存到 `~/.mdx/state.json`。
  - 保存最近根文件夹、每工作区 tabs、当前活动 tab、左右侧栏折叠状态和宽度、最近窗口尺寸。
  - 不写进用户工作区，避免污染仓库。
- 图片：
  - 优先保存到当前根文件夹下 `.assets/`。
  - Markdown 中写相对路径。
  - 没有工作区或无法写入工作区时退回 `~/.mdx/assets` 并写绝对路径。
- CLI：
  - 保留 CLI socket / CLI 能力，改名为 `mdx-cli`。
  - 支持工作区和 tabs。
  - 支持创建/重命名文件树；删除先不做。

## Non Goals

- 不修改 `ref/domd`。
- 不发布 Web 产品。
- 不保留 Web landing 页面、Web 保存逻辑、GitHub URL 打开、GitHub README 加载。
- 不做 Quick Look 预览扩展。
- 不做自动更新和发布签名/公证脚本的 MVP 迁移。
- 不做全文搜索。
- 不做实时文件系统监听。
- 不做复制粘贴文件/文件夹。
- 不做批量操作。
- 不重写 `@do-md/react` 编辑核心。
- 不支持移动端。
- CLI 删除文件/文件夹不做 MVP。

## Decision Boundaries

- 允许 `plan` 决定具体 React 组件拆分、CSS class、局部 helper 命名、文件分层细节。
- 必须回到 `spec` 的事项：
  - 替换 `@do-md/react`。
  - 引入实时文件监听。
  - 引入全文搜索或索引。
  - 恢复 Quick Look。
  - 恢复 Web 产品形态。
  - 改变 CLI 协议的产品能力边界。
- 必须回到 `clarify` 的事项：
  - 改变工作区模型，如多根工作区。
  - 改变文件类型范围。
  - 改变删除语义为永久删除。
  - 改变 tab 草稿模型为未落盘草稿。

## Constraints

- `/Users/hugh/project/mdx` 当前为空目录。
- `ref/domd` 当前在 `/Users/hugh/project/ref/domd`，git 状态干净。
- `@do-md/react` 在 DOMD 仓库中映射到 `.packages/@do-md/dist/index.js`，不是源码。
- `@do-md/react`/`@do-md/dist` 采用 PolyForm Noncommercial 许可；商业使用需额外授权。
- MVP 接受继续使用黑盒内核，但设计应封装 adapter，降低未来替换内核成本。
- 只面向 macOS/Tauri 桌面优先。

## Success Criteria

- MDX 启动后自动恢复最近工作区；无工作区时要求用户选择根文件夹。
- 左侧文件夹树能展示根目录下文件夹和 `.md/.markdown` 文件，支持搜索、刷新、新建、重命名、移到废纸篓、拖拽移动。
- 点击文件能复用或打开 tab；同一文件不会打开多个 tab。
- 多 tab 能正确保存 dirty 状态，关闭和切换工作区时有未保存保护。
- 新建 `Untitled` 文件首次保存时要求正式命名。
- 右侧标题目录能实时反映当前 tab 标题并点击滚动。
- CLI 可列出窗口/工作区/tabs，可读取内容/selection，可插入文本、保存、focus、close，可创建/重命名文件树。
- 图片粘贴/拖入保存到工作区 `.assets/` 并写相对路径。
- Web 产品相关路径和逻辑不作为 MVP 发布面。

## Assumptions Challenged

- “目录”不是仅文档标题目录，而是左侧文件夹树和右侧文档标题目录二者。
- “mdx”不是 `.mdx` 文件格式要求，而是项目目录 `/Users/hugh/project/mdx`。
- Web 不需要保留，尽管 DOMD 原项目同时支持 Web 和 Tauri。
- `@do-md/react` 是黑盒；用户接受 MVP 继续使用。
- Quick Look 不是主编辑功能，用户确认不做 MVP。

## Key Decisions And Rejected Alternatives

- 采用单窗口单根文件夹，拒绝多根工作区。
- 支持多标签页，拒绝单文件窗口模型。
- 标签页只对应文件，拒绝未落盘草稿 tab。
- 新建文件先生成 `Untitled.md` 系列，第一次保存要求命名；拒绝新建时立即强制命名。
- 外部变化手动刷新，拒绝 MVP 实时监听。
- 搜索只搜名称，拒绝 MVP 全文搜索。
- 删除移到废纸篓，拒绝永久删除。
- 图片优先工作区 `.assets/`，拒绝默认全局资产目录。
- 继续使用 `@do-md/react`，拒绝立即重写或替换编辑核心。

## Brownfield Evidence Vs Inference

### Evidence

- DOMD 是 Next.js + Tauri 项目，`package.json` scripts 包括 `dev`、`build`、`start`、`lint`。
- `next.config.ts` 使用 `output: "export"`。
- `tsconfig.json` 将 `@do-md/react` 指向 `.packages/@do-md/dist/index.js`。
- `types/do-md-react.d.ts` 明确声明 `@do-md/react` 是 closed-source kernel。
- README 说明核心渲染引擎 `@do-md/dist` 仅以构建产物分发，并采用 PolyForm Noncommercial 许可。
- DOMD 当前编辑入口在 `features/editor/components/editor-app.tsx` 和 `features/editor/components/editor.tsx`。
- Tauri commands 和窗口状态在 `src-tauri/src/lib.rs`。
- CLI socket server 在 `src-tauri/src/cli_server.rs`，CLI binary 在 `src-tauri/src/bin/domd_cli.rs`。
- Quick Look 扩展位于 `src-tauri/preview-extension`，用户确认不做 MVP。

### Inference

- 工作区、tabs、文件树、标题目录都属于应用层能力，MVP 不需要重写编辑核心。
- 现有 DOMD 的单窗口/单文件状态模型需要重构，而不是简单加一个侧栏。
- 保留 CLI 意味着 Rust 和前端都需要新的 workspace/tab 状态协议。

## Residual Risks

- `@do-md/react` 黑盒 DOM 结构变化可能影响标题目录滚动定位。
- `@do-md/react` 的 store API 手写类型可能与实际行为不一致。
- 拖拽移动文件夹时更新已打开 tab 路径需要谨慎处理 dirty 状态。
- macOS 废纸篓能力可能需要额外 crate 或系统 API。
- 目录扫描大仓库性能需要阈值和用户提示兜底。
- Web 逻辑删除后，Next/Tauri 静态导出仍需保留最小可运行路径。

## Conversation Summary

用户希望基于 DOMD 做自己的编辑器，优先增加文件夹树和文档标题目录。经过澄清，项目应在 `/Users/hugh/project/mdx` 新建，DOMD 仅作参考。产品只做 macOS/Tauri 桌面版，Web 可删除。MVP 需要左侧工作区文件夹树、中间多标签编辑、右侧标题目录；保留 `@do-md/react` 黑盒编辑内核和 CLI socket 能力；不做 Quick Look、自动更新、Web、全文搜索、实时监听。

## Source Requirements And External References

- 参考项目：`/Users/hugh/project/ref/domd`
- 新项目目录：`/Users/hugh/project/mdx`
- DOMD GitHub：`https://github.com/do-md/domd`
- 用户指定技能：`$clarify`

## Next Handoff Recommendation

Handoff: `needs_spec`

原因：需求涉及产品行为、工作区状态模型、tab 生命周期、文件系统 API、Tauri command 设计、CLI 协议、数据持久化、安全/权限、迁移边界，必须先写设计文档，再进入实现计划。
