# LLM Wiki Output Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** User-approved requirement from 2026-06-14 conversation: fix three recurring LLM Wiki failures: streaming chat request timeout, generated text outside strict file blocks, and missing file block end markers such as `index.md`.

**Goal:** Make LLM Wiki ingest robust against provider streaming failures and common malformed LLM file-block output without writing partial or unsafe wiki files.

**Architecture:** Keep the existing Rust/Tauri LLM Wiki pipeline and file-block writer. Treat incomplete streaming responses as transport failures, add a non-streaming Chat API mode for unreliable streaming providers, tolerate only safe wrapper formatting around file blocks, and retry malformed generation once through a strict repair prompt before failing. Preserve the existing safety boundary: no generated files or cache entries are written unless parsing and path validation succeed.

**Tech Stack:** Rust/Tauri, reqwest blocking client, serde/serde_json, existing `WorkspaceError`, existing LLM Wiki ingest parser, Cargo tests.

---

## Scope Check

These three failures share one ingest path, but each fix has a separate boundary:

- LLM transport reliability belongs in `src-tauri/src/llm_wiki_llm.rs`.
- File-block syntax tolerance belongs in `src-tauri/src/llm_wiki_ingest.rs`.
- One-shot malformed-output repair belongs in `src-tauri/src/llm_wiki.rs`.

The plan keeps these as separate tasks so each task produces independently testable behavior. It does not redesign the LLM Wiki schema, switch all output to JSON, or change frontend UI.

## File Structure

- Modify `src-tauri/src/llm_wiki_llm.rs`: reject partial streams that end without `[DONE]` or a non-null `finish_reason`; add `chatNoStream` API mode; allow timeout/partial stream fallback to non-stream chat.
- Modify `src-tauri/src/llm_wiki_ingest.rs`: add a small normalization helper that strips one safe outer markdown code fence before strict file-block parsing.
- Modify `src-tauri/src/llm_wiki.rs`: wrap generation parsing in one-shot repair logic and add a test-only helper so repair can be tested without network.
- Modify `src-tauri/src/llm_wiki_tests.rs`: add parser and ingest repair regression tests.
- No frontend files change in this plan.

## Implementation Rules

- Use TDD for every task: write the failing test, run it, implement the minimum, rerun the focused test.
- Do not loosen path safety. `is_safe_llm_wiki_output_path` remains the final gate for every output path.
- Do not auto-append `---END FILE---` to truncated output. Missing end markers indicate incomplete content and must be repaired by a retry or reported.
- Preserve current successful streaming behavior for complete streams.
- Stage and commit only the files listed in each task.

### Task 1: Treat Partial Chat Streams As Transport Failures

**Files:**
- Modify: `src-tauri/src/llm_wiki_llm.rs`

- [ ] **Step 1: Write the failing partial-stream test**

In `src-tauri/src/llm_wiki_llm.rs`, inside the existing `#[cfg(test)] mod tests`, add this test after `chat_stream_timeout_does_not_retry_non_stream_fallback`:

```rust
#[test]
fn chat_stream_rejects_content_without_terminal_event() {
    let bytes = br#"data: {"choices":[{"delta":{"content":"---FILE: index.md---\n# Index\n"}}]}
"#;

    let error = extract_chat_completion_stream_content(bytes).unwrap_err();

    assert_eq!(error.error_code(), "llm_partial_stream");
    assert!(error.to_string().contains("ended before [DONE]"));
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd src-tauri
cargo test chat_stream_rejects_content_without_terminal_event --lib
```

Expected: FAIL because `read_chat_completion_stream` currently returns `Ok(content)` when it has non-empty content, even if the stream ended without a terminal event.

- [ ] **Step 3: Implement the partial-stream error**

In `src-tauri/src/llm_wiki_llm.rs`, replace this block in `read_chat_completion_stream`:

```rust
    if !content.trim().is_empty() {
        return Ok(content);
    }
```

with:

