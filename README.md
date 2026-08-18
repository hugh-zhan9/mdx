<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Loam app icon" width="128" height="128">
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

# Loam

**Loam is a local-first Markdown app with two modes: single-document editing and folder workspaces.**

It combines a Markdown-native editing kernel with a Tauri desktop shell for working with local folders and individual Markdown documents.

## Modes

- Document Mode: opens when Finder or the system “Open With” flow launches a single `.md` / `.markdown` file. The window contains only the Markdown editor and the current document outline, without the file tree, tabs, or LLM Wiki.
- Workspace Mode: opens when you launch Loam directly, restore the recent workspace, or open a folder inside the app. The window contains the file tree, tabs, outline, and optional LLM Wiki knowledge-base features.

Document Mode is not controlled by `loam-cli`, does not restore the recent workspace, and does not support `.mdx`.

## Features

- Document Mode: lightweight single Markdown document window with outline, save, dirty close confirmation, and sibling `.assets/` image assets
- Workspace Mode: single-root workspace for local Markdown notes
- Workspace Mode: left file tree for folders, `.md`, and `.markdown` files
- Workspace Mode: multi-tab editing with dirty-state tracking
- Workspace Mode: right outline panel generated from H1-H6 headings
- Workspace Mode: full-text search across `.md` and `.markdown`, including `raw/`
- Workspace Mode: default search limits of 2 MB per file, 200 total results, and 20 matches per file
- Workspace Mode and Document Mode: external file watching; clean content auto-reloads while dirty content shows a conflict prompt and read-only diff
- Unsaved Markdown bodies are stored as plaintext drafts under `~/.loam/drafts/`
- Drafts are deleted after save/discard and expired drafts are cleaned after 30 days
- Local app state saved under `~/.loam/state.json`
- Image assets saved into the current document or workspace `.assets/` directory, with a global fallback under `~/.loam/assets`
- `loam-cli` for Workspace Mode local automation and agent-driven editing

## Scope

Loam is desktop-first. The current app does not provide a web product, Quick Look extension, an auto-update flow, multi-root workspaces, PDF/image/binary full-text search, or LLM Wiki onboarding.

The editor currently supports `.md` and `.markdown` files. This MVP does not treat `.mdx` as a Document Mode file and does not display `.mdx` files in the workspace file tree.

## Architecture

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Desktop shell: Tauri 2 and Rust
- Editor kernel: self-owned Markdown-native editing kernel under `packages/mdx-editor/`
- Syntax highlighting: Prism
- Tests: Vitest for frontend logic, Rust tests for Tauri-side workspace behavior

The frontend owns workspace UI state, tabs, outline parsing, panel sizing, and editor integration. Rust/Tauri owns protected file-system access, app-state persistence, image assets, trash operations, and the local CLI socket.

## CLI

The macOS build includes `loam-cli`, which talks to the running Workspace Mode app over a local Unix socket at `~/.loam/cli.sock`.

Supported commands include:

```bash
loam-cli new
loam-cli list
loam-cli open <path>
loam-cli content [--tab <id>]
loam-cli selection [--tab <id>]
loam-cli insert [--tab <id>] <text>
loam-cli save [--tab <id>]
loam-cli focus [--tab <id>]
loam-cli close [--tab <id>] [--force]
loam-cli create-file <dir> [name]
loam-cli create-folder <dir> <name>
loam-cli rename <path> <new-name>
loam-cli llm-wiki status
loam-cli llm-wiki ingest <raw-path>
loam-cli llm-wiki digest --title "..." <prompt...>
loam-cli llm-wiki lint [--json]
loam-cli llm-wiki query [--json] <question...>
loam-cli llm-wiki search <query...>
loam-cli memory status [--json]
loam-cli memory init
loam-cli memory repair [--rebuild-index]
loam-cli memory index rebuild
loam-cli memory thread save --source manual --title "..." --file <path>
loam-cli memory add --title "..." --body "..."
loam-cli memory recall [--json] <query...>
loam-cli memory working get
loam-cli memory inbox list
loam-cli memory inbox accept <inbox-id>
loam-cli memory distill --thread <thread-id>
loam-cli memory capture import --source codex --file <path>
loam-cli memory promote <thread-id|memory-id|path>
loam-cli memory agent setup [--all|--codex|--claude|--cursor] [--no-hooks] [--dry-run]
loam-cli memory export --output <dir>
loam-cli memory import --input <dir> --dry-run
loam-cli memory --root <workspace> status
loam-cli serve --workspace <workspace> --port 14243
loam-mcp --workspace <workspace>
```

Memory commands manage Markdown-native records under `memory/` and `.loam/`. They can run through the active Workspace Mode socket, or headlessly with `loam-cli memory --root <workspace> ...`.

Packaged builds include `loam-cli` and `loam-mcp` sidecars. Agent integration for Codex, Claude, and Cursor is opt-in from the Memory Settings panel or `loam-cli memory --root <workspace> agent setup ...`.

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
The desktop shell uses macOS-first window chrome, quiet toolbar/sidebar surfaces, and a centered Markdown reading column.

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
