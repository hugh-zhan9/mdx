# P-007 macOS 真机人工资格 checklist

Author(s): Codex
Last updated: 2026-08-14
Slice: `P-007` 建立切换前资格门槛与发布证据
Anchors: `AC-002`, `AC-007`, `AC-012`, `AC-013`, `AC-014`; `D-001`, `D-004`, `D-007`, `D-015`; `TC-001`, `TC-011`, `TC-013`
Design authority: `docs/loopx/design/2026-08-12-milkdown-editor-migration/需求设计文档.md`
Evidence baseline commit: `909d65c`

本文件是人在真实 macOS 硬件上逐条执行的清单，用于在 `P-008` 切换 Workspace/Document 生产入口之前取得 `TC-013` 要求的真机证据。它不替代自动化测试，也不替代 `D-015` 的性能 harness：本清单只裁决自动化无法裁决的部分（真实 IME、真实 VoiceOver、真实屏幕像素）。

---

## 一、已知缺口：新编辑表面没有任何 IME composition 处理

这是本次迁移中最可能在真机上失败、而在 CI 中永远为绿的一项。它排在第一节，其测试项也排在全部测试项之前。

### 1.1 查找条一侧的 composition 守卫已随迁移保留

`P-008` 切换入口后 `EditorPane` 已删除，但查找条与它的 IME 守卫被保留并挂到了新表面上，因此下列守卫在当前产品中仍然成立（`Enter` 守卫现在位于 `markdown-editor-surface.tsx` 的 `handleKeyDownCapture`）：

- `features/editor/components/editor-find-bar.tsx:60-66` — `handleFindChange` 在 `isComposingChange(event)` 为真时直接 `return`，不把中间态写进查找 query。
- `features/editor/components/editor-find-bar.tsx:68-72` 与 `:118` — `handleFindCompositionEnd` 绑定在 `onCompositionEnd`，只有 composition 提交后才调用 `onQueryChange(event.currentTarget.value)`。
- `features/editor/components/editor-find-bar.tsx:74-86` 与 `:176` — 替换输入框走完全相同的一对处理。
- `features/editor/components/editor-find-bar.tsx:201-205` — `isComposingChange` 读取 `event.nativeEvent.isComposing`，这是判定的唯一依据。
- `features/editor/components/markdown-editor-surface.tsx` 的 `handleKeyDownCapture` — 查找条打开时的 `Enter` 拦截带 `event.nativeEvent.isComposing` 守卫；没有它，用拼音选词时按下的 `Enter`（提交候选）会被编辑器吃掉并当成“跳到下一处匹配”。

去掉这些守卫时的坏行为是明确的：查找框会用未提交的拼音字母（`nihao`）而不是提交后的汉字（`你好`）去搜索，且候选提交用的 `Enter` 不会落到输入法上。这一层是本次迁移**保留**下来的；1.3 指出的三处 NodeView 才是**没有**对应守卫的地方。

### 1.2 新 `packages/mdx-editor` 完全没有对应处理

对 `packages/mdx-editor/**` 全量搜索 `composition` / `compositionstart` / `compositionend` / `composing` / `isComposing`，只有 6 处命中，没有一处是 IME 处理：

| 命中 | 实际内容 |
|---|---|
| `packages/mdx-editor/plugins/editor-input-rules.test.ts:150` | legacy plugin 测试里伪造的 ProseMirror view mock 字段 `composing: false` |
| `packages/mdx-editor/source/source-host.ts:228` | 注释，描述“一次只报净效果的 composition” |
| `packages/mdx-editor/syntax/milkdown/index.ts:45` | 注释，指 plugin 组合 |
| `packages/mdx-editor/syntax/milkdown/composition.test.ts:159` | `describe` 标题，指 plugin 组合 |
| `packages/mdx-editor/syntax/milkdown/mermaid/renderer.ts:26` | 注释，“merely composing the syntax layer” |
| `packages/mdx-editor/syntax/milkdown/wikilink/index.ts:36` | 注释，指 plugin 注册顺序 |

即：新编辑表面没有任何 `compositionstart` / `compositionend` 监听、没有 `isComposing` 守卫、没有 `view.composing` 检查。`packages/mdx-editor/milkdown/base-plugins.ts:16` 的插件集合是 `[commonmark, gfm, history, listener, clipboard]`，其中没有任何 composition 相关插件——ProseMirror 自身的 composition 处理是唯一依赖。

> **一处必须说清楚的例外，避免把缺口说得比实际更大。** `gfm` preset 里确实带了一个
> IME 相关插件：`node_modules/@milkdown/preset-gfm/src/plugin/auto-insert-span-plugin.ts`
> 用 `prosemirror-safari-ime-span@1.0.2` 修 Safari 在 `td`/`th` 里 composing 的已知
> bug，并经 `src/composed/plugins.ts:4,13` 进入 `gfm` 数组，因此 `createBaseMilkdownPlugins()`
> 是带着它的。也就是说：**表格单元格里的 Safari IME 有上游修复，ProseMirror 自身的
> composition 处理也在**；缺的是 MDX 自己那一层——legacy 查找条/`Enter` 守卫没有对应实现，
> 且 1.3 的三处 NodeView 在 composition 期间无条件写回 `<input>.value`。真机验证的重点
> 因此是 1.3 那三类节点与查找/快捷键路径，而不是普通段落。

### 1.3 三处在 composition 期间无守卫写回 `input.value` 的 NodeView

这三处不是“缺一层保护”，而是主动在每个 `input` 事件上派发 ProseMirror transaction、并在随后的 `sync()`/`render()` 里把值写回同一个正在被输入法占用的 `<input>`：

- `packages/mdx-editor/syntax/milkdown/source-preservation/node-views.ts:190` 注册 `input` 监听；`:227-237` 的 `onInput` 立即 `view.dispatch(tr.setNodeMarkup(...))`；`:242` 的 `sync()` 用 `if (this.input.value !== value) this.input.value = value;` 写回。适用于 inline HTML source 与 inline fallback（`:299-317`）。
- `packages/mdx-editor/syntax/milkdown/math/node-view.ts:79` 注册 `input` 监听；`:114-124` 立即派发；`:150` 写回 `this.source.value`。
- `packages/mdx-editor/syntax/milkdown/callout/node-view.ts:50-62` 的 `kindInput`/`titleInput` 在每个 `input` 事件上执行 `sanitizeCalloutKind` / `sanitizeCalloutTitle` 并可能就地改写 `.value`；`:95-96` 在 `sync()` 中再次写回。

代码注释本身承认这个风险（“Writing an unchanged value would reset the caret mid-typing.”），但比较的是 `value !== value`，对“composition 正在进行”一无所知。

### 1.4 `composition.test.ts` 并不测试 IME

`packages/mdx-editor/syntax/milkdown/composition.test.ts` 的文件名容易被误读为 IME 覆盖。它实际断言的是 **plugin 组合**（composed syntax layer）的 Markdown round-trip 保真：

- `:66-83` 逐个 syntax family（frontmatter / wikilink / callout / mermaid / footnote）跑 fixture，断言 `preservedSlices` 仍在序列化结果里。
- `:85-157` plugin 边界：frontmatter 与 callout 不互相污染、callout 体内的 wikilink 保留、frontmatter 内的 `[[...]]` 不被当链接、code fence 内的 callout marker 不被识别、footnote 与 wikilink 同段共存等。
- `:159-200` 用 `createBaseMilkdownPlugins()` 与 `createMdxMilkdownPlugins()` 跑同一输入，证明只有加了 syntax layer 才不产生 `\[\[Target]]` / `\[!WARNING]` 之类的破坏。
- `:202-209` mixed fixture。