```rust
    if !content.trim().is_empty() {
        if saw_terminal {
            return Ok(content);
        }
        return Err(ChatStreamReadError::with_code(
            "llm_partial_stream",
            format!(
                "llm chat completion stream ended before [DONE]; stream preview: {}",
                response_preview(&preview)
            ),
            !content.is_empty(),
        ));
    }
```

Then add this constructor to the existing `impl ChatStreamReadError` block:

```rust
    fn with_code(
        code: &'static str,
        message: impl Into<String>,
        received_content: bool,
    ) -> Self {
        Self {
            error: WorkspaceError::new(code, message),
            received_content,
        }
    }
```

Keep the existing `ChatStreamReadError::new` constructor unchanged, and make it call `with_code`:

```rust
    fn new(message: impl Into<String>, _preview: &[u8], received_content: bool) -> Self {
        Self::with_code("llm_failed", message, received_content)
    }
```

If the current `new` signature differs slightly, preserve its parameters and only centralize the `WorkspaceError::new("llm_failed", ...)` construction through `with_code`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd src-tauri
cargo test chat_stream_rejects_content_without_terminal_event --lib
```

Expected: PASS.

- [ ] **Step 5: Run existing stream tests**

Run:

```bash
cd src-tauri
cargo test chat_stream --lib
```

Expected: PASS. Existing complete streams still parse; partial streams now fail with `llm_partial_stream`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/llm_wiki_llm.rs
git commit -m "fix: reject partial llm chat streams"
```

---

### Task 2: Add Non-Streaming Chat Mode And Fallback For Timeout/Partial Stream

**Files:**
- Modify: `src-tauri/src/llm_wiki_llm.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write the API mode regression tests**

In `src-tauri/src/llm_wiki_llm.rs`, inside `#[cfg(test)] mod tests`, add these tests:

```rust
#[test]
fn llm_api_mode_accepts_non_stream_chat_aliases() {
    assert_eq!(LlmApiMode::from_config("chatNoStream").unwrap(), LlmApiMode::ChatNoStream);
    assert_eq!(LlmApiMode::from_config("chat-no-stream").unwrap(), LlmApiMode::ChatNoStream);
    assert_eq!(LlmApiMode::from_config("chat_non_stream").unwrap(), LlmApiMode::ChatNoStream);
}

#[test]
fn chat_stream_timeout_and_partial_stream_can_retry_non_stream_fallback() {
    assert!(should_retry_chat_non_stream_fallback(&WorkspaceError::new(
        "llm_timeout",
        "stream timed out"
    )));
    assert!(should_retry_chat_non_stream_fallback(&WorkspaceError::new(
        "llm_partial_stream",
        "stream ended before [DONE]"
    )));
    assert!(!should_retry_chat_non_stream_fallback(&WorkspaceError::new(
        "cancelled",
        "operation cancelled"
    )));
}
```

Update the existing `chat_stream_timeout_does_not_retry_non_stream_fallback` test by renaming it to `chat_stream_cancelled_does_not_retry_non_stream_fallback` and removing its timeout assertion:

```rust
#[test]
fn chat_stream_cancelled_does_not_retry_non_stream_fallback() {
    assert!(!should_retry_chat_non_stream_fallback(&WorkspaceError::new(
        "cancelled",
        "operation cancelled"
    )));
    assert!(should_retry_chat_non_stream_fallback(&WorkspaceError::new(
        "llm_failed",
        "stream not supported"
    )));
}
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd src-tauri
cargo test llm_api_mode_accepts_non_stream_chat_aliases --lib
cargo test chat_stream_timeout_and_partial_stream_can_retry_non_stream_fallback --lib
```

Expected: FAIL because `LlmApiMode` has no `ChatNoStream` variant and timeout is currently excluded from fallback.

- [ ] **Step 3: Add the `ChatNoStream` API mode**

In `src-tauri/src/llm_wiki_llm.rs`, change:

```rust
enum LlmApiMode {
    Chat,
    Responses,
}
```

to:

```rust
enum LlmApiMode {
    Chat,
    ChatNoStream,
    Responses,
}
```

Update `from_config`:

```rust
    fn from_config(value: &str) -> Result<Self, WorkspaceError> {
        match value.trim() {
            "" | "chat" => Ok(Self::Chat),
            "chatNoStream" | "chat-no-stream" | "chat_non_stream" => Ok(Self::ChatNoStream),
            "responses" => Ok(Self::Responses),
            other => Err(WorkspaceError::new(
                "llm_failed",
                format!("unsupported llm api mode: {other}"),
            )),
        }
    }
```

Update `url`, `build_request`, `extract_content`, and `label` so `ChatNoStream` behaves like non-streaming Chat:

```rust
    fn url(self, base_url: &str) -> Result<String, WorkspaceError> {
        match self {
            Self::Chat | Self::ChatNoStream => chat_completions_url(base_url),
            Self::Responses => responses_url(base_url),
        }
    }

    fn build_request(self, model: &str, messages: Vec<LlmChatMessage>) -> serde_json::Value {
        match self {
            Self::Chat | Self::ChatNoStream => build_openai_chat_request(model, messages),
            Self::Responses => build_openai_responses_request(model, messages),
        }
    }

    fn extract_content(self, bytes: &[u8]) -> Result<String, WorkspaceError> {
        match self {
            Self::Chat | Self::ChatNoStream => extract_chat_completion_content(bytes),
            Self::Responses => extract_responses_content(bytes),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Chat | Self::ChatNoStream => "chat completion",
            Self::Responses => "responses",
        }
    }
```

Update `call_chat_completion_core`:

```rust
    match api_mode {
        LlmApiMode::Chat => call_chat_completion_streaming_with_fallback(&client, config, messages),
        LlmApiMode::ChatNoStream | LlmApiMode::Responses => {
            call_non_streaming_completion(&client, config, api_mode, messages)
        }
    }
```

- [ ] **Step 4: Allow timeout and partial stream fallback**

Replace `should_retry_chat_non_stream_fallback` with:

```rust
fn should_retry_chat_non_stream_fallback(error: &WorkspaceError) -> bool {
    !matches!(error.error_code(), "cancelled")
}
```

In `call_chat_completion_streaming_with_fallback`, change this match guard:

```rust
            Err(error)
                if !error.received_content
                    && should_retry_chat_non_stream_fallback(&error.error) =>
```

to:

```rust
            Err(error)
                if should_retry_chat_non_stream_fallback(&error.error) =>
```

This makes `llm_partial_stream` eligible for one non-stream fallback even when partial content was received. The partial content is discarded; it is never parsed or written.

- [ ] **Step 5: Add config round-trip coverage for `chatNoStream`**

In `src-tauri/src/llm_wiki_tests.rs`, add this test near the existing LLM config tests:

```rust
#[test]
fn llm_config_round_trips_chat_no_stream_api_mode() {
    let dir = tempdir().unwrap();
    let path = dir.path().canonicalize().unwrap().join("llm-config.json");
    let config = LlmProviderConfig {
        base_url: "https://api.example.com/v1".to_string(),
        model: "test-model".to_string(),
        api_key: Some("secret-key".to_string()),
        api_mode: "chatNoStream".to_string(),
    };

    save_llm_config_to_path(&path, &config).unwrap();
    let loaded = load_llm_config_from_path(&path).unwrap();

    assert_eq!(loaded, config);
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd src-tauri
cargo test llm_api_mode_accepts_non_stream_chat_aliases --lib
cargo test chat_stream_timeout_and_partial_stream_can_retry_non_stream_fallback --lib
cargo test llm_config_round_trips_chat_no_stream_api_mode --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/llm_wiki_llm.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: support non-stream llm chat mode"
```

---

### Task 3: Strip Safe Outer Markdown Fence Before File-Block Parsing

