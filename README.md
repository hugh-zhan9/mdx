<p align="center">
  <img src="src-tauri/icons/icon.png" alt="MDX app icon" width="128" height="128">
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

# MDX

**MDX is a local-first Markdown app with two modes: single-document editing and folder workspaces.**

It combines a Markdown-native editing kernel with a Tauri desktop shell for working with local folders and individual Markdown documents.

## Modes

- Document Mode: opens when Finder or the system “Open With” flow launches a single `.md` / `.markdown` file. The window contains only the Markdown editor and the current document outline, without the file tree, tabs, or LLM Wiki.
- Workspace Mode: opens when you launch MDX directly, restore the recent workspace, or open a folder inside the app. The window contains the file tree, tabs, outline, and optional LLM Wiki knowledge-base features.

Document Mode is not controlled by `mdx-cli`, does not restore the recent workspace, and does not support `.mdx`.

## Features

- Document Mode: lightweight single Markdown document window with outline, save, dirty close confirmation, and sibling `.assets/` image assets
- Workspace Mode: single-root workspace for local Markdown notes
- Workspace Mode: left file tree for folders, `.md`, and `.markdown` files
- Workspace Mode: multi-tab editing with dirty-state tracking
- Workspace Mode: right outline panel generated from H1-H6 headings
- Workspace Mode: full-text search across `.md` and `.markdown`, including `raw/`
- Workspace Mode: default search limits of 2 MB per file, 200 total results, and 20 matches per file
- Workspace Mode and Document Mode: external file watching; clean content auto-reloads while dirty content shows a conflict prompt and read-only diff
- Unsaved Markdown bodies are stored as plaintext drafts under `~/.mdx/drafts/`
- Drafts are deleted after save/discard and expired drafts are cleaned after 30 days
- Local app state saved under `~/.mdx/state.json`
- Image assets saved into the current document or workspace `.assets/` directory, with a global fallback under `~/.mdx/assets`
- `mdx-cli` for Workspace Mode local automation and agent-driven editing

## Scope

MDX is desktop-first. The current app does not provide a web product, Quick Look extension, an auto-update flow, multi-root workspaces, PDF/image/binary full-text search, or LLM Wiki onboarding.

The editor currently supports `.md` and `.markdown` files. This MVP does not treat `.mdx` as a Document Mode file and does not display `.mdx` files in the workspace file tree.

## Architecture

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Desktop shell: Tauri 2 and Rust
- Editor kernel: self-owned Markdown-native editing kernel under `packages/mdx-editor/`
- Syntax highlighting: Prism
- Tests: Vitest for frontend logic, Rust tests for Tauri-side workspace behavior

The frontend owns workspace UI state, tabs, outline parsing, panel sizing, and editor integration. Rust/Tauri owns protected file-system access, app-state persistence, image assets, trash operations, and the local CLI socket.

## CLI

The macOS build includes `mdx-cli`, which talks to the running Workspace Mode app over a local Unix socket at `~/.mdx/cli.sock`.

Supported commands include:

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

Memory commands manage Markdown-native records under `memory/` and `.mdx/`. They can run through the active Workspace Mode socket, or headlessly with `mdx-cli memory --root <workspace> ...`.

Packaged builds include `mdx-cli` and `mdx-mcp` sidecars. Agent integration for Codex, Claude, and Cursor is opt-in from the Memory Settings panel or `mdx-cli memory --root <workspace> agent setup ...`.

For the full Memory usage guide, see [docs/memory-usage.md](docs/memory-usage.md).

The LLM Wiki CLI surface remains socket-only and always targets the active Workspace Mode root. Only Memory commands support `--root` headless execution.

## Build

### Desktop Development

```bash
npm install
npx tauri dev
```

Tauri starts the Next.js renderer development server automatically.

### Renderer Debugging

```bash
npm run dev
```

This only starts the Next.js renderer. Opening `http://localhost:3000` in a browser is useful for UI debugging, but it is not a standalone web product and cannot use desktop-only capabilities such as folder selection, file-system commands, LLM Wiki backend commands, or the local CLI socket.

### Native Target

macOS is the supported native target for this MVP.

```bash
npm install
npx tauri build
```

## Verification

```bash
npm run lint
npm run test
cd src-tauri && cargo test
```

## License

The application layer, helper libraries, and self-owned Markdown editor kernel in this repository are MIT licensed; see [LICENSE](LICENSE).
