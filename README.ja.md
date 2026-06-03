# MDX

**MDX は、ローカルデスクトップ向けの Markdown ワークスペースエディターです。**

Markdown ネイティブな WYSIWYG 編集カーネルと Tauri のデスクトップシェルを組み合わせ、手元のフォルダー内にある Markdown ファイルを編集します。

## 機能

- 単一ルートのローカルワークスペース
- 左側のファイルツリーでフォルダー、`.md`、`.markdown` を表示
- 未保存状態を追跡するマルチタブ編集
- 現在の文書の H1-H6 から生成される右側アウトライン
- アプリ状態を `~/.mdx/state.json` に保存
- 画像はワークスペースの `.assets/` に保存し、失敗時は `~/.mdx/assets` にフォールバック
- ローカル自動化とエージェント操作のための `mdx-cli`

## スコープ

MDX はデスクトップ優先です。現在の MVP では、Web 製品、Quick Look 拡張、自動更新、多ルートワークスペース、全文検索、リアルタイムのファイル監視は提供しません。

現在サポートする編集対象は `.md` と `.markdown` です。この MVP では `.mdx` ファイルは表示しません。

## アーキテクチャ

- フロントエンド: Next.js 16、React 19、TypeScript、Tailwind CSS
- デスクトップシェル: Tauri 2、Rust
- エディターアダプター: `@do-md/react`
- シンタックスハイライト: Prism
- テスト: フロントエンドロジックは Vitest、Tauri 側のワークスペース処理は Rust tests

フロントエンドはワークスペース UI 状態、タブ、アウトライン解析、パネルサイズ、エディター統合を担当します。Rust/Tauri は保護されたファイルシステムアクセス、アプリ状態の永続化、画像アセット、ゴミ箱操作、ローカル CLI socket を担当します。

## CLI

macOS ビルドには `mdx-cli` が含まれます。実行中のアプリとは `~/.mdx/cli.sock` のローカル Unix socket で通信します。

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
```

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
