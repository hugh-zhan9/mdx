# MDX Workspace File Tree And Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** [MDX工作区文件树与标题目录需求设计文档.md](../design/MDX工作区文件树与标题目录需求设计文档.md)

**Goal:** 在 `/Users/hugh/project/mdx` 落地一个仅面向桌面的 MDX 编辑器：单根工作区、多标签页、左侧文件夹树、右侧文档标题目录、工作区状态恢复、图片资产管理和 `mdx-cli`。

**Architecture:** 复制 `ref-editor` 作为起点，但只保留桌面壳和 `@do-md/react` 黑盒编辑内核。前端改成单窗口工作区壳，Rust/Tauri 负责文件树、状态持久化、废纸篓、CLI socket 和命令边界；前端负责 tabs、outline、面板折叠与编辑器适配。Web、Quick Look、更新器和多窗口模型都从 MVP 中移除。

**Tech Stack:** Next.js 16, React 19, Tauri 2, TypeScript, Rust, `@do-md/react`, `prismjs`, `nanoid`, `vitest`, `tempfile`, `trash`.

---

## 文件结构

先锁定这次迁移要形成的文件边界，后续每个任务只动自己负责的文件。

- 应用入口：`app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/prism-themes.css`
- 工作区前端：`features/workspace/components/*`, `features/workspace/lib/*`, `features/workspace/index.ts`
- 编辑器适配：`features/editor/components/*`, `features/editor/hooks/*`, `features/editor/lib/*`, `features/editor/index.ts`
- 通用前端：`common/lib/tauri.ts`, `common/lib/platform.ts`, `common/lib/prism.ts`, `common/lib/use-latest.ts`, `common/lib/image-storage.ts`
- Tauri 后端：`src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/src/cli_server.rs`, `src-tauri/src/bin/mdx_cli.rs`, `src-tauri/src/*.rs` 新模块
- Tauri 配置：`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`
- 类型声明：`types/do-md-react.d.ts`
- 测试：`features/workspace/lib/*.test.ts`, `src-tauri/src/*_tests.rs` 或模块内 `#[cfg(test)]`
- 删除项：`app/editor/page.tsx`, `app/preview/page.tsx`, `features/editor/**`, `features/landing/**`, `features/preview/**`, `features/updater/**`, `src-tauri/preview-extension/**`, 旧参考项目专属脚本和路由入口

## 任务 1: 迁移骨架并去掉 Web 壳

**Files:**
- Create: `features/workspace/components/workspace-app.tsx`
- Create: `features/workspace/index.ts`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `app/prism-themes.css`
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: `tsconfig.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/lib.rs`
- Delete: `app/editor/page.tsx`, `app/preview/page.tsx`, `features/editor/**`, `features/landing/**`, `features/preview/**`, `features/updater/**`, `src-tauri/preview-extension/**`

- [ ] **Step 1: 复制参考项目并保留 mdx 现有文档**

Run:
```bash
cd /Users/hugh/project
rsync -a \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
  --exclude out \
  --exclude target \
  --exclude src-tauri/preview-extension \
  ref-editor/ mdx/
```
Expected: `mdx/` 变成可编辑项目骨架，但 `.loopx/` 和 `docs/` 仍然保留。

- [ ] **Step 1.1: 初始化 mdx git 仓库**

Run:
```bash
cd /Users/hugh/project/mdx
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init
```
Expected: `/Users/hugh/project/mdx` 可以执行后续 `git commit`。

- [ ] **Step 2: 改成单窗口桌面入口**

把 `app/page.tsx` 改成直接渲染 `WorkspaceApp`，不要再做 landing、/editor、/preview 路由分流。`app/layout.tsx` 的 metadata 改成 `MDX`，页面基础主题保持现有 light/dark 机制即可。

```tsx
import { WorkspaceApp } from "@/features/workspace";

export default function Page() {
    return <WorkspaceApp />;
}
```

Expected: 根路由就是工作区壳，没有 Web 营销页。

- [ ] **Step 3: 让 Tauri 直接打开根路由**

把 `src-tauri/tauri.conf.json` 中窗口 `url` 改为 `/`，`title` 改为 `MDX`，`productName` 改为 `MDX`，`identifier` 改为 `com.hugh.mdx`。删除 updater 配置块和 preview extension 相关构建路径。

