# MDX Agent-Time Memory Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/MDX会话中自动Memory提取需求设计文档.md`

**Goal:** Make MDX Memory extraction an agent-time default behavior by updating generated agent guidance, MCP tool affordances, and optional inbox tooling without requiring a background capture service.

**Architecture:** The approved design makes the agent the first execution point for Memory extraction: recall at task start, save durable low-risk preferences and decisions during the conversation, ask before sensitive/uncertain saves, and use thread distill only as a supplementary historical path. This plan implements the first phase through agent setup skill text, MCP tool descriptions, and an MCP `memory_inbox_add` tool; it does not add a daemon or new `agent_memory.*` config fields.

**Tech Stack:** Rust/Tauri backend, serde JSON-RPC MCP server, Markdown skill generation, existing MDX Memory file store and tests.

---

## File Structure

- Modify: `src-tauri/src/memory_agent_setup.rs`
  - Owns generated MDX Memory skill content for Codex/Claude/Cursor and agent setup files.
  - Will gain explicit "Agent-Time Memory Extraction" guidance.
- Modify: `src-tauri/src/bin/mdx_mcp.rs`
  - Owns MCP stdio tool registration, tool descriptors, and tool dispatch.
  - Will strengthen recall/add/search/distill descriptions and expose `memory_inbox_add`.
- Modify: `src-tauri/src/bin/mdx_cli.rs`
  - Contains tests for generated agent setup content.
  - Will assert the generated skills/rules include proactive agent-time extraction guidance.
- Modify: `src-tauri/src/memory_tests.rs`
  - Contains daemon/memory route tests.
  - Only touched if daemon route coverage needs explicit inbox route assertions; no functional change expected.
- Modify: `docs/memory-usage.md`
  - User-facing documentation for MDX Memory usage.
  - Will document agent-time extraction as the default day-to-day model and distinguish it from thread archival/distill.
- Create: no new source module required in phase one.

First-phase scope decision from the spec handoff:

- Do not add `agent_memory.*` config in this plan.
- Do add `memory_inbox_add` to MCP because the design explicitly needs a safe path for uncertain-but-worth-reviewing candidates and the backend already has `memory_inbox_add`.
- Do not implement daemon polling, Codex lifecycle hooks, or memory update/evolves_from.

---

### Task 1: Update Generated Agent Memory Guidance

**Files:**
- Modify: `src-tauri/src/memory_agent_setup.rs`
- Modify: `src-tauri/src/bin/mdx_cli.rs`

- [ ] **Step 1: Write failing assertions for generated skill content**

In `src-tauri/src/bin/mdx_cli.rs`, extend `memory_agent_setup_dry_run_plans_cross_agent_files_without_writing` after the existing summary assertions:

```rust
let skill = changes
    .iter()
    .find(|change| change.path.ends_with(".agents/skills/mdx-memory/SKILL.md"))
    .unwrap()
    .contents
    .clone();
assert!(skill.contains("## Agent-Time Memory Extraction"));
assert!(skill.contains("At the start of substantive work, call `memory_working_get` and `memory_recall`."));
assert!(skill.contains("During the conversation, proactively save durable low-risk facts with `memory_add`."));
assert!(skill.contains("For sensitive, private, or uncertain candidates, ask briefly or use `memory_inbox_add` when available."));
assert!(skill.contains("Do not wait for background capture, thread archival, or pre-compact hooks before saving clear durable memory."));
```

In `memory_agent_setup_writes_cursor_mcp_and_precompact_hook`, after reading the hook file, read the generated Cursor rule and assert the same behavior appears in shorter form:

```rust
let rule = fs::read_to_string(home.path().join(".cursor/rules/mdx-memory.mdc")).unwrap();
assert!(rule.contains("Agent-time memory extraction is the default"));
assert!(rule.contains("proactively save durable low-risk preferences, decisions, and project conventions"));
assert!(rule.contains("Do not wait for background capture or thread distill"));
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test memory_agent_setup --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with assertion errors for missing `Agent-Time Memory Extraction` and Cursor rule text.

- [ ] **Step 3: Add the Agent-Time Memory Extraction section to generated skill**

In `src-tauri/src/memory_agent_setup.rs`, inside `fn mdx_memory_skill`, insert this section after the `Read And Search Flow` CLI fallback block and before `## Durable Memory Write Flow`:

