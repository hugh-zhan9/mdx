# 产品成熟度第一阶段需求澄清上下文

## Intent And Desired Outcome

用户希望把 MDX 从“可打包桌面 MVP”推进到更适合真实用户长期使用的第一阶段成熟版本。本轮不直接实现，先明确需求边界并进入设计文档。

核心目标是一次性交付四块能力：

- 未保存正文恢复。
- 实时文件监听与外部变更冲突处理。
- 工作区全文搜索。
- UI 精修。

## Source User Wording

- “UI 精修 也纳入吧，LLM Wiki onboarding，发布/自动更新链路 可以后面再考虑”
- “一次做完吧”
- “需要支持 raw，因为我默认都是放在 raw 里”
- “可以，但是这些最好是可以配置”
- “加上吧” 指草稿恢复 diff viewer。
- “确认” 多次确认恢复、监听、搜索、UI、文档、打包安装等策略。

## In Scope

1. 未保存正文恢复
   - 覆盖 Workspace Mode 和 Document Mode。
   - dirty 后 1-2 秒 debounce 自动写草稿。
   - tab 切换、关闭窗口、应用退出前立即 flush 草稿。
   - 保存原文件成功后删除对应草稿。
   - 草稿只保存 Markdown 正文和元数据，不保存 selection/scroll。
   - 草稿单独存放到 `~/.mdx/drafts/`，按真实路径 hash 命名。
   - 草稿元数据包括原文件路径、磁盘文件指纹、草稿更新时间、正文内容。
   - 草稿允许本机明文保存，但文件权限尽量收紧到当前用户可读写。
   - 默认保留 30 天；保存成功、用户明确丢弃、过期清理时删除。
   - 启动/打开文件时如发现可恢复草稿，提示用户选择，不静默覆盖。
   - Workspace 启动时多个草稿集中提醒数量；具体文件打开时显示文件级恢复提示。
   - Document Mode 只提示当前文档。
   - 不自动打开所有草稿。
   - 文件不存在的孤立草稿仍提示，动作包括另存为、恢复到原路径、删除草稿、稍后处理。
   - 原路径父目录不存在时禁用“恢复到原路径”。
   - 同一真实路径的草稿在 Workspace/Document 之间共享，避免双窗口各自恢复。

2. Diff viewer
   - 草稿恢复需要 diff viewer。
   - 外部修改冲突也复用 diff viewer。
   - 第一版做只读对比和明确动作，不做逐块合并器。
   - 对比草稿内容 vs 当前磁盘内容，或当前编辑器 dirty 内容 vs 最新磁盘内容。
   - 支持 inline 或左右分栏，重点是可读、不溢出。
   - 高亮新增、删除、修改行。
   - 草稿恢复动作：恢复草稿、保留磁盘版本并删除草稿、稍后处理。
   - 外部冲突动作：保留我的编辑、重新加载磁盘版本、另存为/复制当前内容、稍后处理。

3. 文件监听和外部变更处理
   - 覆盖 Workspace Mode 和 Document Mode。
   - Workspace Mode 监听当前 workspace root 下 `.md` / `.markdown` 文件变化、删除、重命名/新增，并刷新文件树。
   - Document Mode 只监听当前打开的单个文档路径及同级 `.assets/` 相关变化，不监听整个父目录。
   - 文件监听默认开启，设置里可关闭。
   - 允许新增 Rust 文件监听依赖，优先使用 `notify` crate。
   - 当前 tab 无 dirty 且磁盘内容外部修改时，自动重新读取并刷新编辑器。
   - 当前 tab 有 dirty 且磁盘内容外部修改时，不自动覆盖，显示冲突提示并可查看 diff。
   - 文件删除且 tab 无 dirty：保留 tab，显示“文件已删除”，提供关闭 tab 或另存为。
   - 文件删除且 tab 有 dirty：保留编辑内容，高优先级提示，提供另存为、恢复到原路径、关闭不保存。
   - 文件重命名/移动：能可靠匹配时更新 tab 路径；匹配不了按旧路径删除 + 新路径新增，不猜测。
   - 应用自己保存当前文件导致的文件事件，不弹外部变更提示，只更新指纹和 dirty 状态。
   - LLM Wiki 后台写入 `wiki/`、`index.md`、`log.md`、`llm-wiki-progress.md` 时刷新文件树/相关打开 tab，但不当作用户外部冲突。
   - 如果这些被写入文件正在 dirty 编辑中，仍按冲突处理。
   - 使用文件指纹/写入事务标记区分应用自己写入和外部事件。
   - 文件监听批量事件需要 debounce/coalesce，避免一批写入触发大量刷新。