全文没有一次 `CompositionEvent`、没有一次 `view.composing`、没有一个输入法场景。它不构成任何 IME 证据。

### 1.5 为什么自动化不能补上这一项

即使补一个 jsdom 测试并合成 `compositionstart` / `compositionupdate` / `compositionend`，ProseMirror 的 `view.composing` 仍然是 `false`：该标志由真实 `DOMObserver` 与浏览器 composition 状态驱动，合成事件不会让 `DOMObserver` 推迟 flush，也不会产生真实输入法的“边输入边替换选区”的 DOM 变更序列。因此这类测试只能证明代码没抛异常，不能证明 IME 正确。`TC-013` 的 Deferred rationale 已经写明“VoiceOver/真实 IME 必须人工，不延期”。

### 1.6 本清单的处理方式

第 4.1 节（`M-IME-01` 至 `M-IME-08`）是本清单的第一组测试项，必须最先执行。其中任意一项 fail，都直接阻断 `P-008` 的入口切换（见第六节）。

---

## 二、前置条件

### 2.1 构建

必须使用 release-like Tauri 构建，不得用 `npm run dev`、debug 构建或浏览器直开。

1. 在干净工作树上记录 commit：`git rev-parse HEAD`。
2. 构建资格产物：
   ```
   NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION=1 npm run build:app
   ```
   环境变量名固定在 `features/editor/lib/editor-surface-qualification.ts:14-19`；比较写成字面量 `process.env.NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION === "1"` 是为了让打包器把分支折叠成常量，因此该变量必须在 **构建时** 设置，运行时设置无效。
3. 安装：`npm run install:local`（或 `npm run build:install` 合并执行）。
4. 从 `/Applications` 启动安装后的 MDX.app，不从终端带环境变量启动。
5. 不打开任何 Web Inspector / DevTools。本清单的全部通过条件都基于屏幕上可见的状态，不依赖 DOM 检查。

确认资格表面确实生效：打开一个 Markdown 文件后，编辑区应是标准 DOM 富文本（可直接把光标点进段落中间、可用系统右键菜单），而不是 legacy hybrid 表面。若看到 legacy 表面，说明构建时环境变量未生效，整轮作废。

挂载点：Workspace Mode 见 `features/workspace/components/editor-stage.tsx:210-231`；Document Mode 见 `features/document/components/document-shell.tsx:1127-1133`。

### 2.2 硬件与系统

按 `D-015`：Apple M5 10-core、16 GB RAM、macOS 26.4，或性能不低于该基准的 Apple Silicon Mac。接电源、关闭无关重负载应用、不使用低电量模式。

### 2.3 输入法准备

在「系统设置 → 键盘 → 文字输入 → 输入法 → 编辑」中至少添加：

- 简体中文 — 拼音（简体）
- 日本語 — ローマ字入力
- 한국어 — 두벌식

切换快捷键记录为实际使用的组合（默认 `Control+Space`）。测试期间关闭「自动纠正」「自动大写」等会改写文本的辅助项，并在结果表中记录该设置。

### 2.4 fixture 准备

在测试目录准备两个文件：

````
mkdir -p ~/mdx-qual && cd ~/mdx-qual
printf '# 标题\n\n## 二级标题\n\n### 三级标题\n\n段落。\n\n- 项一\n- 项二\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n\n> [!NOTE]\n> 提示体\n\n```js\nconst a = 1;\n```\n\n行内数学 $E=mc^2$ 与 [[Target Page]]。\n\n行内 HTML <span data-x="1">inline</span> 结束。\n\n<div class="x">safe html</div>\n' > qual.md
printf 'combining: e\xcc\x81\n' > combining.md
````

`combining.md` 里的 `e` + `U+0301` 是刻意的分解形式，用于 `M-UNI-02`。校验方式：`xxd combining.md | head -1`，必须能看到 `65 cc 81`。

### 2.5 必须记录的元数据

每轮执行开始时记录，写进第五节结果表表头：

| 字段 | 取值方式 |
|---|---|
| app commit | 构建时的 `git rev-parse HEAD`（短 hash 即可） |
| macOS 版本 / build | `sw_vers`，记录 `ProductVersion` 与 `BuildVersion` |
| WebView 版本 | Tauri 在 macOS 上使用系统 WKWebView；记录 Safari → 关于 Safari 显示的 Safari/WebKit 版本 |
| 机型 | 「关于本机」的芯片与内存 |
| 输入法版本 | 各输入法在系统设置中显示的名称，与是否启用「自动纠正」 |
| 执行人 / 日期 | 姓名与执行日期 |

### 2.6 已知的产品缺口（执行前必须知道）

以下四点在 `P-008` 切换入口之后的产品构建中成立。它们会直接影响第 4.6 节的判定，执行者必须先读，避免把“功能不存在”误记为“功能有 bug”：

1. **没有工具条。** 产品表面不挂载任何编辑工具条，`EditorToolbar` 组件已随旧交互路径一并删除。格式命令通过快捷键与 CLI 到达，不通过按钮。
2. **查找条只由快捷键打开。** `EditorFindBar` 挂载在 `features/editor/components/markdown-editor-surface.tsx` 中，只有 `isFindOpen` 为真时才渲染；入口是 `Cmd+F`（查找）与 `Cmd+R`（替换），定义在 `features/editor/lib/editor-shortcuts.ts`。界面上没有常驻的查找按钮。
3. **模式切换只有快捷键，没有可见控件。** 用户可达的入口是 `Cmd+Shift+M`（`isEditorSourceModeShortcut`，`features/editor/lib/editor-shortcuts.ts`；在 `markdown-editor-surface.tsx` 的 `handleKeyDownCapture` 中调用 adapter 的 `setMode`）。没有工具条按钮、右键菜单或菜单栏项，因此「找不到按钮」不等于「功能不存在」，执行者一律用 `Cmd+Shift+M` 触发。另有一条非用户触发的路径：WYSIWYG 构建失败时 adapter 自动 `onModeChange("source")`。

   注意快捷键的作用范围：处理器挂在编辑区容器上，而查找条渲染在该容器之外，因此**焦点停在查找条输入框里时按 `Cmd+Shift+M` 不会切换**（`Cmd+F` 同理，这是迁移前后一致的既有作用域）。触发前请先把焦点放回正文。
4. **Document Mode 不接 wikilink 与 CLI。** `features/document/components/document-shell.tsx` 传了 `storeImage` 与 `services`，但没有传 `onOpenWikilink`、`pendingCliCommand`，因此 wikilink 打开与 CLI 命令在 Document Mode 下不可测。这与迁移前的 Document Mode 一致（旧 `document-shell.tsx` 同样没有这两项），不是本次迁移引入的回归。涉及这两项能力的测试项一律在 Workspace Mode 执行。

---

### 2.7 与 `D-015` 性能 harness 的分工

本清单裁决 **正确性**；`AC-014` 的 **延迟数字** 在同一台机器、同一个资格构建里由性能 harness 采集，流程见
`docs/loopx/design/2026-08-12-milkdown-editor-migration/P-007-performance-measurement-procedure.md`。

两者有一处必须由同一个人连续完成的交接：`AC-014` 的输入延迟与 IME 延迟 **无法脚本化**。