```markdown
## Agent-Time Memory Extraction

Agent-time memory extraction is the default day-to-day MDX Memory behavior. Do not wait for background capture, thread archival, or pre-compact hooks before saving clear durable memory.

At the start of substantive work, call `memory_working_get` and `memory_recall`.

During the conversation, proactively save durable low-risk facts with `memory_add` when the user confirms or clearly expresses:

- stable user preferences
- architecture, product, or workflow decisions
- project-specific conventions
- resolved ambiguity that should guide future work
- reusable debugging or implementation lessons

For sensitive, private, or uncertain candidates, ask briefly or use `memory_inbox_add` when available. Do not save secrets, API keys, private credentials, raw tokens, or one-off command output.

Before writing a memory, use `memory_search` when practical to avoid obvious duplicates. Write atomic memories that stand alone without the full transcript.
```

Also update the existing `Durable Memory Write Flow` paragraph from:

```markdown
Use `memory_add` for durable atomic memories. Write concise snapshots with enough context to stand alone.
```

to:

```markdown
Use `memory_add` for durable atomic memories during the conversation, not only when the user explicitly says "remember". Write concise snapshots with enough context to stand alone.
```

- [ ] **Step 4: Update Claude and Cursor generated guidance**

In `src-tauri/src/memory_agent_setup.rs`, replace `claude_memory_block()` return string with:

```rust
"## MDX Memory\nWhen the user asks to remember, save, recall, search, persist decisions, or load prior context, use the `mdx-memory` skill and the `mdx-memory` MCP server.\n\nAgent-time memory extraction is the default. At the start of substantive work, use `memory_working_get` and `memory_recall` for task context. During the conversation, proactively save durable low-risk preferences, decisions, project constraints, and reusable lessons with `memory_add`; ask before saving sensitive or uncertain information. Do not wait for background capture or thread distill before saving clear durable memory. Pre-compact hooks and full thread archival are supplementary. Do not store secrets or promote memory into wiki/raw material unless the user explicitly asks."
```

Replace the body returned by `cursor_memory_rule()` with:

```rust
r#"---
description: Use MDX Memory when remembering, saving, recalling, searching prior context, persisting decisions, or summarizing durable lessons.
alwaysApply: true
---

Use the `mdx-memory` skill and the `mdx-memory` MCP server for durable memory.

Agent-time memory extraction is the default. Read task context with `memory_working_get` and `memory_recall`. During the conversation, proactively save durable low-risk preferences, decisions, project conventions, and reusable lessons with `memory_add`; ask before saving sensitive or uncertain information. Use `memory_search` before writing when practical to avoid duplicates. Do not wait for background capture or thread distill before saving clear durable memory. Pre-compact hooks and full thread archival are supplementary. Do not store secrets.
"#
.to_string()
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cargo test memory_agent_setup --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. Existing warning `workspace_search_sync is never used` may appear.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/memory_agent_setup.rs src-tauri/src/bin/mdx_cli.rs
git commit -m "feat: make agent-time memory extraction explicit"
```

---

### Task 2: Strengthen MCP Tool Descriptions For Agent-Time Behavior

**Files:**
- Modify: `src-tauri/src/bin/mdx_mcp.rs`

- [ ] **Step 1: Write failing MCP descriptor assertions**

In `src-tauri/src/bin/mdx_mcp.rs`, inside `mod tests`, add this test after `tools_list_response_contains_expected_memory_tools`:

```rust
#[test]
fn tool_descriptions_guide_agent_time_memory_behavior() {
    let response = handle_request(
        "/tmp",
        parse_request(r#"{"jsonrpc":"2.0","id":"tools","method":"tools/list"}"#).unwrap(),
    );

    assert!(response.error.is_none());
    let tools = response.result.unwrap()["tools"].as_array().unwrap().clone();
    let description_for = |name: &str| {
        tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some(name))
            .unwrap()["description"]
            .as_str()
            .unwrap()
            .to_string()
    };

    assert!(description_for("memory_recall").contains("At the start of substantive work"));
    assert!(description_for("memory_add").contains("during the conversation"));
    assert!(description_for("memory_add").contains("Do not store secrets"));
    assert!(description_for("memory_search").contains("before writing"));
    assert!(description_for("memory_distill").contains("supplementary"));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cargo test tool_descriptions_guide_agent_time_memory_behavior --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because current descriptions are short generic strings.

- [ ] **Step 3: Update MCP tool descriptions**

In `src-tauri/src/bin/mdx_mcp.rs`, update only the description strings in `fn tool_descriptor`:

```rust
"memory_recall" => (
    "At the start of substantive work, recall relevant working memory, durable memories, and optional thread context for the current task. Keep recalled context scoped; current user instructions win.",
    ...
),
```

```rust
"memory_add" => (
    "Add a durable memory snapshot during the conversation when the user confirms or clearly expresses a stable preference, project decision, convention, or reusable lesson. Write atomic standalone memories. Do not store secrets, credentials, tokens, or one-off command output.",
    ...
),
```

```rust
"memory_search" => (
    "Search durable memory summaries, especially before writing a new memory when practical to avoid obvious duplicates.",
    ...
),
```

```rust
"memory_distill" => (
    "Supplementary path: distill a saved thread into inbox candidates or memories for historical transcript processing. Do not wait for distill before saving clear durable memory with memory_add during the conversation.",
    ...
),
```

Leave input schemas unchanged in this task.

- [ ] **Step 4: Run the targeted test**

Run:

```bash
cargo test tool_descriptions_guide_agent_time_memory_behavior --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 5: Run MCP tests**

Run:

```bash
cargo test --bin mdx_mcp --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. Existing warnings may appear.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/bin/mdx_mcp.rs
git commit -m "feat: guide mcp memory tools toward agent-time extraction"
```

---

### Task 3: Expose `memory_inbox_add` Over MCP For Uncertain Candidates

**Files:**
- Modify: `src-tauri/src/bin/mdx_mcp.rs`

- [ ] **Step 1: Write failing tool list and dispatch tests**

In `src-tauri/src/bin/mdx_mcp.rs`, update `tools_list_response_contains_expected_memory_tools` only after this task's implementation target is clear. First add a separate failing test after `dispatches_memory_working_get_tool_call`:

```rust
#[test]
fn dispatches_memory_inbox_add_tool_call() {
    let root = tempfile::tempdir().unwrap();
    mdx_lib::memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned())
        .unwrap();
    let request = parse_request(
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_inbox_add","arguments":{"title":"Confirm project preference","body":"User may prefer inbox-first memory review for uncertain items.","tags":["preference"],"importance":0.6,"confidence":0.7}}}"#,
    )
    .unwrap();

    let response = handle_request(root.path().to_str().unwrap(), request);

    assert!(response.error.is_none(), "{:?}", response.error);
    let result = response.result.unwrap();
    assert_eq!(result["frontmatter"]["title"], "Confirm project preference");
    assert_eq!(result["frontmatter"]["status"], "pending");
    assert_eq!(result["frontmatter"]["tags"][0], "preference");
}
```

Also add this assertion to `tools_list_response_contains_expected_memory_tools` after collecting `names`:

```rust
assert!(names.contains(&"memory_inbox_add"));
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test memory_inbox_add --bin mdx_mcp --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL with `Unknown tool: memory_inbox_add` or missing tool list entry.

- [ ] **Step 3: Register `memory_inbox_add`**

In `src-tauri/src/bin/mdx_mcp.rs`, update the imports at the top from:

```rust
memory_add, memory_detect_workspace, memory_distill, memory_inbox_accept, memory_inbox_list,
```

to:

```rust
memory_add, memory_detect_workspace, memory_distill, memory_inbox_accept, memory_inbox_add,
memory_inbox_list,
```

Add `"memory_inbox_add"` to `TOOLS` between `"memory_inbox_list"` and `"memory_inbox_accept"`:

```rust
"memory_inbox_list",
"memory_inbox_add",
"memory_inbox_accept",
```

- [ ] **Step 4: Add the tool descriptor**

In `fn tool_descriptor`, add this match arm before `"memory_inbox_list"`:

```rust
"memory_inbox_add" => (
    "Add an uncertain or sensitive memory candidate to inbox for user review instead of writing directly to active memory. Use this when a candidate seems useful but needs confirmation.",
    json!({
        "title": { "type": "string" },
        "body": { "type": "string" },
        "source_thread": { "type": "string" },
        "source_message_refs": { "type": "array", "items": { "type": "string" } },
        "importance": { "type": "number" },
        "confidence": { "type": "number" },
        "tags": { "type": "array", "items": { "type": "string" } },
        "distill_run_id": { "type": "string" }
    }),
    json!(["title", "body", "tags"]),
),
```

- [ ] **Step 5: Dispatch the tool**

In `fn dispatch_tool_call`, add this match arm before `"memory_inbox_list"`:

```rust
"memory_inbox_add" => {
    let request = parse_arguments(arguments)?;
    memory_result(memory_inbox_add(workspace.to_string(), request))
}
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
cargo test memory_inbox_add --bin mdx_mcp --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Run MCP binary tests**

Run:

```bash
cargo test --bin mdx_mcp --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/bin/mdx_mcp.rs
git commit -m "feat: expose memory inbox add over mcp"
```

---

### Task 4: Document Agent-Time Memory Extraction

**Files:**
- Modify: `docs/memory-usage.md`

- [ ] **Step 1: Inspect the current Memory usage sections**

Run:

```bash
rg -n "memory_add|memory_distill|capture scan|pre-compact|thread archival|mdx-memory" docs/memory-usage.md
```

Expected: output includes existing sections around manual add, capture scan, agent setup, and distill.

- [ ] **Step 2: Add a new user-facing section**

In `docs/memory-usage.md`, add this section before the existing capture/thread archival section that mentions `memory capture scan --source codex`:

```markdown
## Agent-time Memory extraction

MDX Memory 的默认日常模型是 agent 在会话过程中主动提取长期记忆，而不是等待后台扫描、thread distill 或 pre-compact hook。

Agent 应该在以下时机主动使用 Memory：

1. 开始实质任务时调用 `memory_working_get` 和 `memory_recall`，加载与当前任务相关的上下文。
2. 会话中如果用户确认了长期偏好、项目决策、稳定约定或可复用经验，直接调用 `memory_add` 写入 active memory。
3. 对敏感、私密或不确定的候选，不直接写 active memory；先询问用户，或在支持时调用 `memory_inbox_add` 放入 inbox。
4. 保存前可调用 `memory_search` 查重，避免明显重复。
5. `memory_distill` 主要用于历史 thread 批处理，不是会话中保存清晰长期信息的前置条件。

不应自动保存 API key、token、密码、私钥、一次性终端输出或未经确认的敏感个人信息。
```

- [ ] **Step 3: Update stale Codex thread wording**

Find the paragraph that currently says imported Codex threads include readable `## Message N` sections. Replace it with:

```markdown
`capture scan --source codex --import` 会把发现的 `rollout-*.jsonl` 保存到 `memory/threads/codex/`。保存的 thread 优先展示 `## Conversation` 对话内容，并保留完整 `## Raw Codex JSONL` 作为 provenance。加 `--distill` 时会在导入后尝试蒸馏；如果蒸馏失败，命令会返回失败，不会把 distill failure 静默当作成功。
```

- [ ] **Step 4: Verify documentation contains the required distinctions**

Run:

```bash
rg -n "Agent-time Memory extraction|memory_inbox_add|memory_distill.*历史|## Conversation|Raw Codex JSONL" docs/memory-usage.md
```

Expected: output contains all five phrases.

- [ ] **Step 5: Commit**

```bash
git add docs/memory-usage.md
git commit -m "docs: describe agent-time memory extraction"
```

---

### Task 5: Regression, Smoke, And Local Agent Setup Verification

**Files:**
- No source edits expected.
- Read/verify generated outputs in temp directories and, if user requests deployment, installed app paths.

- [ ] **Step 1: Run memory agent setup tests**

Run:

```bash
cargo test memory_agent_setup --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. Existing `workspace_search_sync is never used` warning may appear.