4. 工作区全文搜索
   - 入口放左侧文件树区域。
   - 第一版按需搜索，不做实时索引。
   - 用户输入关键词后由后端扫描当前工作区，防抖并取消上一轮搜索。
   - 搜索当前 Workspace root 下 `.md` / `.markdown` 文件。
   - 默认包含 `raw/`，因为用户默认资料都在 raw。
   - 不搜索 PDF、图片、二进制、`.mdx`。
   - 不跨多个工作区。
   - 不使用 LLM Wiki `skipPaths`，只使用通用搜索排除规则。
   - 通用排除包括隐藏目录、`.git`、`node_modules`、二进制、超大文件阈值。
   - 结果展示文件路径、匹配行和少量上下文。
   - 点击结果打开文件并滚动到匹配行，不强制精确选中匹配文本。
   - 已打开 dirty tab 的未保存编辑内容参与搜索，并在结果中标记“未保存”。
   - 未打开但有恢复草稿的文件不纳入搜索，除非用户恢复草稿。
   - 默认普通文本子串匹配，不做正则、不做模糊、不做语义。
   - 默认大小写不敏感，提供“区分大小写”开关。
   - 支持中文、英文、符号直接子串匹配。
   - 搜索上限可配置：
     - 单文件最大读取默认 2 MB。
     - 单次最大结果默认 200 条。
     - 单文件最大匹配默认 20 条。
   - 输入 debounce 默认 300ms，作为内部参数不暴露设置。
   - 设置里新增“搜索”配置组，暴露前三个上限。
   - 配置存 `~/.mdx/state.json` 的 preferences。
   - 超过上限时在搜索结果区显示跳过/截断提示。

5. UI 精修
   - 保留现有三栏布局和功能结构，不做整套 redesign。
   - 只做成熟产品感精修：图标、按钮、状态层级、错误信息展示、空状态、设置弹窗、LLM Wiki 面板可读性、滚动区域、窄宽适配。
   - 允许新增 `lucide-react`。
   - 主要工具按钮不再使用字符符号，改用图标组件或统一图标映射。
   - 保留现有 light/dark 和 daisyUI 基础。
   - 调整按钮、边框、状态色、提示层级一致性。
   - 不引入品牌色大改，不重写 Tailwind theme，不做营销式视觉。
   - 保证窄宽和高信息密度下可读。
   - 状态、错误、冲突提示不遮挡主要进度和编辑内容。
   - 设置弹窗、LLM Wiki 面板、文件树空状态、搜索结果列表在窄宽下不溢出。
   - 验收时需要桌面宽屏和窄窗口截图。

6. 文档
   - 更新 README.zh-CN.md 和 README.md。
   - 增加未保存草稿恢复说明。
   - 说明草稿明文保存在 `~/.mdx/drafts/`，保存、丢弃、过期会清理。
   - 增加文件监听、外部变更冲突处理、工作区全文搜索说明。
   - 更新“范围”里原本“不提供全文搜索和实时文件系统监听”的描述。

7. 验收与发布
   - 最终验收必须包含：
     - `npm test -- --run`
     - `npm run lint`
     - `npm run build`
     - `cd src-tauri && cargo test --lib`
     - `npx tauri build`
     - 覆盖安装 `/Applications/MDX.app`
     - 校验 installed app checksum 等于 build app checksum

## Non-Goals

- LLM Wiki onboarding 第一阶段不做。
- 发布/自动更新链路第一阶段不做。
- 不做自动更新、签名公证、崩溃上报、外部发布闭环。
- 不做工作区多根。
- 不做全文搜索实时索引。
- 不做正则搜索、模糊搜索、语义搜索。
- 不搜索 PDF、图片、二进制、`.mdx`。
- 不做逐块合并器或可编辑三方 merge。
- 不保存草稿 selection/scroll 等瞬时编辑器状态。
- 不做整套视觉 redesign。

## Decision Boundaries