- 输入延迟以 `beforeinput` 为起点，而只有真实按键会产生 `beforeinput`；`document.execCommand("insertText")` 会插入字符但不派发 `beforeinput`（已在 Chromium 151 上实测：字符落入文档，捕获阶段的 `beforeinput` 监听器一次都没有触发）。
- IME 延迟以 composition 提交为起点，合成 `CompositionEvent` 不会让 `view.composing` 变为真（同 1.5）。

因此执行顺序是：**先跑完 4.1 的 IME 组**，确认 composition 本身没有坏；再打开资格构建里的 `/mdx-editor-qualification` 路由，在两个 fixture 上各自敲满 200 次真实按键与 200 次真实输入法提交，由页面记录原始样本。若 4.1 任一项 `fail`，不必去采集延迟样本——此时数字描述的是一个不能正常输入的编辑器。

---

## 三、执行规则

1. 每项按写明的顺序执行，不跳步。IME 组（4.1）必须先于其余组。
2. 每项独立记录结果：`pass` / `fail` / `blocked`。`blocked` 表示前置条件不存在（例如控件未实现），在第六节中与 `fail` 等价，不得记为 `pass`，也不得记为「不适用」。
3. 每项至少执行 3 次。3 次中出现 1 次不符合通过条件即记 `fail`，并在 notes 中写明 `n/3`。IME 组每项执行 5 次，记 `n/5`。
4. 失败时按每项的「失败记录」字段逐字记录屏幕上实际出现的内容。禁止写「输入异常」「表现不正确」这类概括。
5. 每项之间关闭并重开文档，避免上一项残留的 dirty/history 状态影响判定。
6. 遇到本清单未预期的行为，仍按该项的通过条件判定；把观察到的额外现象写进 notes，不改判通过条件。

---

## 四、测试项

### 4.1 IME composition（最高优先级）

#### M-IME-01 拼音 composition 在正文段落提交

- 覆盖：`AC-002`、`AC-014`；`TC-001`、`TC-013`
- 前置：Workspace Mode 打开 `qual.md`，光标点进「段落。」的句号之前。切到「拼音（简体）」。
- 步骤：
  1. 依次按 `n` `i` `h` `a` `o`，不要按其他键。
  2. 观察屏幕：候选栏应出现，编辑区应出现带下划线的未提交串。
  3. 按 `Space` 选中第一候选。
  4. 观察编辑区内容。
- 通过条件：第 3 步之后，编辑区该位置的文本恰为 `你好`，且不含任何 `nihao`、`ni hao`、`nih` 等拉丁字母残留；光标位于 `你好` 之后；候选栏消失。
- 失败记录：逐字抄录编辑区实际出现的字符串、光标位置、候选栏是否仍在、复现次数 `n/5`。

#### M-IME-02 拼音 composition 中途改词与退格

- 覆盖：`AC-002`；`TC-001`、`TC-013`
- 前置：同 `M-IME-01`。
- 步骤：
  1. 依次按 `z` `h` `o` `n` `g` `g` `u` `o`，不提交。
  2. 按一次 `Delete`（退格）。
  3. 按 `Space` 提交第一候选。
- 通过条件：第 2 步只从未提交串中移除一个字母（候选栏随之更新），不删除编辑区中该 composition 之前的既有正文字符；第 3 步提交的结果是一个完整的中文词，编辑区中 composition 之前的正文与步骤开始前逐字相同。
- 失败记录：抄录第 2 步之后编辑区的完整该行文本、候选栏内容；抄录第 3 步之后的完整该行文本；`n/5`。

#### M-IME-03 日文 IME composition 与汉字变换

- 覆盖：`AC-002`；`TC-001`、`TC-013`
- 前置：切到「日本語 — ローマ字入力」，光标置于 `qual.md` 末尾新起的一行。
- 步骤：
  1. 依次输入 `n` `i` `h` `o` `n` `g` `o`，此时应显示假名未提交串 `にほんご`。
  2. 按 `Space` 触发变换，候选应出现 `日本語`。
  3. 按 `Return` 提交。
- 通过条件：第 3 步后编辑区该行文本恰为 `日本語`，无 `にほんご` 残留、无罗马字残留、无重复字符；光标在 `日本語` 之后；候选栏消失。
- 失败记录：抄录第 1/2/3 步各自之后编辑区该行的完整文本；`n/5`。

#### M-IME-04 composition 期间的 `Return` 不被编辑器截获

- 覆盖：`AC-002`；`TC-001`
- 前置：日文输入法，光标置于文档末尾新行。
- 步骤：
  1. 输入 `n` `i` `h` `o` `n` `g` `o`，按 `Space` 出候选。
  2. 按一次 `Return`。
- 通过条件：`Return` 只提交候选，不在文档中产生新段落/新行；提交后该行恰为 `日本語`，其后没有空段落。
- 失败记录：记录是否产生了新段落、提交后光标所在行的完整文本、`n/5`。
- 说明：legacy 表面对该冲突有显式守卫（`features/editor/components/editor-pane.tsx:544-559`）；新表面没有任何等价守卫，此项预期风险高。

#### M-IME-05 composition 被 clean reload 打断

- 覆盖：`AC-002`、`AC-005`、`AC-006`；`TC-001`、`TC-003`
- 前置：Workspace Mode 打开 `qual.md` 且该 tab 为 clean（标题栏无 dirty 标记，本项开始前不要做任何编辑）。终端准备好但尚未执行的命令：
  ```
  sleep 6; printf '\n外部追加行\n' >> ~/mdx-qual/qual.md
  ```
  clean reload 的真实触发点是 `features/workspace/components/workspace-shell.tsx:786-806`（watcher 读到外部变更且 tab 为 clean），它以 `reason: "clean-reload"` 走 `EditorReplaceReason`（`packages/mdx-editor/adapter/types.ts:15-19`），最终由 `packages/mdx-editor/milkdown/editor-host.ts:586-627` 的 `replaceMarkdown` 执行整份替换并清空 history。
- 步骤：
  1. 在终端回车执行上面的命令。
  2. 立刻切回 MDX，光标点进段落中间，用拼音输入 `n` `i` `h` `a` `o`，**不要提交**，保持候选栏可见。
  3. 等待外部写入触发重载（约 6 秒后）。
  4. 观察编辑区。
  5. 提交或按 `Escape` 取消当前 composition，然后检查全文。
- 通过条件：重载发生后，编辑区显示磁盘上的新内容（含「外部追加行」），未提交的 composition 或被取消、或完整提交，两者皆可；**不得**出现下列任一情况：编辑区出现 `nihao` 之类的拉丁字母残留；出现半截汉字或重复插入；文档正文出现步骤 2 位置以外的意外改动；应用无响应或该 tab 变为空白。
- 前置失败分支：若第 3 步没有发生重载、而是弹出冲突/diff 对话框，说明 composition 已把该 tab 变为 dirty；关闭对话框、还原文件、重跑本项。连续 3 次都进入冲突分支时记 `blocked` 并写明。
- 失败记录：抄录重载后编辑区的完整前两段文本、以及 `cat ~/mdx-qual/qual.md` 的对应内容，两者逐字对比结果；`n/5`。

#### M-IME-06 composition 被模式切换打断

- 覆盖：`AC-002`、`AC-012`；`TC-011`、`TC-013`
- 前置：用户可达的模式切换入口是快捷键 `Cmd+Shift+M`（没有可见控件，见 2.6 第 3 点）。
- 步骤：
  1. 光标点进段落中间，用拼音输入 `n` `i` `h` `a` `o`，保持候选栏可见、不提交。
  2. 按 `Cmd+Shift+M` 切换到源码模式。
  3. 观察源码模式中的文本，再按 `Cmd+Shift+M` 切回 WYSIWYG 并观察。
