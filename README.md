# MDX

**MDX is a local desktop Markdown workspace editor.**

It combines a Markdown-native WYSIWYG editing kernel with a Tauri desktop shell for working with folders on your own machine.

## Features

- Single-root workspace for local Markdown notes
- Left file tree for folders, `.md`, and `.markdown` files
- Multi-tab editing with dirty-state tracking
- Right outline panel generated from H1-H6 headings
- Local app state saved under `~/.mdx/state.json`
- Image assets saved into the workspace `.assets/` directory, with a global fallback under `~/.mdx/assets`
- `mdx-cli` for local automation and agent-driven editing

## Scope

MDX is desktop-first. The current app does not provide a web product, Quick Look extension, auto-update flow, multi-root workspaces, full-text search, or live file-system watching.

The editor currently supports `.md` and `.markdown` files. It does not display `.mdx` files in this MVP.

## Architecture

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Desktop shell: Tauri 2 and Rust
- Editor adapter: `@do-md/react`
- Syntax highlighting: Prism
- Tests: Vitest for frontend logic, Rust tests for Tauri-side workspace behavior

The frontend owns workspace UI state, tabs, outline parsing, panel sizing, and editor integration. Rust/Tauri owns protected file-system access, app-state persistence, image assets, trash operations, and the local CLI socket.

## CLI

The macOS build includes `mdx-cli`, which talks to the running app over a local Unix socket at `~/.mdx/cli.sock`.

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

### Web Shell For Development

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

### Native Desktop App

macOS is the supported native target for this MVP.

```bash
npm install
npx tauri dev
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