- [ ] **Step 2: Run MCP tests**

Run:

```bash
cargo test --bin mdx_mcp --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Run memory tests**

Run:

```bash
cargo test memory_tests --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 4: Run frontend/workspace tests**

Run:

```bash
npm run test:workspace
```

Expected: PASS with all workspace test files passing.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 6: Smoke MCP tools list manually**

Run:

```bash
printf '{"jsonrpc":"2.0","id":"tools","method":"tools/list"}\n' \
  | src-tauri/target/release/bundle/macos/MDX.app/Contents/MacOS/mdx-mcp \
      --workspace "/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox" \
  | python3 -m json.tool \
  | rg "memory_inbox_add|during the conversation|At the start of substantive work"
```

Expected: output includes `memory_inbox_add`, the `memory_add` description phrase `during the conversation`, and the `memory_recall` phrase `At the start of substantive work`.

If the bundled app has not been rebuilt after source changes, use the release binary path that exists after `cargo build --release --manifest-path src-tauri/Cargo.toml`:

```bash
printf '{"jsonrpc":"2.0","id":"tools","method":"tools/list"}\n' \
  | src-tauri/target/release/mdx-mcp \
      --workspace "/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox" \
  | python3 -m json.tool \
  | rg "memory_inbox_add|during the conversation|At the start of substantive work"
```

- [ ] **Step 7: Smoke agent setup dry run**

Run:

```bash
src-tauri/target/release/bundle/macos/MDX.app/Contents/MacOS/mdx-cli \
  memory \
  --root "/Users/zhangyukun/Library/Mobile Documents/iCloud~md~obsidian/Documents/inbox" \
  agent setup \
  --all \
  --dry-run
```

Expected: JSON response or rendered output lists paths including `.codey/skills/mdx-memory/SKILL.md`, `.agents/skills/mdx-memory/SKILL.md`, `.claude/skills/mdx-memory/SKILL.md`, `.cursor/skills/mdx-memory/SKILL.md`, and does not modify files because `--dry-run` is set.

- [ ] **Step 8: If deployment is requested, rebuild and install**

Only run this when the user asks to install the updated local app:

```bash
npm run build:install
```

Expected: build exits 0 and prints `Installed ... -> /Applications/MDX.app`.

Then verify:

```bash
codesign --verify --deep --strict /Applications/MDX.app
defaults read /Applications/MDX.app/Contents/Info CFBundleShortVersionString
```

Expected: `codesign` exits 0 and version prints the current app version.

- [ ] **Step 9: Commit verification-only doc adjustments if any**

If Task 5 required no edits, do not commit. If a smoke command revealed stale docs and you updated only docs, commit:

```bash
git add docs/memory-usage.md
git commit -m "docs: clarify memory extraction verification"
```

---

## Self-Review

### Spec Coverage

- Agent-time default behavior: Task 1 and Task 2.
- Start-of-work recall: Task 1 skill text and Task 2 MCP recall descriptor.
- Conversation-time direct `memory_add`: Task 1 and Task 2.
- Sensitive/uncertain candidate handling: Task 1 guidance and Task 3 `memory_inbox_add`.
- Distill as supplementary path: Task 1, Task 2, Task 4.
- No daemon/background dependency: Task 1/4 wording and explicit phase-one scope decision.
- Storage compatibility: no new primary storage; Task 3 uses existing inbox store.
- Verification: Task 5.

### Placeholder Scan

No placeholders remain. This plan intentionally does not implement `agent_memory.*` config because the design handoff allows first phase through skill defaults; adding config would expand scope.

### Type Consistency

- `memory_inbox_add` dispatch uses existing `InboxAddRequest` from `mdx_lib::memory`.
- Tool schema fields match existing `InboxAddRequest` fields: `title`, `body`, `source_thread`, `source_message_refs`, `importance`, `confidence`, `tags`, `distill_run_id`.
- Test response path `result["frontmatter"]["status"]` matches existing inbox record model used by `memory_inbox_list` tests.

### Design Drift Check

No new daemon, remote service, storage model, or background scanner was introduced. The only additive API is optional `memory_inbox_add` over MCP, which the design explicitly identified as useful for uncertain candidates.