- 通过条件：切换后源码文本中不含 `nihao` 之类拉丁残留、不含半截汉字、不含重复插入；切换前已提交的正文逐字保留；切回 WYSIWYG 后内容与源码一致。
- 判定：若 `Cmd+Shift+M` 完全不切换表面，记 `fail` 而不是 `blocked`——该入口已存在于产品代码并有自动化覆盖（`features/editor/components/markdown-editor-surface-mode.test.tsx`），真机不生效属于缺陷。`AC-012` 要求「用户可以在 WYSIWYG 与全局 CodeMirror 源码模式间切换」，该项不通过即阻断入口切换。
- 失败记录：抄录切换后两侧表面各自的该段完整文本；若切换本身没有发生，记录当时的焦点位置（正文 / NodeView 内嵌 `<input>` / 查找条输入框）与键盘布局，因为该判定读的是 `event.code === "KeyM"`。

#### M-IME-07 NodeView 内嵌 `<input>` 的拼音输入

- 覆盖：`AC-002`、`AC-013`；`TC-001`、`TC-012`
- 前置：Workspace Mode 打开 `qual.md`，定位到 `> [!NOTE]` callout。callout 的类型/标题是两个带 `aria-label` 的 `<input>`（`packages/mdx-editor/syntax/milkdown/callout/node-view.ts:49,58`）。
- 步骤：
  1. 点进 callout 标题输入框。
  2. 用拼音输入 `t` `i` `s` `h` `i`，保持候选栏可见。
  3. 观察输入框内显示的内容与光标位置。
  4. 按 `Space` 提交第一候选。
- 通过条件：第 3 步中输入框内显示未提交串且光标停在串尾（不跳到开头、不被清空）；第 4 步后输入框内容恰为提交的中文词，无拉丁残留、无字符重复、无顺序错乱。
- 失败记录：抄录第 3 步与第 4 步之后输入框内的完整文本与光标位置；`n/5`。
- 说明：该输入框在每个 `input` 事件上都派发 transaction 并可能就地改写 `.value`（`callout/node-view.ts:50-62`、`:95-96`），没有 composition 守卫；这是本节 1.3 指出的高风险点之一。

#### M-IME-08 源码模式（CodeMirror）的拼音输入

- 覆盖：`AC-002`、`AC-012`；`TC-011`、`TC-013`
- 前置：需要能进入源码模式（见 `M-IME-06` 的前置）。源码表面为 CodeMirror，键位来自 `packages/mdx-editor/source/source-host.ts:255` 的 `defaultKeymap` + `historyKeymap`。
- 步骤：
  1. 进入源码模式，光标点进任意一行中间。
  2. 用拼音输入 `n` `i` `h` `a` `o`，按 `Space` 提交。
- 通过条件：该行恰在光标处新增 `你好`，无拉丁残留、无字符丢失、行内其余字符逐字不变。
- 判定（无法进入源码模式时）：记 `blocked`，理由同 `M-IME-06`。
- 失败记录：抄录该行输入前后的完整文本；`n/5`。

### 4.2 emoji 与组合字符

#### M-UNI-01 家庭 emoji（ZWJ 序列）的插入与删除

- 覆盖：`AC-002`、`AC-014`；`TC-001`、`TC-013`
- 前置：Workspace Mode 打开 `qual.md`，光标置于文档末尾新行。
- 步骤：
  1. 按 `Control+Command+Space` 打开表情选择器，搜索 `family`，选择 `👨‍👩‍👧‍👦`（U+1F468 ZWJ U+1F469 ZWJ U+1F467 ZWJ U+1F466）。
  2. 观察编辑区。
  3. 按一次 `Delete`（退格）。
  4. 观察编辑区。
  5. 撤销到步骤 1 之后的状态，保存（`Command+S`），在终端执行 `xxd ~/mdx-qual/qual.md | tail -5`。
- 通过条件：
  - 第 2 步后编辑区显示一个完整的家庭 emoji，而不是 4 个并排的人物 emoji。
  - 第 4 步后该 emoji 整体消失，行内不残留任何人物 emoji 或不可见字符导致的空位。expected: 一次退格删除整个 grapheme cluster，per `AC-002` 的「由标准 DOM/ProseMirror 编辑路径处理」；若产品改为逐个 code point 删除、留下 `👨‍👩‍👧`，记 fail。
  - 第 5 步的字节序列中能看到 `f0 9f 91 a8 e2 80 8d f0 9f 91 a9 e2 80 8d f0 9f 91 a7 e2 80 8d f0 9f 91 a6`（4 个人物 code point 之间各有一个 `e2 80 8d` ZWJ），无多余或缺失的 ZWJ。
- 失败记录：截图编辑区、抄录 `xxd` 输出中该行的完整字节；`n/3`。

#### M-UNI-02 组合字符 `e` + U+0301 的保真

- 覆盖：`AC-003`、`AC-004`；`TC-002`、`TC-013`
- 前置：Workspace Mode 打开 `~/mdx-qual/combining.md`（该文件的 `é` 是分解形式，已在 2.4 用 `xxd` 校验过 `65 cc 81`）。
- 步骤：
  1. 观察编辑区，确认显示 `combining: é`。
  2. 在该行末尾追加一个 ASCII 字符 `x`。
  3. `Command+S` 保存。
  4. 终端执行 `xxd ~/mdx-qual/combining.md`。
- 通过条件：第 4 步输出中该处仍为 `65 cc 81`（分解形式），**不得**被规范化为 `c3 a9`（预组合 U+00E9）；行尾多出 `78`。
- 失败记录：抄录 `xxd` 完整输出；`n/3`。

#### M-UNI-03 韩文 jamo 组字

- 覆盖：`AC-002`；`TC-001`、`TC-013`
- 前置：切到「한국어 — 두벌식」，光标置于 `qual.md` 末尾新行。
- 步骤：
  1. 依次按 `g`（ㅎ）、`k`（ㅏ）、`s`（ㄴ）。
  2. 观察每次按键后编辑区显示的字符。
  3. 按一次 `Delete`。
- 通过条件：三次按键后编辑区显示单个音节 `한`（不是 `ㅎㅏㄴ` 三个分离字母）；第 3 步后显示 `하`。expected: 逐 jamo 回退，per `AC-002` 的标准 DOM 编辑路径；若一次退格删掉整个音节或产生空字符，记 fail。
- 失败记录：抄录三次按键各自之后与退格之后编辑区显示的字符；`n/3`。

#### M-UNI-04 emoji 与组合字符在跨表面往返后保真

- 覆盖：`AC-003`、`AC-012`；`TC-002`、`TC-011`
- 前置：完成 `M-UNI-01`、`M-UNI-02` 后的文件；需要能进入源码模式。
- 步骤：
  1. 在 WYSIWYG 中确认家庭 emoji 与 `é` 都可见。
  2. 切到源码模式，观察同样两处。
  3. 切回 WYSIWYG，保存，`xxd` 校验两处字节。
- 通过条件：三个时刻的字节序列完全一致（ZWJ 数量不变、`65 cc 81` 不变）。
- 判定（无法进入源码模式时）：记 `blocked`。
- 失败记录：抄录三次 `xxd` 的对应行；`n/3`。

### 4.3 selection 与拖拽

#### M-SEL-01 键盘跨块选择