Expected: `tauri dev` 打开后直接进入工作区壳，不再经过 `/editor`。

- [ ] **Step 4: 清理旧参考项目专属依赖和脚本**

在 `package.json` 中移除 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-deep-link`、旧发布脚本和 Web 保存相关脚本，增加 `test` 脚本指向 `vitest run`，并把 `vitest` 加入 devDependencies。`dexie` 先保留到任务 4，因为复制过来的 `common/lib/image-storage.ts` 在替换前仍会被 TypeScript 检查。`tsconfig.json` 里保留 `@do-md/react` 路径映射，删除任何只服务于 Web 产品页的入口依赖。

Expected: npm 依赖只保留桌面编辑器需要的包。

- [ ] **Step 5: 最小化 Rust 壳**

更新 `src-tauri/src/main.rs` 调用新的库名；`src-tauri/src/lib.rs` 先保留可编译的桌面窗口壳和菜单框架，但不要再引用旧的 Web 入口、preview extension 或 updater plugin。`src-tauri/Cargo.toml` 先删掉 updater/deep-link 依赖，保留 dialog/process。

Expected: `cargo check` 能通过到桌面壳层面。

- [ ] **Step 6: 验证骨架可启动**

Run:
```bash
cd /Users/hugh/project/mdx
npm install
npm run lint
npm run build
cd src-tauri && cargo check
```
Expected: `npm run build` 生成 `out/`，`cargo check` 退出码 0。

- [ ] **Step 7: 提交**

```bash
git add -A app package.json src-tauri tsconfig.json next.config.ts features
git commit -m "feat: bootstrap mdx desktop shell"
```

## 任务 2: 先把工作区纯逻辑和测试跑起来

**Files:**
- Create: `features/workspace/lib/path.ts`
- Create: `features/workspace/lib/tree-filter.ts`
- Create: `features/workspace/lib/outline.ts`
- Create: `features/workspace/lib/workspace-reducer.ts`
- Create: `features/workspace/lib/types.ts`
- Create: `features/workspace/lib/path.test.ts`
- Create: `features/workspace/lib/tree-filter.test.ts`
- Create: `features/workspace/lib/outline.test.ts`
- Create: `features/workspace/lib/workspace-reducer.test.ts`
- Modify: `package.json`
- Modify: `features/workspace/index.ts`

- [ ] **Step 1: 写失败测试**

先把这些纯函数测试写出来，再补实现：

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdownOutline } from "./outline";
import { filterTreeByName } from "./tree-filter";
import { createWorkspaceState, workspaceReducer } from "./workspace-reducer";
import type { FileTreeNode } from "./types";

const sampleTree: FileTreeNode[] = [
    {
        kind: "folder",
        name: "Drafts",
        path: "/tmp/ws/Drafts",
        children: [
            {
                kind: "file",
                name: "Idea.md",
                path: "/tmp/ws/Drafts/Idea.md",
            },
        ],
    },
    {
        kind: "file",
        name: "Archive.md",
        path: "/tmp/ws/Archive.md",
    },
];

describe("parseMarkdownOutline", () => {
    it("parses h1-h6 in source order", () => {
        const headings = parseMarkdownOutline("# One\n\n## Two\n### Three");
        expect(headings.map((h) => h.text)).toEqual(["One", "Two", "Three"]);
        expect(headings.map((h) => h.level)).toEqual([1, 2, 3]);
    });
});

describe("filterTreeByName", () => {
    it("keeps matching folders and descendants", () => {
        const result = filterTreeByName(sampleTree, "draft");
        expect(result).toMatchObject([{ name: "Drafts" }]);
    });
});

describe("workspaceReducer", () => {
    it("marks a tab dirty after content changes", () => {
        const initialState = createWorkspaceState("/tmp/ws");
        const opened = workspaceReducer(initialState, {
            type: "tab/opened",
            tab: {
                tabId: "tab-1",
                path: "/tmp/ws/Drafts/Idea.md",
                title: "Idea.md",
                dirty: false,
                needsRenameOnFirstSave: false,
            },
        });
        const next = workspaceReducer(opened, {
            type: "tab/contentChanged",
            tabId: "tab-1",
            markdown: "hello",
        });
        expect(next.tabs["tab-1"].dirty).toBe(true);
    });
});
```