**Files:**
- Modify: `src-tauri/src/llm_wiki_ingest.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write parser tests for safe wrapper tolerance**

In `src-tauri/src/llm_wiki_tests.rs`, near the existing `ingest_parse_file_blocks_*` tests, add:

```rust
#[test]
fn ingest_parse_file_blocks_accepts_single_outer_markdown_fence() {
    let blocks = parse_file_blocks(
        "```markdown\n---FILE: wiki/sources/a.md---\n# A\n---END FILE---\n---FILE: index.md---\n# Index\n---END FILE---\n```\n",
    )
    .unwrap();

    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0].path, "wiki/sources/a.md");
    assert_eq!(blocks[0].content, "# A\n");
    assert_eq!(blocks[1].path, "index.md");
}

#[test]
fn ingest_parse_file_blocks_still_rejects_outer_prose() {
    let error = parse_file_blocks(
        "Here are the files:\n```markdown\n---FILE: wiki/sources/a.md---\n# A\n---END FILE---\n```\n",
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "llm_wiki_parse_failed");
    assert!(error.to_string().contains("outside file blocks"));
}
```

- [ ] **Step 2: Run the focused tests and verify one fails**

Run:

```bash
cd src-tauri
cargo test ingest_parse_file_blocks_accepts_single_outer_markdown_fence --lib
cargo test ingest_parse_file_blocks_still_rejects_outer_prose --lib
```

Expected: `ingest_parse_file_blocks_accepts_single_outer_markdown_fence` FAILS; `ingest_parse_file_blocks_still_rejects_outer_prose` PASSES.

- [ ] **Step 3: Add safe output normalization**

In `src-tauri/src/llm_wiki_ingest.rs`, add this helper above `parse_file_blocks`:

```rust
fn normalize_file_block_output(output: &str) -> &str {
    let trimmed = output.trim();
    let Some(after_open) = trimmed
        .strip_prefix("```markdown\n")
        .or_else(|| trimmed.strip_prefix("```md\n"))
        .or_else(|| trimmed.strip_prefix("```\n"))
    else {
        return output;
    };
    let Some(inner) = after_open.strip_suffix("\n```") else {
        return output;
    };
    inner
}
```

Then change the start of `parse_file_blocks` from:

```rust
pub fn parse_file_blocks(output: &str) -> Result<Vec<LlmWikiFileBlock>, WorkspaceError> {
    let mut blocks = Vec::new();
```

to:

```rust
pub fn parse_file_blocks(output: &str) -> Result<Vec<LlmWikiFileBlock>, WorkspaceError> {
    let output = normalize_file_block_output(output);
    let mut blocks = Vec::new();
```

This intentionally accepts only a single whole-output wrapper. It still rejects prose before or after the wrapper.

- [ ] **Step 4: Run parser tests**

Run:

```bash
cd src-tauri
cargo test ingest_parse_file_blocks --lib
```

Expected: PASS. Existing safety tests for unsafe paths, duplicate paths, and prose after an ambiguous end marker remain passing.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm_wiki_ingest.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: tolerate fenced llm wiki file blocks"
```

---

### Task 4: Add One-Shot Repair For Malformed File-Block Output

**Files:**
- Modify: `src-tauri/src/llm_wiki.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Add a test-only parser-with-repair helper and failing tests**

In `src-tauri/src/llm_wiki.rs`, add this test helper near the ingest helpers:

```rust
#[cfg(test)]
pub(crate) fn parse_file_blocks_with_repair_for_test(
    first_output: &str,
    repair: impl FnOnce(String) -> Result<String, WorkspaceError>,
) -> Result<Vec<crate::llm_wiki_ingest::LlmWikiFileBlock>, WorkspaceError> {
    parse_file_blocks_with_optional_repair(first_output, repair)
}
```

In `src-tauri/src/llm_wiki_tests.rs`, update the `crate::llm_wiki` import to include `parse_file_blocks_with_repair_for_test`, then add:

```rust
#[test]
fn ingest_parse_repair_recovers_missing_end_marker_once() {
    let blocks = parse_file_blocks_with_repair_for_test(
        "---FILE: index.md---\n# Broken\n",
        |prompt| {
            assert!(prompt.contains("llm wiki file block is missing end marker: index.md"));
            assert!(prompt.contains("---FILE: index.md---"));
            Ok("---FILE: index.md---\n# Fixed\n---END FILE---\n".to_string())
        },
    )
    .unwrap();

    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].path, "index.md");
    assert_eq!(blocks[0].content, "# Fixed\n");
}