- 覆盖：`AC-002`；`TC-001`
- 前置：Workspace Mode 打开 `qual.md`，光标置于「段落。」的第一个字符之前。
- 步骤：
  1. 按住 `Shift` 连续按 `Down` 直至选区跨过列表并到达表格上方。
  2. 观察高亮范围。
  3. 按 `Shift+Up` 三次。
- 通过条件：选区高亮连续覆盖段落尾部、整个列表项一与项二，跨块处不出现断裂或整块跳选；第 3 步后选区按行收缩，不跳回起点、不清空。
- 失败记录：截图高亮范围，说明在哪个块边界出现断裂；`n/3`。

#### M-SEL-02 鼠标拖拽跨块选择

- 覆盖：`AC-002`；`TC-001`
- 前置：同上。
- 步骤：
  1. 在「段落。」的「段」字左侧按下鼠标，保持按下。
  2. 缓慢拖动到表格第一行「1」单元格中间，停留 1 秒后松开。
- 通过条件：拖动过程中高亮随指针连续扩展，跨越列表与 callout 时不消失、不整块跳变；松开后选区端点落在「1」处，`Command+C` 后粘贴到任意文本编辑器得到从「段」开始、到「1」结束的连续文本。
- 失败记录：截图 + 抄录粘贴出的文本；`n/3`。

#### M-SEL-03 `Command+A` 的选择范围

- 覆盖：`AC-002`；`TC-001`
- 前置：光标点进段落中间。
- 步骤：按 `Command+A`，观察高亮。
- 通过条件：高亮覆盖整个文档正文（从标题到最后一行），且不越出编辑区去选中文件树、标签栏或其他面板的文本。
- 失败记录：截图，说明实际覆盖范围；`n/3`。

#### M-SEL-04 双击与三击选择

- 覆盖：`AC-002`；`TC-001`
- 步骤：
  1. 在「段落。」的「段」字上双击。
  2. 在同一位置三击。
- 通过条件：双击选中一个词（中文按输入法/系统分词，至少选中「段落」而不是整段或单个字节的一半）；三击选中整个段落且不跨到相邻块。
- 失败记录：抄录两次选中的文本；`n/3`。

### 4.4 undo / redo

#### M-HIS-01 普通输入的撤销与重做

- 覆盖：`AC-002`；`TC-001`
- 步骤：
  1. 在段落末尾输入 `abc`。
  2. 按 `Command+Z` 直到 `abc` 完全消失。
  3. 按 `Command+Shift+Z` 直到 `abc` 完全恢复。
- 通过条件：第 2 步结束时段落逐字等于输入前的内容；第 3 步结束时逐字等于输入 `abc` 之后的内容；两个方向都不越过这两个状态去改动文档其他部分。
- 失败记录：抄录每次 `Command+Z` 之后该段落的完整文本；`n/3`。

#### M-HIS-02 跨 composition 的撤销

- 覆盖：`AC-002`；`TC-001`、`TC-013`
- 前置：拼音输入法。
- 步骤：
  1. 在段落末尾用拼音输入并提交 `你好`。
  2. 按一次 `Command+Z`，观察。
  3. 继续按 `Command+Z` 直到该段落回到步骤 1 之前的状态。
  4. 按 `Command+Shift+Z` 直到 `你好` 恢复。
- 通过条件：第 2 步之后不得出现拉丁字母 `nihao` 或半截汉字；`你好` 要么整体消失、要么整体保留（两者皆可，但必须是完整的 grapheme，不得出现 `你` 单独残留）；第 3 步能回到原状；第 4 步能完整恢复 `你好`。
- 失败记录：抄录每次撤销之后该段落的完整文本；`n/5`。

#### M-HIS-03 跨模式切换的撤销

- 覆盖：`AC-002`、`AC-012`；`TC-011`
- 前置：需要能进入源码模式。
- 步骤：
  1. WYSIWYG 中在段落末尾输入 `abc`。
  2. 切到源码模式。
  3. 按 `Command+Z`。
  4. 切回 WYSIWYG，观察。
- 通过条件：expected: 内容与 dirty 状态在两个表面之间共享且不静默丢失，per `AC-012`；具体撤销栈跨表面是否连续，本设计未固定。因此判定为：第 3、4 步后文档内容必须与两个表面看到的一致（源码里是什么，WYSIWYG 里就是什么），且 dirty 标记未被清除。若出现两个表面显示不同内容、或 dirty 被清除、或 `abc` 之外的正文被改动，记 fail。
- 判定（无法进入源码模式时）：记 `blocked`。
- 失败记录：抄录第 3 步源码表面的该行文本与第 4 步 WYSIWYG 的该段文本，以及标题栏 dirty 标记状态；`n/3`。

#### M-HIS-04 clean reload 之后不得撤销回旧内容

- 覆盖：`AC-005`、`AC-006`；`TC-003`
- 前置：Workspace Mode 打开 clean 的 `qual.md`。
- 步骤：
  1. 终端执行 `printf '\n重载标记\n' >> ~/mdx-qual/qual.md`，等待编辑区出现「重载标记」。
  2. 光标点进编辑区，连续按 `Command+Z` 十次。
  3. 观察编辑区。
- 通过条件：文档中始终保留「重载标记」，不得通过撤销回到重载前的内容。`packages/mdx-editor/milkdown/editor-host.ts:596-609` 明确在外部替换时重建 state 并清空 history，正是为了防止「撤销掉一次 clean reload 然后保存」。若十次撤销后「重载标记」消失，记 fail。
- 失败记录：抄录第 3 步编辑区末尾三行，以及 `tail -3 ~/mdx-qual/qual.md`；`n/3`。

### 4.5 clipboard

#### M-CLIP-01 复制 / 剪切 / 粘贴纯文本

- 覆盖：`AC-002`；`TC-001`
- 步骤：
  1. 按 `M-SEL-01` 选中跨段落到列表的一段内容。
  2. `Command+C`，把光标移到文档末尾新行，`Command+V`。
  3. 撤销到步骤 1 之前，重复一次但用 `Command+X`。
- 通过条件：粘贴结果保留段落与列表的块结构（列表项仍是列表项，不被压成一行纯文本）；剪切后原位置的内容完全消失且相邻块未被破坏（列表不残留空项、段落不留空行以外的痕迹）。
- 失败记录：抄录粘贴结果的完整文本与原位置剩余文本；`n/3`。

#### M-CLIP-02 粘贴富文本 HTML

- 覆盖：`AC-013`、`AC-015`；`TC-012`
- 前置：在 Safari 中打开任意含标题、加粗、项目符号列表和链接的网页，选中这四类元素并 `Command+C`。
- 步骤：
  1. 回到 MDX，光标置于文档末尾新行。
  2. `Command+V`。
  3. `Command+S` 保存，终端 `tail -30 ~/mdx-qual/qual.md`。
- 通过条件：粘贴后标题成为 Markdown 标题、加粗成为 `**`、列表成为 `-` 列表、链接成为 `[text](url)`；保存后的文件中不出现 `<script`、`onerror=`、`javascript:`，也不出现内部实现属性 `data-mdx-source-token` / `data-mdx-source-id`（clipboard 过滤见 `packages/mdx-editor/syntax/milkdown/source-preservation/clipboard-guard.ts:51`）。
- 失败记录：抄录 `tail -30` 的完整输出，标出违规片段；`n/3`。

#### M-CLIP-03 粘贴 Markdown 文本

- 覆盖：`AC-013`；`TC-012`
- 前置：终端执行下面这条命令（复制的内容里带一对反引号，用于测试行内代码）：

  ````
  printf '## 粘贴标题\n\n- 甲\n- 乙\n\n`code`\n' | pbcopy
  ````
