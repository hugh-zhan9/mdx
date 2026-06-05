# Editor Mermaid Preview Clarification

**Timestamp:** 2026-06-05 10:53:03 Asia/Shanghai

**Handoff:** direct_to_plan

## Intent And Desired Outcome

The editor should support live Mermaid previews for Markdown fenced code blocks whose language is `mermaid`. The product should feel like a visual Markdown editor: Mermaid source is hidden by default and diagrams are shown inline in the editor.

## Important User Wording

- "是的我需要支持这个功能。"
- "我也同意不改 不直接改 .packages/@do-md/dist。"
- "隐藏代码块吧，我觉得这种更加符合产品的定位"
- "默认显示图表预览，点击图表块进入“源码编辑态”，失焦或按 Esc 回到预览态"
- "Workspace 模式和 Document 模式都支持"
- "预览态不匹配隐藏源码；进入源码编辑态后可以匹配当前露出的源码"

## In Scope

- Render ` ```mermaid ` fenced code blocks as inline Mermaid SVG previews in the existing editor.
- Hide the original Mermaid code block by default.
- Allow source editing by clicking the preview block or its lightweight "编辑" button.
- Return from source editing to preview on blur or `Esc`.
- Use a 300ms debounce while editing Mermaid source before rendering preview.
- Support both Workspace mode and Document mode through shared `features/editor` integration.
- Show concise error UI when rendering fails, preserve source unchanged, and keep the source editable.
- Add the `mermaid` runtime dependency.
- Keep UI controls within existing app styling and avoid adding icon/UI dependencies.
- Save original Markdown fenced code blocks only. Do not persist SVG or images.

## Non Goals

- Do not edit `.packages/@do-md/dist` or any closed-source kernel file.
- Do not replace the editor kernel.
- Do not add single-diagram custom theme configuration.
- Do not add aliases such as `mmd`, `diagram`, or unlabeled code blocks in the first version.
- Do not export Mermaid as images or cache rendered SVG files.
- Do not enable Mermaid click callbacks, HTML labels, scripts, or other active content.

## Decisions

1. **Rendering mode:** Preview by default, source hidden.
2. **Editing mode:** Click the preview block or "编辑" button to reveal the source code block. Blur or `Esc` returns to preview.
3. **Error behavior:** Rendering failure shows a concise error state and keeps source editable.
4. **Refresh behavior:** Mermaid render calls are debounced by 300ms while editing.
5. **Search/replace:** Hidden Mermaid source is excluded from find/replace. Revealed source is included because it is visible editor text.
6. **Security:** Use Mermaid `securityLevel: "strict"`, disable start-on-load auto rendering, and do not enable active diagram features.
7. **Dependency:** Add `mermaid` to `dependencies`. Do not add icon dependencies.
8. **Language trigger:** Only fenced code blocks whose info string first token is `mermaid`, case-insensitive.
9. **Sizing:** Preview follows editor content width. Wide diagrams scroll horizontally; first version does not add zoom/pan/minimap.
10. **Theme:** Mermaid follows app light/dark theme. No per-diagram theme options.
11. **Persistence:** Markdown source remains the saved document format.

## Brownfield Evidence

- `features/editor/components/editor-pane.tsx` renders `DOMDProvider` and passes only `codeTokenizer={(code, lang) => tokenize(code, lang)}`.
- `types/do-md-react.d.ts` exposes `DOMDProviderProps` with `imageLoader` and `codeTokenizer`, but no custom code block renderer.
- `package.json` currently has `prismjs` but no `mermaid`.
- Workspace and Document modes both use `features/editor/components/editor-pane.tsx`, so a shared editor-layer implementation covers both.
- `src-tauri/src/llm_wiki_fs.rs` already generates ` ```mermaid ` blocks for the knowledge graph.
- Find/replace builds an index from visible DOM text through `features/editor/lib/visible-text-search.ts`, so hiding Mermaid source with `display: none`, `hidden`, or `aria-hidden` keeps the approved search boundary.

## External Source Evidence

- Mermaid official usage docs describe `mermaid.initialize` and `securityLevel`; `strict` is the default that encodes HTML tags and disables click functionality.
- Mermaid official API docs describe calling `initialize()` before `render()`.

Sources:
- https://mermaid.js.org/config/usage
- https://mermaid.ai/open-source/config/setup/mermaid/interfaces/Mermaid.html

## Decision Boundaries

- The implementation may manipulate DOM around `.DOMD-Pre` nodes from a React wrapper, but it must not patch the kernel bundle.
- DOM manipulation must be reversible and scoped to editor roots.
- The source Markdown remains the single source of truth.
- If mapping DOM code blocks to parsed Markdown fences becomes unreliable, the implementer should stop and report the mismatch rather than modifying `.packages/@do-md/dist`.

## Success Criteria

- A document containing a valid ` ```mermaid ` block displays an inline diagram instead of the code block by default.
- Clicking the diagram or "编辑" reveals the underlying code block for editing.
- `Esc` or blur returns to preview when the diagram can render.
- Invalid Mermaid keeps source visible and shows a concise error state.
- Workspace mode and Document mode both behave the same.
- Find/replace does not match hidden Mermaid source in preview mode.
- Find/replace can match Mermaid source after the source is revealed.
- Saved Markdown stays as a fenced Mermaid code block.
- `npm test`, `npm run lint`, and `npm run build` pass.

## Residual Risks

- The closed-source DOMD kernel may change `.DOMD-Pre` DOM shape. The plan should isolate selectors and cover the current CSS class contract with tests.
- Imperative preview insertion inside the editor root may interact with contenteditable behavior. The preview node must be `contenteditable="false"` and event handling must stop propagation where needed.
- Mermaid render performance can degrade on very large diagrams. The first version mitigates with 300ms debounce but does not introduce diagram virtualization.

## Next Handoff Recommendation

Directly create an implementation plan from this clarification bundle. A separate design spec is unnecessary because product behavior, scope, security, persistence, and verification boundaries are fixed.