Expected: `vitest` 先报找不到实现或断言失败。

- [ ] **Step 2: 运行测试确认先红后绿**

Run:
```bash
cd /Users/hugh/project/mdx
npm run test -- features/workspace/lib/outline.test.ts
```
Expected: FAIL，原因是 `outline.ts` 还没实现。

- [ ] **Step 3: 实现纯函数**

实现 `path.ts` 的路径规范化、根目录校验、Markdown 扩展名判断；`tree-filter.ts` 的名称过滤与高亮片段；`outline.ts` 暴露 `parseMarkdownOutline` 完成 `#` 到 `######` 解析；`workspace-reducer.ts` 暴露 `createWorkspaceState` 和 `workspaceReducer`，负责 tabs、panel、active tab、dirty、search 状态更新。`types.ts` 只放稳定的数据结构和事件类型。

Expected: 这些函数都可以在不依赖 DOM 和 Tauri 的情况下运行。

- [ ] **Step 4: 跑测试到绿色**

Run:
```bash
cd /Users/hugh/project/mdx
npm run test
```
Expected: `vitest` 通过，输出 `PASS`。

- [ ] **Step 5: 提交**

```bash
git add package.json features/workspace
git commit -m "feat: add workspace state primitives"
```

## 任务 3: Rust 工作区文件系统命令

**Files:**
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/path_guard.rs`
- Create: `src-tauri/src/workspace_fs.rs`
- Create: `src-tauri/src/workspace_fs_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 写 Rust 失败测试**

在 `path_guard.rs` 和 `workspace_fs.rs` 里补这些测试：

```rust
use tempfile::tempdir;

#[test]
fn rejects_paths_outside_workspace_root() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_file = outside.path().join("note.md");
    std::fs::write(&outside_file, "# Outside").unwrap();

    let err = canonicalize_in_workspace(root.path(), &outside_file).unwrap_err();
    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
fn untitled_name_skips_existing_files() {
    let dir = tempdir().unwrap();
    std::fs::write(dir.path().join("Untitled.md"), "").unwrap();
    std::fs::write(dir.path().join("Untitled1.md"), "").unwrap();

    let name = next_untitled_name(dir.path()).unwrap();
    assert_eq!(name, "Untitled2.md");
}

#[test]
fn scan_workspace_returns_only_markdown_and_folders() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("docs")).unwrap();
    std::fs::write(root.path().join("docs").join("a.md"), "# A").unwrap();
    std::fs::write(root.path().join("b.markdown"), "# B").unwrap();
    std::fs::write(root.path().join("image.png"), [1, 2, 3]).unwrap();
    std::fs::create_dir(root.path().join("node_modules")).unwrap();
    std::fs::write(root.path().join("node_modules").join("hidden.md"), "# Hidden").unwrap();

    let scanned = scan_workspace(root.path().to_string_lossy().into_owned()).unwrap();
    let names = collect_tree_names(&scanned.nodes);
    assert_eq!(names, vec!["docs", "a.md", "b.markdown"]);
}

#[test]
fn scan_workspace_marks_large_trees_as_truncated() {
    let root = tempdir().unwrap();
    for i in 0..6 {
        std::fs::write(root.path().join(format!("note-{i}.md")), "# Note").unwrap();
    }

    let scanned = scan_workspace_with_limit(
        root.path().to_string_lossy().into_owned(),
        5,
    )
    .unwrap();
    assert!(scanned.truncated);
    assert_eq!(scanned.entry_count, 5);
    assert!(scanned.warnings.iter().any(|w| w.contains("too large")));
}

#[test]
#[cfg(target_os = "macos")]
fn trash_path_uses_macos_trash() {
    let root = tempdir().unwrap();
    let file = root.path().join("delete-me.md");
    std::fs::write(&file, "# Delete").unwrap();

    trash_path(
        root.path().to_string_lossy().into_owned(),
        file.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert!(!file.exists());
}
```

Expected: 测试先失败，说明文件系统边界还没实现。

- [ ] **Step 2: 实现路径守卫和目录扫描**

