# MDX

**MDX 是一个本地桌面 Markdown 工作区编辑器。**

它把 Markdown 原生所见即所得编辑内核，和 Tauri 桌面壳结合起来，用来编辑本机文件夹里的 Markdown 文档。

## 功能

- 单根本地工作区
- 左侧文件树，显示文件夹、`.md` 和 `.markdown` 文件
- 多标签编辑，跟踪未保存状态
- 右侧标题目录，从当前文档的 H1-H6 实时生成
- 应用状态保存到 `~/.mdx/state.json`
- 图片优先保存到工作区 `.assets/`，异常时退回 `~/.mdx/assets`
- 提供 `mdx-cli`，支持本地自动化和 Agent 驱动编辑

## 范围

MDX 当前优先服务桌面端。本期不提供 Web 产品形态、Quick Look 扩展、自动更新流程、多根工作区、全文搜索和实时文件系统监听。

当前编辑器支持 `.md` 和 `.markdown` 文件。这个 MVP 不显示 `.mdx` 文件。

## 架构

- 前端：Next.js 16、React 19、TypeScript、Tailwind CSS
- 桌面壳：Tauri 2、Rust
- 编辑器适配：`@do-md/react`
- 代码高亮：Prism
- 测试：前端逻辑使用 Vitest，Tauri 侧工作区行为使用 Rust tests

前端负责工作区 UI 状态、标签页、标题目录解析、面板尺寸和编辑器集成。Rust/Tauri 负责受保护的文件系统访问、应用状态持久化、图片资产、废纸篓操作和本地 CLI socket。

## CLI

macOS 构建包含 `mdx-cli`，它通过 `~/.mdx/cli.sock` 连接正在运行的应用。

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
```

## 构建

### 开发用 Web Shell

```bash
npm install
npm run dev
```

然后打开 http://localhost:3000。

### 原生桌面应用

macOS 是当前 MVP 支持的原生目标。

```bash
npm install
npx tauri dev
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