- 步骤：光标置于文档末尾新行，`Command+V`。
- 通过条件：expected: 粘贴的 Markdown 被解析为结构化内容（二级标题、两项列表、行内代码），per `AC-013` 的 WYSIWYG 结构化编辑合同；若产品改为按字面文本插入并把 `##`、`-`、反引号显示为普通字符，记 fail 并在 notes 注明产品实际选择的是字面插入。
- 失败记录：截图粘贴结果，抄录保存后文件中对应的 Markdown；`n/3`。

#### M-CLIP-04 粘贴进代码围栏

- 覆盖：`AC-013`；`TC-012`
- 前置：终端执行 `printf '**bold** and <b>tag</b>\n' | pbcopy`。
- 步骤：光标点进 `qual.md` 中 ```` ```js ```` 围栏内 `const a = 1;` 之后，按 `Command+V`，保存后在终端执行：

  ````
  sed -n '/```js/,/```/p' ~/mdx-qual/qual.md
  ````
- 通过条件：围栏内新增的一行逐字为 `**bold** and <b>tag</b>`；`**` 与 `<b>` 均未被解析成加粗或 HTML 节点；围栏未被提前关闭或拆成两个围栏。
- 失败记录：抄录 `sed` 输出的完整围栏内容；`n/3`。

#### M-CLIP-05 从编辑器复制到外部应用

- 覆盖：`AC-013`、`AC-015`；`TC-012`
- 步骤：
  1. 在 MDX 中选中包含 callout、wikilink 与行内数学的一段（`qual.md` 的对应区域），`Command+C`。
  2. 打开「文本编辑」新建纯文本文档（格式 → 制作纯文本），`Command+V`。
- 通过条件：粘贴出的纯文本中不含 `data-mdx-source-token`、`data-mdx-source-id`、`data-mdx-preview` 等实现属性；wikilink 以 `[[...]]` 形式出现；数学以 `$...$` 形式出现。
- 失败记录：抄录粘贴出的完整纯文本；`n/3`。

### 4.5.1 视口滚动与定位

本组的三项都**只能真机判定**：jsdom 不实现布局，`Range.getClientRects` 在测试里返回空矩形，因此两个编辑表面都认为「目标已经可见」而从不滚动。自动化能证明选区落到了正确的源码区间，不能证明用户看得见它——这正是「点击目录没有跳转」能在全绿测试下发生的原因。

#### M-NAV-01 长文档可以上下滚动

- 覆盖：`AC-002`
- 前置：打开一个明显长于窗口高度的 Markdown 文件（`qual.md` 重复粘贴数遍即可）。
- 步骤：用触控板两指滚动、拖动滚动条、按 `Page Down` 与 `Command+↓`，各试一次。
- 通过条件：正文可滚动到文件末尾，最后一行可滚到窗口中部而不是卡在底边；滚动过程中不出现内容被裁切或空白区。
- 失败记录：记录哪种滚动方式无效，以及能到达的最远位置。

#### M-NAV-02 点击目录跳转到对应标题

- 覆盖：`AC-007`；`TC-006`
- 前置：同上，右侧 Outline 面板展开且列出多级标题。
- 步骤：
  1. 点击一个位于文档**末尾**、当前视口外的标题。
  2. 观察正文是否滚动到该标题。
  3. 再点击一个位于文档**开头**的标题，观察是否滚回。
  4. 切到源码模式（`Command+Shift+M`）后重复第 1 步。
- 通过条件：每次点击后该标题都进入可视区域，且光标落在该标题行；两种表面行为一致。
- 判定：光标位置正确但视口不动，记 `fail`——这正是本项要抓的缺陷形态，不要因为「光标对了」记 `pass`。
- 失败记录：记录点击的标题、点击前后视口顶部显示的内容、以及是哪一种表面。

#### M-NAV-03 CLI 定位命令滚动到目标

- 覆盖：`AC-007`；`TC-006`
- 步骤：对已打开的长文件执行 `mdx-cli focus`（或带行号的定位命令），目标行选在视口外。
- 通过条件：窗口前置后，目标行进入可视区域并带光标。
- 失败记录：记录命令、目标行号与实际停留位置。

---

### 4.6 键盘操作与焦点

执行本组前必须已读 2.6。

#### M-KBD-01 工具条的纯键盘操作

- 覆盖：`AC-007`；`TC-007`
- 步骤：
  1. 焦点置于编辑区，按 `Tab`，再按 `Shift+Tab`，观察是否存在可聚焦的编辑工具条。
  2. 若存在，用 `Left`/`Right` 在工具条按钮间移动，用 `Space` 或 `Return` 激活其中一个格式命令（如加粗），观察文档变化。
- 通过条件：存在一个 `role="toolbar"` 的可聚焦控件组；方向键可在其中移动焦点，每个可聚焦项都有可见焦点指示；激活其中一项会对文档产生对应的可见修改。
- 判定：产品没有编辑工具条，`EditorToolbar` 组件本身也已随旧交互路径删除（2.6 第 1 点）。若确认不存在，记 `blocked`。注意 `AC-007` 的格式命令能力由快捷键与 CLI 承担，工具条从来不是首版要求，因此该 `blocked` 不单独阻断入口切换；真正阻断的是 `M-KBD-02` 与 `M-KBD-03`。
- 失败记录：记录按 `Tab` 后焦点实际落在哪个元素（用 VoiceOver 打开并让它朗读焦点即可确认），以及尝试过的所有键。

#### M-KBD-02 模式切换的纯键盘操作

- 覆盖：`AC-012`；`TC-011`
- 步骤：
  1. 焦点置于编辑区，按 `Command+Shift+M`，观察编辑区是否换成另一种表面。
  2. 再按一次 `Command+Shift+M`，观察是否切回。
  3. 在源码模式下按 `Command+Shift+M` 之前，先用方向键移动光标，确认切回后正文内容未变。
- 通过条件：存在一条纯键盘路径能在 WYSIWYG 与源码之间来回切换，且切换后编辑区呈现另一种表面（源码模式下应能直接看到 `#`、`>`、```` ``` ```` 等 Markdown 记号）。
- 判定：`Command+Shift+M` 是唯一入口（2.6 第 3 点），没有可聚焦的模式切换控件，因此 `Tab` 到不了任何切换按钮属于预期，不记 `fail`。若 `Command+Shift+M` 本身不切换表面，先看编辑区顶部是否出现「无法切换到可视模式：…」的提示条：出现提示条说明这份 Markdown 确实无法安全构建成可视文档，属于设计内的拒绝（`D-005`），改用能正常构建的文档重跑本项；**没有任何反应且没有提示条**才记 `fail`，该状态对 `AC-012` 计为未通过。
- 失败记录：记录 `Command+Shift+M` 的实际效果与当时的焦点位置；该判定读的是 `event.code === "KeyM"`，非 US 布局下请一并记录键盘布局。

#### M-KBD-03 查找条的纯键盘操作

- 覆盖：`AC-007`；`TC-007`
- 步骤：
  1. 焦点置于编辑区，按 `Command+F`。
  2. 若查找条出现：输入 `段落`，按 `Return` 跳到下一处，`Shift+Return` 跳到上一处，`Escape` 关闭。
  3. 若查找条出现：切到拼音输入法，输入 `n` `i` `h` `a` `o` 但不提交，观察查找条是否已用未提交的拉丁串去搜索。