在 `path_guard.rs` 里实现 `canonicalize_in_workspace`, `sanitize_filename`, `is_allowed_markdown_file`, `is_ignored_dir`。在 `workspace_fs.rs` 里实现递归扫描内核 `scan_workspace_with_limit`，并让 Tauri command `scan_workspace` 使用默认阈值 5000。在 `workspace_fs.rs` 里实现：

- `scan_workspace(root_path)`
- `read_markdown_file(path)`
- `write_markdown_file(path, content)`
- `create_markdown_file(root_path, parent_dir, name, temporary_untitled)`
- `create_folder(root_path, parent_dir, name)`
- `rename_path(root_path, from_path, new_name)`
- `move_path(root_path, from_path, target_dir)`
- `trash_path(root_path, path)`

目录扫描只返回文件夹、`.md`、`.markdown`，跳过 `node_modules`、`.git`、`dist`、`build`、`.next`、`target`。
默认 `maxTreeEntries` 为 5000，超过后返回 `truncated: true`、`entryCount` 和 warnings，不继续深层扫描。

Expected: 这些命令都只在当前 root 内生效，越界直接报结构化错误码。

- [ ] **Step 3: 接入废纸篓 crate**

在 `Cargo.toml` 里加入 `trash` 和 `tempfile`。`trash_path` 只调用 macOS 废纸篓，不做永久删除。

Expected: 删除命令在失败时返回 `trash_failed`，不会把文件直接 `remove_file`。

- [ ] **Step 4: 绑定到 Tauri command**

在 `src-tauri/src/lib.rs` 注册这些 command，并给它们统一的 `error_code`。把旧的单窗口 `write_file` / `read_file` / `set_window_path` 迁移到新的 workspace API，不要再依赖 `WindowFiles` 那套单文档状态。

Expected: 前端可以通过 `invoke` 完成文件树所有写操作。

- [ ] **Step 5: 跑 Rust 测试**

Run:
```bash
cd /Users/hugh/project/mdx/src-tauri
cargo test
```
Expected: `test result: ok`。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/src
git commit -m "feat: add workspace filesystem commands"
```

## 任务 4: 状态持久化和图片资产

**Files:**
- Create: `src-tauri/src/state_store.rs`
- Create: `src-tauri/src/assets.rs`
- Create: `src-tauri/src/state_store_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `features/workspace/lib/types.ts`
- Modify: `common/lib/image-storage.ts`
- Modify: `common/lib/tauri.ts`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试**

补两个方向的测试：

```rust
use tempfile::tempdir;

#[test]
fn loads_empty_state_when_state_file_is_missing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");

    let state = load_state_from_path(&path).unwrap();
    assert_eq!(state.state_version, 1);
    assert!(state.recent_workspace_root.is_none());
    assert!(state.workspaces.is_empty());
}

#[test]
fn backs_up_corrupt_state_file_before_resetting() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    std::fs::write(&path, "{not json").unwrap();

    let state = load_state_from_path(&path).unwrap();
    assert_eq!(state.state_version, 1);
    assert!(dir.path().read_dir().unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("state.json.corrupt.")
    }));
}
```

```ts
import { describe, expect, it, vi } from "vitest";
import { storeImageForWorkspace } from "@/common/lib/image-storage";

describe("storeImage", () => {
    it("uses workspace .assets first and falls back to ~/.mdx/assets", async () => {
        const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
        const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
            calls.push({ cmd, args });
            return {
                markdownPath: ".assets/abc123.png",
                storedPath: "/tmp/ws/.assets/abc123.png",
                usedFallback: false,
            };
        });
        const file = new File([new Uint8Array([1, 2, 3])], "paste.png", {
            type: "image/png",
        });

        const stored = storeImageForWorkspace(file, {
            rootPath: "/tmp/ws",
            currentFilePath: "/tmp/ws/doc.md",
            invoke,
        });

        await expect(stored).resolves.toMatchObject({
            url: ".assets/abc123.png",
            altText: "paste.png",
        });
        expect(calls[0].cmd).toBe("save_image_asset");
    });
});
```

Expected: 状态恢复和图片落盘逻辑先红后绿。

- [ ] **Step 2: 实现 `~/.mdx/state.json`**

实现 `load_app_state` / `save_app_state`，状态内容保存最近根目录、每个 workspace 的 tabs、活动 tab、侧栏折叠状态、宽度和窗口尺寸。写入采用原子覆盖；损坏文件先备份再重置为空状态。