#[test]
fn ingest_parse_repair_returns_original_parse_error_when_repair_is_invalid() {
    let error = parse_file_blocks_with_repair_for_test(
        "---FILE: index.md---\n# Broken\n",
        |_prompt| Ok("Still invalid prose\n".to_string()),
    )
    .unwrap_err();

    assert_eq!(error.error_code(), "llm_wiki_parse_failed");
    assert!(error.to_string().contains("missing end marker: index.md"));
}
```

- [ ] **Step 2: Run focused tests and verify they fail to compile**

Run:

```bash
cd src-tauri
cargo test ingest_parse_repair_recovers_missing_end_marker_once --lib
cargo test ingest_parse_repair_returns_original_parse_error_when_repair_is_invalid --lib
```

Expected: FAIL to compile because `parse_file_blocks_with_optional_repair` does not exist yet.

- [ ] **Step 3: Implement the repair prompt and helper**

In `src-tauri/src/llm_wiki.rs`, add this helper near `llm_output_preview` or the ingest functions:

```rust
fn build_file_block_repair_prompt(error: &WorkspaceError, output: &str) -> String {
    format!(
        r#"The previous LLM Wiki generation failed to parse.

Parser error:
{error}

Return only valid LLM Wiki file blocks. Do not include explanations, markdown fences, or prose outside file blocks.

Valid format:
---FILE: wiki/sources/ascii-slug.md---
# Title
Markdown content
---END FILE---

Invalid output to repair:
{output}
"#
    )
}

fn parse_file_blocks_with_optional_repair(
    first_output: &str,
    repair: impl FnOnce(String) -> Result<String, WorkspaceError>,
) -> Result<Vec<crate::llm_wiki_ingest::LlmWikiFileBlock>, WorkspaceError> {
    match parse_file_blocks(first_output) {
        Ok(blocks) => Ok(blocks),
        Err(first_error) => {
            let repair_prompt = build_file_block_repair_prompt(&first_error, first_output);
            let repaired_output = repair(repair_prompt)?;
            parse_file_blocks(&repaired_output).map_err(|_| first_error)
        }
    }
}
```

This helper returns the original parse error if the repair output is still malformed. That keeps user-facing errors tied to the original failure and avoids hiding the root cause.

- [ ] **Step 4: Wire repair into ingest generation**

In `src-tauri/src/llm_wiki.rs`, replace:

```rust
    let blocks = match parse_file_blocks(&llm_output) {
        Ok(blocks) => blocks,
        Err(error) => {
            let _ = append_log_entry(
                &root,
                &format!(
                    "ingest failed {raw_relative_path} parse: {error}; llm output preview: {}",
                    llm_output_preview(&llm_output)
                ),
            );
            return Err(error);
        }
    };
```

with:

```rust
    let blocks = match parse_file_blocks_with_optional_repair(&llm_output, |repair_prompt| {
        call_chat_completion_for_operation(
            &config,
            vec![
                system_message("You repair malformed LLM Wiki file-block output."),
                user_message(repair_prompt),
            ],
            operation_id.as_deref(),
        )
    }) {
        Ok(blocks) => blocks,
        Err(error) => {
            let _ = append_log_entry(
                &root,
                &format!(
                    "ingest failed {raw_relative_path} parse: {error}; llm output preview: {}",
                    llm_output_preview(&llm_output)
                ),
            );
            return Err(error);
        }
    };
