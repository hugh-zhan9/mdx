<p align="center">
  <img src="src-tauri/icons/icon.png" alt="MDX 应用图标" width="128" height="128">
</p>

# MDX

**MDX 是一个本地优先 Markdown 应用，提供单文档编辑和文件夹工作区两种模式。**

它把 Markdown 原生所见即所得编辑内核，和 Tauri 桌面壳结合起来，用来编辑本机文件夹和单个 Markdown 文档。

## 两种模式

- Document Mode：从 Finder 或系统“打开方式”打开单个 `.md` / `.markdown` 文件时进入。界面只包含 Markdown 编辑器和当前文档目录，不显示文件树、标签页或 LLM Wiki。
- Workspace Mode：直接启动 MDX、恢复最近工作区，或在应用内打开文件夹时进入。界面包含文件树、多标签、目录和可选 LLM Wiki 知识库能力。

Document Mode 不参与 `mdx-cli` 自动化，不恢复为最近工作区，也不支持 `.mdx`。

## 功能

- Document Mode：单 Markdown 文档编辑窗口，支持标题目录、保存、关闭前未保存确认和同级 `.assets/` 图片资产
- Workspace Mode：单根本地工作区
- Workspace Mode：左侧文件树，显示文件夹、`.md` 和 `.markdown` 文件
- Workspace Mode：多标签编辑，跟踪未保存状态
- Workspace Mode：右侧标题目录，从当前文档的 H1-H6 实时生成
- Workspace Mode：全文搜索 `.md` 和 `.markdown`，包含 `raw/` 目录
- Workspace Mode：默认搜索限制为单文件 2 MB、总结果 200 条、每个文件 20 条匹配
- Workspace Mode / Document Mode：文件外部变更监听；干净内容自动重载，脏内容显示冲突提示和只读差异视图
- 未保存 Markdown 正文会以明文草稿保存在 `~/.mdx/drafts/`
- 草稿在保存或丢弃后会删除，过期草稿会在 30 天后清理
- 应用状态保存到 `~/.mdx/state.json`
- 图片优先保存到当前文档或工作区的 `.assets/`，异常时退回 `~/.mdx/assets`
- Workspace Mode 提供 `mdx-cli`，支持本地自动化和 Agent 驱动编辑

## 范围

MDX 当前优先服务桌面端。当前应用不提供 Web 产品形态、Quick Look 扩展、自动更新流程、多根工作区、PDF/图片/二进制全文搜索，也不包含 LLM Wiki onboarding。

当前编辑器支持 `.md` 和 `.markdown` 文件。这个 MVP 不把 `.mdx` 作为 Document Mode 文件处理，也不在工作区文件树中显示 `.mdx` 文件。

## 架构

- 前端：Next.js 16、React 19、TypeScript、Tailwind CSS
- 桌面壳：Tauri 2、Rust
- 编辑器适配：`@do-md/react`
- 代码高亮：Prism
- 测试：前端逻辑使用 Vitest，Tauri 侧工作区行为使用 Rust tests

前端负责工作区 UI 状态、标签页、标题目录解析、面板尺寸和编辑器集成。Rust/Tauri 负责受保护的文件系统访问、应用状态持久化、图片资产、废纸篓操作和本地 CLI socket。

## CLI

macOS 构建包含 `mdx-cli`，它通过 `~/.mdx/cli.sock` 连接正在运行的 Workspace Mode 应用。

支持的命令包括：

```bash
mdx-cli new
mdx-cli list
mdx-cli open <path>
mdx-cli content [--tab <id>]
mdx-cli selection [--tab <id>]
mdx-cli insert [--tab <id>] <text>
mdx-cli save [--tab <id>]
mdx-cli focus [--tab <id>]
mdx-cli close [--tab <id>] [--force]
mdx-cli create-file <dir> [name]
mdx-cli create-folder <dir> <name>
mdx-cli rename <path> <new-name>
mdx-cli llm-wiki status
mdx-cli llm-wiki ingest <raw-path>
mdx-cli llm-wiki digest --title "..." <prompt...>
mdx-cli llm-wiki lint [--json]
mdx-cli llm-wiki query [--json] <question...>
mdx-cli llm-wiki search <query...>
mdx-cli memory status [--json]
mdx-cli memory init
mdx-cli memory repair [--rebuild-index]
mdx-cli memory index rebuild
mdx-cli memory thread save --source manual --title "..." --file <path>
mdx-cli memory add --title "..." --body "..."
mdx-cli memory recall [--json] <query...>
mdx-cli memory working get
mdx-cli memory inbox list
mdx-cli memory inbox accept <inbox-id>
mdx-cli memory distill --thread <thread-id>
mdx-cli memory capture import --source codex --file <path>
mdx-cli memory promote <thread-id|memory-id|path>
mdx-cli memory agent setup [--all|--codex|--claude|--cursor] [--no-hooks] [--dry-run]
mdx-cli memory export --output <dir>
mdx-cli memory import --input <dir> --dry-run
mdx-cli memory --root <workspace> status
mdx-cli serve --workspace <workspace> --port 14243
mdx-mcp --workspace <workspace>
```

Memory 命令管理 `memory/` 和 `.mdx/` 下的 Markdown 原生记忆记录。它们可以通过当前 Workspace Mode socket 运行，也可以使用 `mdx-cli memory --root <workspace> ...` 无界面运行。

正式打包会随应用带上 `mdx-cli` 和 `mdx-mcp` sidecar。Codex、Claude、Cursor 的 Agent 集成需要用户在 Memory Settings 面板或 `mdx-cli memory --root <workspace> agent setup ...` 中主动配置。

Memory 的完整使用说明见 [docs/memory-usage.md](docs/memory-usage.md)。

LLM Wiki 的 CLI 仍然只通过 socket 工作，并始终针对当前 Workspace Mode root。只有 Memory 命令支持 `--root` 无界面运行。

## 构建

### 桌面开发

```bash
npm install
npx tauri dev
```

Tauri 会自动启动 Next.js 渲染层开发服务。

### 渲染层调试

```bash
npm run dev
```

该命令只启动 Next.js renderer。在浏览器中打开 `http://localhost:3000` 只适合调试 UI，不是独立 Web 产品入口，也不能使用文件夹选择、文件系统命令、LLM Wiki 后端命令和本地 CLI socket 等桌面能力。

### 原生目标

macOS 是当前 MVP 支持的原生目标。

```bash
npm install
npx tauri build
```

## 验证

```bash
npm run lint
npm run test
cd src-tauri && cargo test
```

## 许可

本仓库的应用层与辅助库采用 MIT 协议，见 [LICENSE](LICENSE)。

`.packages/@do-md/dist/` 下的编译版编辑器内核使用其单独许可分发。该内核的商业使用需要事先获得书面授权。