Expected: 启动时能恢复最近一次工作区和上次打开的标签页。

- [ ] **Step 3: 实现图片资产目录**

在前端 `common/lib/image-storage.ts` 里暴露 `storeImageForWorkspace`，把桌面端图片写入逻辑改成：

- 优先 `${rootPath}/.assets/`
- Markdown 内写相对路径 `.assets/<hash>.<ext>`
- 无工作区或写入失败时回退到 `~/.mdx/assets/`

`common/lib/tauri.ts` 删除 updater/web-only 的懒加载入口，保留 core/dialog/process。

Expected: 粘贴/拖入图片后，Markdown 里是可移植的相对路径。

- [ ] **Step 4: 接入 Rust 端图片写入命令**

在 `assets.rs` 中实现 hash 去重、目录创建和文件写入；如果目标文件已经存在，直接复用路径，不重复写入。

Expected: 同一张图不会在资产目录里重复生成多个文件。

- [ ] **Step 5: 跑验证**

Run:
```bash
cd /Users/hugh/project/mdx
npm run build
cd src-tauri && cargo test
```
Expected: 前端构建通过，Rust 状态和资产测试通过。

- [ ] **Step 6: 提交**

```bash
git add common src-tauri package.json
git commit -m "feat: persist workspace state and assets"
```

## 任务 5: 工作区外壳、面板和恢复

**Files:**
- Create: `features/workspace/components/workspace-shell.tsx`
- Create: `features/workspace/components/file-tree-panel.tsx`
- Create: `features/workspace/components/tab-strip.tsx`
- Create: `features/workspace/components/editor-stage.tsx`
- Create: `features/workspace/components/outline-panel.tsx`
- Create: `features/workspace/hooks/use-panel-resize.ts`
- Create: `features/workspace/hooks/use-workspace-bootstrap.ts`
- Modify: `features/workspace/components/workspace-app.tsx`
- Modify: `features/workspace/index.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: 把工作区状态挂到根组件**

`WorkspaceApp` 负责：

- 读取 `load_app_state`
- 如果有最近工作区则自动恢复
- 没有最近工作区时弹文件夹选择器
- 把 root、tabs、activeTab、panel 状态传给 `WorkspaceShell`
- 读取和保存最近窗口尺寸，恢复失败时使用 Tauri 配置默认尺寸

Expected: 启动后不是空白页，而是可以直接恢复工作区。

- [ ] **Step 2: 实现三栏壳**

`WorkspaceShell` 使用稳定的 grid/flex 布局：

- 左侧文件夹树默认展开，可折叠、可拖拽改宽
- 中间编辑区
- 右侧标题目录默认展开，可折叠、可拖拽改宽

布局不要做移动端适配，也不要用卡片包住整个页面。

Expected: 左右侧栏折叠后，编辑区能自然扩张。

- [ ] **Step 3: 接入侧栏尺寸持久化**

在 `use-panel-resize.ts` 里保存 `leftCollapsed`, `rightCollapsed`, `leftWidth`, `rightWidth` 到 workspace state，切换工作区时按 workspace 记忆恢复。

Expected: 重新打开同一个根目录时，侧栏状态和宽度保持不变。

- [ ] **Step 4: 跑前端构建**

Run:
```bash
cd /Users/hugh/project/mdx
npm run build
```
Expected: `out/` 生成成功，没有路由或 hydration 报错。

- [ ] **Step 5: 提交**

```bash
git add features/workspace app/page.tsx
git commit -m "feat: add workspace shell layout"
```

## 任务 6: 左侧文件夹树

**Files:**
- Create: `features/workspace/components/file-tree-node.tsx`
- Create: `features/workspace/components/file-tree-toolbar.tsx`
- Create: `features/workspace/components/file-tree-context-menu.tsx`
- Create: `features/workspace/lib/file-tree.ts`
- Create: `features/workspace/lib/file-tree.test.ts`
- Modify: `features/workspace/components/file-tree-panel.tsx`
- Modify: `features/workspace/lib/tree-filter.ts`

- [ ] **Step 1: 写文件树测试**

增加覆盖这些行为的测试：

- 只显示文件夹、`.md`、`.markdown`
- 名称搜索过滤后保留命中的父节点
- 匹配项高亮
- 空文件夹保留
- 同名文件冲突返回错误

Expected: 过滤和排序逻辑在 UI 之前就可验证。

- [ ] **Step 2: 实现文件树数据转换**

`file-tree.ts` 把 Rust 返回的树转成前端可渲染结构，排序规则固定为：文件夹在前、文件在后，同级自然排序，不区分大小写。`.assets` 作为工作区资产目录保留在树里，但默认不展开图片内容。

Expected: 左侧树顺序稳定，不会因为扫描顺序抖动。

- [ ] **Step 3: 加上操作入口**

在 `FileTreePanel` 里接上：

- 选择/切换根文件夹
- 新建文件夹
- 新建 Markdown 文件
- 重命名文件/文件夹
- 删除到废纸篓，删除前确认
- 手动刷新
- 拖拽移动
- 名称搜索

Copy/paste、批量操作和全文搜索都不做。

Expected: 左侧面板可以完成全部 MVP 文件树操作。

- [ ] **Step 4: 跑测试和构建**

Run:
```bash
cd /Users/hugh/project/mdx
npm run test -- features/workspace/lib/file-tree.test.ts
npm run build
```
Expected: 测试通过，构建通过。

- [ ] **Step 5: 提交**

```bash
git add features/workspace
git commit -m "feat: add workspace file tree"
```

## 任务 7: 标签页、编辑器适配和首次保存命名

**Files:**
- Create: `features/editor/components/editor-kernel-adapter.tsx`
- Create: `features/editor/components/editor-pane.tsx`
- Create: `features/editor/hooks/use-editor-bridge.ts`
- Create: `features/editor/lib/editor-types.ts`
- Create: `features/editor/lib/tab-save.ts`
- Create: `features/editor/lib/tab-save.test.ts`
- Modify: `features/workspace/components/tab-strip.tsx`
- Modify: `features/workspace/components/editor-stage.tsx`
- Modify: `features/workspace/lib/workspace-reducer.ts`
- Modify: `types/do-md-react.d.ts`

- [ ] **Step 1: 写 tab 保存测试**

补这些测试：

```ts
describe("resolveUntitledName", () => {
    it("uses Untitled.md then Untitled1.md, Untitled2.md", () => {
        expect(resolveUntitledName([])).toBe("Untitled.md");
        expect(resolveUntitledName(["Untitled.md"])).toBe("Untitled1.md");
    });
});

