# MDX

**MDX is a local-first Markdown app with two modes: single-document editing and folder workspaces.**

It combines a Markdown-native WYSIWYG editing kernel with a Tauri desktop shell for working with local folders and individual Markdown documents.

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
- Local app state saved under `~/.mdx/state.json`
- Image assets saved into the current document or workspace `.assets/` directory, with a global fallback under `~/.mdx/assets`
- `mdx-cli` for Workspace Mode local automation and agent-driven editing

## Scope

MDX is desktop-first. The current app does not provide a web product, Quick Look extension, auto-update flow, multi-root workspaces, full-text search, or live file-system watching.

The editor currently supports `.md` and `.markdown` files. This MVP does not treat `.mdx` as a Document Mode file and does not display `.mdx` files in the workspace file tree.

## Architecture

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Desktop shell: Tauri 2 and Rust
- Editor adapter: `@do-md/react`
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
```

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

The application layer and helper libraries in this repository are MIT licensed; see [LICENSE](LICENSE).

The compiled editor kernel under `.packages/@do-md/dist/` is distributed separately under its own license. Commercial use of that kernel requires prior written authorization.