```

Do not run repair more than once.

- [ ] **Step 5: Run focused repair tests**

Run:

```bash
cd src-tauri
cargo test ingest_parse_repair_recovers_missing_end_marker_once --lib
cargo test ingest_parse_repair_returns_original_parse_error_when_repair_is_invalid --lib
```

Expected: PASS.

- [ ] **Step 6: Run ingest parser/write safety tests**

Run:

```bash
cd src-tauri
cargo test ingest_parse_file_blocks --lib
cargo test ingest_mock_output_rejects_ambiguous_truncated_output_without_write_or_cache_update --lib
cargo test ingest_write_outputs_rejects --lib
```

Expected: PASS. Parse repair must not weaken mock-output safety or writer path safety.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/llm_wiki.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: repair malformed llm wiki output once"
```

---

### Task 5: Tighten Generation Prompt Against Common Wrapper And End-Marker Failures

**Files:**
- Modify: `src-tauri/src/llm_wiki_ingest.rs`
- Modify: `src-tauri/src/llm_wiki_tests.rs`

- [ ] **Step 1: Write prompt regression test**

In `src-tauri/src/llm_wiki_tests.rs`, update `ingest_prompts_generation_requires_file_blocks_and_sources_paths` or add this adjacent test:

```rust
#[test]
fn ingest_generation_prompt_rejects_markdown_wrappers_and_requires_end_markers() {
    let prompt = build_ingest_generation_prompt("{}", "# Existing");

    assert!(prompt.contains("Do not wrap the output in ```markdown or any other code fence."));
    assert!(prompt.contains("Every ---FILE: marker must have a matching exact ---END FILE--- marker."));
    assert!(prompt.contains("Before answering, verify the final non-whitespace line is ---END FILE---."));
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd src-tauri
cargo test ingest_generation_prompt_rejects_markdown_wrappers_and_requires_end_markers --lib
```

Expected: FAIL because the prompt does not contain those explicit rules yet.

- [ ] **Step 3: Update generation prompt rules**

In `src-tauri/src/llm_wiki_ingest.rs`, inside `build_ingest_generation_prompt`, add these rules immediately after `- Do not write any text outside file blocks.`:

```text
- Do not wrap the output in ```markdown or any other code fence.
- Every ---FILE: marker must have a matching exact ---END FILE--- marker.
- Before answering, verify the final non-whitespace line is ---END FILE---.
```

- [ ] **Step 4: Run the focused prompt test**

Run:

```bash
cd src-tauri
cargo test ingest_generation_prompt_rejects_markdown_wrappers_and_requires_end_markers --lib
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm_wiki_ingest.rs src-tauri/src/llm_wiki_tests.rs
git commit -m "fix: tighten llm wiki generation prompt"
```

---

### Task 6: Final Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run all LLM Wiki Rust tests**

Run:

```bash
cd src-tauri
cargo test llm_wiki --lib
```

Expected: PASS.

- [ ] **Step 2: Run all Rust library tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: PASS.

- [ ] **Step 3: Check worktree**

Run:

```bash
git status --short
```

Expected: only intentional committed changes are absent from the worktree. Existing unrelated dirty files from before this plan may still appear and must not be staged unless the user explicitly asks.

---

## Self-Review

- Spec coverage: timeout, outside-block prose/fence, and missing end marker are each covered by at least one implementation task and regression test.
- Placeholder scan: no task uses unspecified "handle edge cases" instructions; each task names exact files, snippets, commands, and expected results.
- Type consistency: new `LlmApiMode::ChatNoStream`, `llm_partial_stream`, and `parse_file_blocks_with_optional_repair` are introduced before later tasks reference them.
- Design drift: the plan does not replace the file-block protocol or change the LLM Wiki storage model. It only adds transport fallback, safe parser normalization, and one-shot repair.