describe("requiresRenameOnFirstSave", () => {
    it("prompts for a formal file name before first write", () => {
        const result = planFirstSave({
            currentPath: "/tmp/ws/Untitled.md",
            requestedName: "Notes.md",
            existingNames: ["Untitled.md"],
            needsRenameOnFirstSave: true,
        });
        expect(result).toEqual({
            kind: "rename_then_save",
            newPath: "/tmp/ws/Notes.md",
        });
    });
});
```

Expected: 新建 tab 的第一次保存行为先被测试固定下来。

- [ ] **Step 2: 包装 `@do-md/react`**

在 `editor-kernel-adapter.tsx` 里集中封装：

- `editor provider`
- `toMarkdown`
- `useEditor`
- `useEditorStoreApi`
- `resetMD`
- `insertText`
- `insertImage`
- `getSelectionState`

不要把黑盒 API 散落到多个组件里。

Expected: 后续替换编辑核心时，只动这一层。

- [ ] **Step 3: 实现多标签页**

`TabStrip` 只表示真实文件 tab，不允许未落盘草稿 tab。打开文件时按 canonical path 去重；已打开就切换，不重复开 tab。dirty tab 可以直接切换，关闭时弹保存/放弃/取消。

Expected: 同一个文件永远只有一个 tab 实例。

- [ ] **Step 4: 实现首次保存命名**

`tab-save.ts` 暴露 `resolveUntitledName` 和 `planFirstSave`，负责：

- `Untitled.md` 序列生成
- 首次保存时弹文件名输入
- 命名冲突阻止并保留 dirty
- 保存成功后把 tab 从临时名切成正式路径

Expected: 先创建真实文件，再让用户给它正式命名。

- [ ] **Step 5: 跑测试和构建**

Run:
```bash
cd /Users/hugh/project/mdx
npm run test -- features/editor/lib/tab-save.test.ts
npm run build
```
Expected: tab 保存和命名逻辑通过，前端构建通过。

- [ ] **Step 6: 提交**

```bash
git add features/editor features/workspace types/do-md-react.d.ts
git commit -m "feat: add tab manager and editor adapter"
```

## 任务 8: 右侧标题目录

**Files:**
- Create: `features/workspace/lib/outline-scroll.ts`
- Create: `features/workspace/lib/outline-scroll.test.ts`
- Modify: `features/workspace/components/outline-panel.tsx`
- Modify: `features/editor/components/editor-pane.tsx`
- Modify: `features/workspace/components/editor-stage.tsx`

- [ ] **Step 1: 写滚动定位测试**

增加对 heading 定位的测试，覆盖：

- 同名标题按出现顺序匹配
- 找不到 heading 时不抛异常
- 点击目录项会请求滚动对应 heading

Expected: outline 的定位逻辑有单测。

- [ ] **Step 2: 接入实时 outline 解析**

编辑内容变化时，前端从当前 Markdown 文本解析 H1-H6，渲染右侧目录。目录点击后按 heading index 找到对应 DOM 节点并滚动到视口内。

Expected: 右侧目录跟着当前 tab 内容实时变化。

- [ ] **Step 3: 关闭侧栏时保持状态**

右侧目录折叠后要保留当前宽度，重新展开时恢复原值，不要重置布局。

Expected: 用户切换面板不会丢尺寸。

- [ ] **Step 4: 跑验证**

Run:
```bash
cd /Users/hugh/project/mdx
npm run test -- features/workspace/lib/outline-scroll.test.ts
npm run build
```
Expected: outline 测试通过，构建通过。

- [ ] **Step 5: 提交**

```bash
git add features/workspace features/editor
git commit -m "feat: add document outline panel"
```

## 任务 9: CLI socket 与 `mdx-cli`

**Files:**
- Create: `src-tauri/src/cli_protocol.rs`
- Create: `src-tauri/src/cli_server.rs`
- Create: `src-tauri/src/bin/mdx_cli.rs`
- Create: `src-tauri/src/cli_protocol_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `features/workspace/lib/types.ts`
- Modify: `features/workspace/components/workspace-app.tsx`

