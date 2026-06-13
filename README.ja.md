# MDX

**MDX は、単一ドキュメント編集とフォルダーワークスペースの 2 つのモードを備えた、ローカルファーストの Markdown アプリです。**

Markdown ネイティブな WYSIWYG 編集カーネルと Tauri のデスクトップシェルを組み合わせ、手元のフォルダーと単一の Markdown ドキュメントを編集します。

## モード

- Document Mode: Finder やシステムの「このアプリケーションで開く」から単一の `.md` / `.markdown` ファイルを開いたときに使用します。ウィンドウには Markdown エディターと現在の文書アウトラインだけが表示され、ファイルツリー、タブ、LLM Wiki は表示されません。
- Workspace Mode: MDX を直接起動したとき、最近のワークスペースを復元したとき、またはアプリ内でフォルダーを開いたときに使用します。ファイルツリー、タブ、アウトライン、任意の LLM Wiki 知識ベース機能を含みます。

Document Mode は `mdx-cli` による自動化の対象外で、最近のワークスペースを復元せず、`.mdx` もサポートしません。

## 機能

- Document Mode: 単一 Markdown 文書用の軽量ウィンドウ。アウトライン、保存、未保存時の閉じる確認、同階層 `.assets/` 画像アセットをサポート
- Workspace Mode: 単一ルートのローカルワークスペース
- Workspace Mode: 左側のファイルツリーでフォルダー、`.md`、`.markdown` を表示
- Workspace Mode: 未保存状態を追跡するマルチタブ編集
- Workspace Mode: 現在の文書の H1-H6 から生成される右側アウトライン
- アプリ状態を `~/.mdx/state.json` に保存
- 画像は現在の文書またはワークスペースの `.assets/` に保存し、失敗時は `~/.mdx/assets` にフォールバック
- Workspace Mode 向けのローカル自動化とエージェント操作のための `mdx-cli`

## スコープ

MDX はデスクトップ優先です。現在の MVP では、Web 製品、Quick Look 拡張、自動更新、多ルートワークスペース、全文検索、リアルタイムのファイル監視は提供しません。

現在サポートする編集対象は `.md` と `.markdown` です。この MVP では `.mdx` を Document Mode のファイルとして扱わず、ワークスペースのファイルツリーにも表示しません。

## アーキテクチャ

- フロントエンド: Next.js 16、React 19、TypeScript、Tailwind CSS
- デスクトップシェル: Tauri 2、Rust
- エディターアダプター: `@do-md/react`
- シンタックスハイライト: Prism
- テスト: フロントエンドロジックは Vitest、Tauri 側のワークスペース処理は Rust tests

フロントエンドはワークスペース UI 状態、タブ、アウトライン解析、パネルサイズ、エディター統合を担当します。Rust/Tauri は保護されたファイルシステムアクセス、アプリ状態の永続化、画像アセット、ゴミ箱操作、ローカル CLI socket を担当します。

## CLI

macOS ビルドには `mdx-cli` が含まれます。実行中の Workspace Mode アプリとは `~/.mdx/cli.sock` のローカル Unix socket で通信します。

主なコマンド:

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
mdx-cli memory export --output <dir>
mdx-cli memory import --input <dir> --dry-run
mdx-cli memory --root <workspace> status
mdx-cli serve --workspace <workspace> --port 14243
mdx-mcp --workspace <workspace>
```

Memory コマンドは `memory/` と `.mdx/` 配下の Markdown ネイティブな記憶レコードを管理します。現在の Workspace Mode socket 経由でも、`mdx-cli memory --root <workspace> ...` によるヘッドレス実行でも使えます。

LLM Wiki の CLI は socket 専用のままで、常に現在の Workspace Mode root を対象にします。`--root` によるヘッドレス実行をサポートするのは Memory コマンドだけです。

## ビルド

### デスクトップ開発

```bash
npm install
npx tauri dev
```

Tauri が Next.js のレンダラー開発サーバーを自動で起動します。

### レンダラーのデバッグ

```bash
npm run dev
```

このコマンドは Next.js renderer だけを起動します。ブラウザーで `http://localhost:3000` を開くのは UI デバッグには使えますが、独立した Web 製品ではありません。フォルダー選択、ファイルシステムコマンド、LLM Wiki のバックエンドコマンド、ローカル CLI socket などのデスクトップ専用機能は使えません。

### ネイティブターゲット

この MVP のネイティブターゲットは macOS です。

```bash
npm install
npx tauri build
```

## 検証

```bash
npm run lint
npm run test
cd src-tauri && cargo test
```

## ライセンス

このリポジトリのアプリケーション層と補助ライブラリは MIT ライセンスです。詳細は [LICENSE](LICENSE) を参照してください。

`.packages/@do-md/dist/` 以下のコンパイル済みエディターカーネルは、独自のライセンスで配布されています。そのカーネルを商用利用するには、事前の書面による許可が必要です。