- 通过条件：`Command+F` 打开查找条且焦点自动进入查找输入框；`Return` / `Shift+Return` / `Escape` 行为如上；第 3 步中在提交之前查找条不得用 `nihao` 之类拉丁串执行搜索（守卫见 `features/editor/components/editor-find-bar.tsx:60-66`）。
- 判定：查找条已挂载在产品表面（`markdown-editor-surface.tsx` 中的 `EditorFindBar`），`Command+F` / `Command+R` 由 `isEditorFindShortcut` / `isEditorReplaceShortcut` 处理。若 `Command+F` 无任何反应，记 `fail` 而不是 `blocked`。
- 失败记录：记录 `Command+F` 的实际效果；若查找条存在，抄录第 3 步中查找条内显示的查询串与匹配计数。

#### M-KBD-04 NodeView 源码编辑的键盘可达性

- 覆盖：`AC-007`、`AC-013`；`TC-007`、`TC-012`
- 前置：Workspace Mode 打开 `qual.md`，其中含行内数学 `$E=mc^2$`、行内 HTML `<span data-x="1">`、块级 HTML `<div class="x">` 与 callout。
- 步骤：
  1. 把光标放在行内数学之前的字符处，用 `Right` 逐字符移动越过该数学节点，观察能否用键盘进入其源码输入框。
  2. 对行内 HTML 重复第 1 步。
  3. 用 `Tab` 从编辑区开始循环，记录焦点是否会停在数学源码输入框、行内 HTML 输入框、块级 HTML 源码文本或 callout 的类型/标题输入框上。
  4. 对能到达的每个控件，输入一个字符并移开焦点，观察文档是否更新。
- 通过条件：数学、行内 HTML、块级 HTML 源码与 callout 的可编辑控件都能在不使用鼠标的情况下获得焦点，并在获得焦点时有可见焦点指示。
- 已知风险：行内数学的编辑态只由 `preview` 的 `click` 事件进入（`packages/mdx-editor/syntax/milkdown/math/node-view.ts:73,110-112`），`<input>` 只有在进入编辑态后才被插入 DOM（`:130-140`），且 `stopEvent` 对该节点内的所有事件返回 true（`:93-96`）。若确认只能用鼠标进入，本项记 `fail`（不是 `blocked`：控件存在，只是键盘不可达）。
- 失败记录：逐条记录 `Tab` 循环经过的每一站，以及哪些控件只能用鼠标到达。

#### M-KBD-05 Tab / Shift+Tab 焦点顺序与无焦点陷阱

- 覆盖：`AC-014`；`TC-013`
- 步骤：
  1. 点击编辑区正文使其获得焦点。
  2. 连续按 `Tab`，记录焦点经过的每一站，直到回到起点或走完一整圈（上限 30 次）。
  3. 从同一起点连续按 `Shift+Tab`，记录顺序。
- 通过条件：`Shift+Tab` 的顺序是 `Tab` 顺序的逆序；焦点始终可见（每一站都有可辨认的焦点指示）；不存在任何一站按 `Tab` 与 `Shift+Tab` 都无法离开（焦点陷阱）；焦点顺序与视觉从上到下、从左到右的排列一致。
- 失败记录：按序抄录两个方向经过的每一站（用 VoiceOver 朗读确认每一站的身份），标出不可逆或无法离开的位置。

#### M-KBD-06 模式切换后的焦点恢复

- 覆盖：`AC-012`、`AC-014`；`TC-011`、`TC-013`
- 前置：需要能进入源码模式。
- 步骤：
  1. 在 WYSIWYG 中把光标放在「段落。」的「落」字之后。
  2. 切到源码模式，不动鼠标，直接输入 `X`。
  3. 切回 WYSIWYG，不动鼠标，直接输入 `Y`。
- 通过条件：第 2 步的 `X` 落在源码中「段落」之后的对应位置（adapter 在切换时携带 selection，见 `packages/mdx-editor/adapter/markdown-editor-adapter.tsx:244-251`）；第 3 步的 `Y` 落在 `X` 之后；两步都不需要先用鼠标点击编辑区就能输入。
- 判定（无法进入源码模式时）：记 `blocked`。
- 失败记录：抄录两次输入后该行的完整文本以及字符实际落点；`n/3`。

### 4.7 VoiceOver

工具与按键约定：`VO` = `Control+Option`。用 `Command+F5` 开关 VoiceOver。执行本组时把 VoiceOver 语速调低到能逐词听清。每项都要在 notes 里写下 VoiceOver 实际朗读的原话。

#### M-VO-01 标题的层级朗读

- 覆盖：`AC-014`；`TC-013`
- 前置：`qual.md` 已含 `#`、`##`、`###` 三级标题（见 2.4）。开启 VoiceOver，焦点置于编辑区顶部。
- 步骤：
  1. 按 `VO+A` 从头朗读。
  2. 按 `VO+U` 打开 rotor，用 `Left`/`Right` 切到「标题」列表，观察列出的条目。
  3. 关闭 rotor，用 `VO+Command+H` 逐个跳到下一个标题。
- 通过条件：VoiceOver 在朗读每个标题时报出「标题 级别 1/2/3」（heading level 1/2/3）；rotor 的标题列表包含文档中全部三个标题、级别正确、顺序与文档一致；`VO+Command+H` 能依次到达它们。
- 失败记录：抄录 VoiceOver 对每个标题朗读的完整原话、rotor 列表的完整内容。

#### M-VO-02 列表的朗读

- 覆盖：`AC-014`；`TC-013`
- 步骤：
  1. 用 `VO+Command+X` 跳到下一个列表。
  2. 用 `VO+Right` 逐项前进。
- 通过条件：VoiceOver 报出列表的存在与项数（如「列表 2 项」），并在每一项上报出项序（如「1 项，共 2 项」）；不把列表读成连续散文。
- 失败记录：抄录进入列表时与每一项上朗读的完整原话。

#### M-VO-03 表格的朗读与单元格导航

- 覆盖：`AC-014`；`TC-013`
- 步骤：
  1. 用 `VO+Command+T` 跳到 `qual.md` 中的表格。
  2. 按 `VO+Shift+Down` 进入表格内部。
  3. 用 `VO+Right`、`VO+Down` 在单元格间移动，覆盖全部 4 个数据位置。
  4. 按 `VO+Shift+Up` 退出表格。
- 通过条件：进入时报出表格尺寸（2 列、含表头行）；在每个单元格上报出行列位置与内容（如「列 A，行 2，1」）；表头单元格被识别为表头。若 VoiceOver 把表格读成一串没有行列信息的文本，记 fail。
- 失败记录：抄录进入表格时与四个单元格上朗读的完整原话。

#### M-VO-04 NodeView 控件的可访问名称

- 覆盖：`AC-007`、`AC-014`；`TC-007`、`TC-013`
- 前置：`qual.md` 中的 callout、行内数学、行内 HTML `<span data-x="1">` 与块级 `<div class="x">`。
- 步骤：用 `VO+Right` 从文档开头逐元素前进，穿过 callout、数学、行内 HTML 与块级 HTML，记录每个可交互控件被朗读出的名称。
- 通过条件：
  - callout 的两个输入框分别读作 `Callout type` 与 `Callout title`（`packages/mdx-editor/syntax/milkdown/callout/node-view.ts:49,58`）。
  - 行内数学进入编辑态后的源码输入框读作 `Inline math source`（`math/node-view.ts:78`）。
  - 行内 HTML 的源码输入框读作 `Inline HTML source`（`source-preservation/node-views.ts:299-305`）；未知行内语法读作 `Unsupported inline source`（`:311-317`）。
  - 块级 HTML 源码没有 `aria-label`：它是 `contentDOM` 里的可编辑文本（`source-preservation/node-views.ts:105-110`），因此 VoiceOver 应逐字读出其源码文本本身。若 VoiceOver 在该处什么都不读、或只读出经过 sanitize 的预览而读不到源码，记 fail。
  - 前四类中任一带 `aria-label` 的控件被读作「编辑文本」「按钮」等无名称的通用词，记 fail。