- [ ] **Step 1: 写协议测试**

先把请求/响应协议测试钉住：

```rust
#[test]
fn parses_open_and_save_commands() {
    let open: CliRequest = serde_json::from_str(
        r#"{"cmd":"open","path":"/tmp/ws/a.md"}"#,
    )
    .unwrap();
    assert!(matches!(open, CliRequest::Open { path } if path == "/tmp/ws/a.md"));

    let save: CliRequest = serde_json::from_str(
        r#"{"cmd":"save","tab_id":"tab-1"}"#,
    )
    .unwrap();
    assert!(matches!(save, CliRequest::Save { tab_id } if tab_id == Some("tab-1".into())));
}

#[test]
fn rejects_paths_outside_active_workspace() {
    let snapshot = WorkspaceSnapshot {
        root_path: Some("/tmp/ws".into()),
        active_tab_id: Some("tab-1".into()),
        tabs: vec![],
    };
    let err = resolve_cli_path(&snapshot, "/tmp/other/a.md").unwrap_err();
    assert_eq!(err.error_code(), "outside_workspace");
}

#[test]
fn list_returns_windows_workspace_tabs_and_dirty_state() {
    let snapshot = WorkspaceSnapshot {
        root_path: Some("/tmp/ws".into()),
        active_tab_id: Some("tab-1".into()),
        tabs: vec![TabSnapshot {
            tab_id: "tab-1".into(),
            path: "/tmp/ws/a.md".into(),
            title: "a.md".into(),
            dirty: true,
        }],
    };
    let response = list_response_from_snapshot(&snapshot);
    assert!(response.ok);
    assert_eq!(response.tabs[0].tab_id, "tab-1");
    assert!(response.tabs[0].dirty);
}
```

Expected: CLI 请求和 JSON 响应格式先定住。

- [ ] **Step 2: 实现 socket server**