- 实现内部可按依赖顺序推进，但第一阶段最终一次性交付四块能力。
- `state.json` 继续承担偏好、窗口和 tab 状态；草稿内容不塞进 `state.json`。
- 草稿文件允许明文，但必须本地、权限收紧、文档说明。
- 文件监听由 Rust 后端统一实现，前端消费 Tauri event。
- 搜索由后端扫描实现，支持取消和限制，不引入实时索引。
- `lucide-react` 可作为新增前端依赖。
- `notify` 可作为新增 Rust 文件监听依赖。

## Brownfield Evidence

- README.zh-CN.md 写明当前范围不包含全文搜索和实时文件系统监听。
- README.zh-CN.md 写明状态保存到 `~/.mdx/state.json`。
- `src-tauri/src/state_store.rs` 中 `AppPreferences` 当前只有 `file_tree_exclude_dirs`。
- `src-tauri/src/state_store.rs` 中 `PersistedWorkspaceTab` 只有 `tab_id`、`path`、`title`、`dirty`、`needs_rename_on_first_save`，没有 Markdown 正文。
- `features/workspace/hooks/use-workspace-bootstrap.ts` 的 `toPersistedWorkspace` 仅持久化 tab 元数据，不持久化 `markdown`。
- `features/workspace/lib/types.ts` 中 `WorkspaceTab` 有可选 `markdown`，但 `PersistedWorkspaceTab` 没有。
- `features/document/lib/types.ts` 中 Document Mode 有 `markdown`、`savedMarkdown`、`fingerprint`、`dirty`。
- `common/components/ui-controls.tsx` 的 `IconButton` 接受 `ReactNode` icon，可承接 lucide 图标。
- 当前按钮存在字符图标：`☰`、`↻`、`×`、`📁`、`＋`、`✎`、`⌫`、`…`。
- 当前已有当前文档 visible text search，但没有 workspace 级全文搜索。
- 当前已有 `update_workspace_dirty_paths` 和 `is_workspace_path_dirty`，Document Mode 可看到 workspace dirty 路径。
- 当前没有 `notify` 文件监听依赖。
- 当前没有 `lucide-react` 依赖。

## Assumptions Challenged

- “全文搜索默认排除 raw”：被用户否定。用户默认资料都放 raw，因此全文搜索默认必须包含 raw 下 Markdown。
- “第一版不做 diff”：被用户否定。第一版需要 diff viewer。
- “拆四个里程碑”：被用户否定。第一阶段希望一次做完，统一验收。
- “只覆盖 Workspace Mode 草稿”：被用户否定/已确认覆盖 Document Mode。

## Success Criteria

- 崩溃、强退、重启后，Workspace 和 Document 中未保存 Markdown 可被发现并提示恢复。
- 恢复不会静默覆盖磁盘文件。
- 外部修改、删除、重命名已打开文件时不会丢失用户 dirty 内容。
- 工作区全文搜索可搜索 raw 下 Markdown，响应期间 UI 不冻结。
- 搜索上限可配置，超过限制时给出跳过/截断提示。
- 主要工具按钮使用统一图标，状态/错误/冲突提示层级清楚。
- 设置、搜索结果、LLM Wiki 面板、文件树空状态在窄宽不溢出。
- README 中新增能力和草稿明文存储说明准确。
- 所有指定命令验证通过，生成并安装最新 `/Applications/MDX.app`。

## Performance Criteria

- 10k 个 Markdown 文件的文件树/搜索不会冻结 UI。
- 搜索运行期间输入仍可响应，上一轮搜索可取消。
- 搜索结果首屏尽快返回；完整扫描可继续补齐或显示进度。
- 文件监听批量事件做 debounce/coalesce。
- 单个搜索请求超过合理时间可取消，不阻塞后续请求。

## Residual Risks

- Diff viewer 和外部冲突状态机会增加 UI 和状态复杂度。
- Document Mode 与 Workspace Mode 同一路径共享草稿/dirty 所有权，需要避免双窗口双写。
- 文件监听在 macOS/iCloud 路径下可能收到批量、乱序或延迟事件，需要 coalesce 和指纹二次确认。
- 明文草稿有隐私风险，需要权限和文档说明，但第一版不做加密。
- 全文搜索包含 raw 可能遇到大目录性能压力，需要严格限制、取消和跳过策略。

## Handoff Recommendation

`needs_spec`

原因：需求涉及产品行为、状态机、持久化数据模型、Tauri 命令/事件、文件监听、冲突处理、搜索配置、UI 交互和跨模式兼容，必须先固定设计再写计划。

下一步写：

`docs/loopx/design/产品成熟度第一阶段需求设计文档.md`