- 失败记录：逐个抄录 VoiceOver 朗读出的名称。

### 4.8 WCAG 2.1 AA 颜色与焦点

工具：`/应用程序/实用工具/数码测色计`（Digital Color Meter）。设置：菜单「显示」→「值的显示方式」→「sRGB」，「显示 8 位 (0-255)」；孔径调到 1 像素；用 `Shift+Command+C` 把当前颜色复制为文本。

对比度计算（WCAG 2.1 定义，两人计算结果必须一致）：对每个通道 `c = 通道值/255`，若 `c ≤ 0.04045` 则 `c_lin = c/12.92`，否则 `c_lin = ((c+0.055)/1.055)^2.4`；相对亮度 `L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin`；对比度 `= (L_亮+0.05)/(L_暗+0.05)`。可用任意实现了该公式的计算器，但必须在 notes 中记录测到的两个 RGB 值，使结果可复核。

#### M-WCAG-01 正文文字与背景对比度

- 覆盖：`AC-014`；`TC-013`
- 前置：浅色外观（系统设置 → 外观 → 浅色），MDX 打开 `qual.md`。
- 步骤：
  1. 用数码测色计取正文段落中一个笔画最粗处的像素值。
  2. 取该段落旁边空白背景的像素值。
  3. 计算对比度。
  4. 对下列每处重复：一级标题、列表项、表格单元格文本、callout 正文、代码围栏内的代码、行内 wikilink 文本。
- 通过条件：全部 7 处的对比度 ≥ 4.5:1（正文字号）。若某处字号 ≥ 18pt 或 ≥ 14pt 加粗，可按大文本适用 3:1，但必须在 notes 中记录实测字号依据。
- 失败记录：逐处记录前景 RGB、背景 RGB、算得的比值。

#### M-WCAG-02 界面组件与边界对比度

- 覆盖：`AC-014`；`TC-013`
- 步骤：对下列每处测量其与相邻背景的对比度：callout 的左边界/背景色块、表格线、代码围栏背景边界、被选中文本的高亮区与其上文字。
- 通过条件：用于表达状态或边界的非文本图形对比度 ≥ 3:1；选中高亮上的文字与高亮背景的对比度 ≥ 4.5:1。
- 失败记录：逐处记录两个 RGB 与比值。

#### M-WCAG-03 可见焦点指示

- 覆盖：`AC-014`；`TC-013`
- 步骤：
  1. 按 `M-KBD-05` 的路线用 `Tab` 走一圈。
  2. 在每一站截图，并用数码测色计测焦点指示颜色与其紧邻背景色。
- 通过条件：每一站都有肉眼可辨的焦点指示（轮廓、下划线或背景变化，不能只有颜色轻微变化）；焦点指示与相邻背景对比度 ≥ 3:1；编辑区正文中的光标可见且在滚动后仍可见。
- 失败记录：列出没有焦点指示或对比度不足的每一站，附截图与 RGB 值。

#### M-WCAG-04 深色外观复测

- 覆盖：`AC-014`；`TC-013`
- 步骤：把系统外观切到「深色」，重跑 `M-WCAG-01`、`M-WCAG-02`、`M-WCAG-03` 的全部测点。
- 通过条件：与浅色下相同的阈值全部满足。
- 失败记录：同上，并注明是深色外观下的测量。

---

## 五、结果表

执行前先填表头元数据，再逐行填写。空行不得留白。

**元数据**

| 字段 | 值 |
|---|---|
| app commit | |
| 构建命令 | `NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION=1 npm run build:app` |
| macOS ProductVersion / BuildVersion | |
| WebView（Safari/WebKit 版本） | |
| 机型 / 芯片 / 内存 | |
| 输入法与「自动纠正」设置 | |
| 执行人 / 日期 | |

**逐项结果**

| id | 结果 | 复现 | macOS + WebView + commit | notes |
|---|---|---|---|---|
| M-IME-01 | | /5 | | |
| M-IME-02 | | /5 | | |
| M-IME-03 | | /5 | | |
| M-IME-04 | | /5 | | |
| M-IME-05 | | /5 | | |
| M-IME-06 | | /5 | | |
| M-IME-07 | | /5 | | |
| M-IME-08 | | /5 | | |
| M-UNI-01 | | /3 | | |
| M-UNI-02 | | /3 | | |
| M-UNI-03 | | /3 | | |
| M-UNI-04 | | /3 | | |
| M-SEL-01 | | /3 | | |
| M-SEL-02 | | /3 | | |
| M-SEL-03 | | /3 | | |
| M-SEL-04 | | /3 | | |
| M-HIS-01 | | /3 | | |
| M-HIS-02 | | /5 | | |
| M-HIS-03 | | /3 | | |
| M-HIS-04 | | /3 | | |
| M-CLIP-01 | | /3 | | |
| M-CLIP-02 | | /3 | | |
| M-CLIP-03 | | /3 | | |
| M-CLIP-04 | | /3 | | |
| M-CLIP-05 | | /3 | | |
| M-KBD-01 | | /3 | | |
| M-KBD-02 | | /3 | | |
| M-KBD-03 | | /3 | | |
| M-KBD-04 | | /3 | | |
| M-KBD-05 | | /3 | | |
| M-KBD-06 | | /3 | | |
| M-VO-01 | | /3 | | |
| M-VO-02 | | /3 | | |
| M-VO-03 | | /3 | | |
| M-VO-04 | | /3 | | |
| M-WCAG-01 | | /1 | | |
| M-WCAG-02 | | /1 | | |
| M-WCAG-03 | | /1 | | |
| M-WCAG-04 | | /1 | | |

共 39 项。

---

## 六、判定与归档

1. **部分执行不算通过。** 只有 39 项全部填写且全部为 `pass`，本清单才构成 `TC-013` 的人工部分证据。任何一项为 `fail`、`blocked` 或留空，整轮判定为未通过，不得声明 `P-007` 完成，也不得开始 `P-008`。
2. **`blocked` 与 `fail` 等价。** `blocked` 只说明缺口的性质是「能力不存在」而非「能力有缺陷」，不改变判定。
3. **不得跨轮拼接结果。** 一轮结果必须来自同一个 app commit、同一台机器、同一个 macOS/WebView 版本。修复任何一项后必须重跑整份清单，不得只补跑失败项。
4. **不得以自动化替代。** 本清单任一项都不接受 jsdom/合成事件/无障碍模拟作为证据，理由见 1.5。`TC-013` 的 Deferred rationale 已固定为「VoiceOver/真实 IME 必须人工，不延期」。
5. **归档内容。** 填好的结果表、失败项的逐字记录与截图、所有 `xxd` 输出、WCAG 测点的 RGB 与比值，与 `D-015` 的性能原始 measurement artifact 一并作为 `P-007` 的验证证据保存。
6. **合同变更走 `spec` / `clarify`。** 若执行中发现必须修改本清单的通过条件（例如判定某个 `AC` 的期望本身写错），按 `D-016` 返回 `spec` 或 `clarify`，不得在本文件里就地放宽阈值。