`cli_protocol.rs` 定义 `CliRequest`, `CliResponse`, `WorkspaceSnapshot`, `TabSnapshot`, `resolve_cli_path`, `list_response_from_snapshot`。`~/.mdx/cli.sock` 使用 Unix socket + JSON lines。支持：

- `new`
- `open <path>`
- `list`
- `content [--tab <id>]`
- `selection [--tab <id>]`
- `insert [--tab <id>] <text>`
- `save [--tab <id>]`
- `focus [--tab <id>]`
- `close [--tab <id>] [--force]`
- `create-file`
- `create-folder`
- `rename`

删除命令不做。

Expected: CLI 能驱动工作区、tabs 和编辑器事件。

- [ ] **Step 3: 更新前端事件桥**

前端要能接收 Rust 发来的 `cli-insert`、`cli-open-file`、`cli-focus-tab`、`cli-save-tab` 之类事件，并把当前 workspace/tab/content/selection/dirtiness 快照推回 Rust，给 `mdx-cli list/content/selection` 使用。

Expected: CLI 查询内容时拿到的是当前活动 tab 的实时状态。

- [ ] **Step 4: 实现 CLI 可执行文件**

把二进制名字改为 `mdx-cli`，启动时优先连接 socket；如果 app 没开，按桌面平台规则拉起 MDX，再等待 socket 可用。

Expected: `mdx-cli` 可以直接从终端启动和控制应用。

- [ ] **Step 5: 跑 CLI 验证**

Run:
```bash
cd /Users/hugh/project/mdx/src-tauri
cargo build --bin mdx-cli
./target/debug/mdx-cli new
./target/debug/mdx-cli list
```
Expected: 二进制可编译，`list` 返回 JSON，`new` 返回窗口/应用已就绪。

- [ ] **Step 6: 提交**

```bash
git add src-tauri features/workspace
git commit -m "feat: add mdx cli socket protocol"
```

## 任务 10: 菜单、关闭保护和最终清理

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `common/lib/tauri.ts`
- Modify: `common/lib/image-storage.ts`
- Modify: `package.json`
- Delete: `features/landing/**`, `features/preview/**`, `features/updater/**`, `src-tauri/preview-extension/**`, `app/editor/page.tsx`, `app/preview/page.tsx`

- [ ] **Step 1: 接通桌面菜单**

菜单保留：

- 切换根文件夹
- 新建文件夹
- 新建 Markdown 文件
- 重命名
- 删除到废纸篓
- 刷新
- 保存
- 关闭 tab

关闭 dirty tab、切换根文件夹、关闭窗口时都要弹确认。

Expected: 桌面交互和文件树操作入口一致。

- [ ] **Step 2: 清掉最终残留的 Web 路由和旧逻辑**

确认没有任何 Web landing、URL 打开、GitHub README 加载、Quick Look、updater、旧编辑器窗口 状态代码还在生产路径里。`common/lib/image-storage.ts` 只保留桌面/工作区资产逻辑。

Expected: 产品形态只剩桌面工作区。

- [ ] **Step 3: 做一次全量回归**

Run:
```bash
cd /Users/hugh/project/mdx
npm run lint
npm run test
npm run build
cd src-tauri && cargo fmt --check && cargo test && cargo check
```
Expected: 所有命令退出码 0。

- [ ] **Step 4: 做一次桌面手工烟测**

使用一个临时 fixture 工作区验证：

1. 启动后自动恢复最近工作区
2. 没有最近工作区时能选择文件夹
3. 左侧树只显示文件夹、`.md`、`.markdown`
4. 新建 `Untitled.md` 后第一次保存要求正式命名
5. 右侧标题目录随编辑变化
6. `mdx-cli list/content/selection/save/open` 可用

Expected: 关键用户路径都可以走通。

- [ ] **Step 5: 提交**

```bash
git add .
git commit -m "feat: finish mdx workspace editor"
```

## 自检清单

- [x] 计划只基于已批准的设计文档，没有重新决定产品边界
- [x] 每个任务都列出了具体文件
- [x] 每个任务都有测试或验证命令
- [x] 计划覆盖了工作区、文件树、tabs、outline、图片资产、CLI、状态持久化和桌面壳
- [x] 没有引入全文搜索、实时监听、Web 产品、Quick Look、多根工作区、永久删除或未落盘草稿 tab
