use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryAgentSetupRequest {
    pub codex: bool,
    pub claude: bool,
    pub cursor: bool,
    #[serde(default)]
    pub hooks: bool,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub mdx_cli: Option<String>,
    #[serde(default)]
    pub mdx_mcp: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryAgentSetupResult {
    pub dry_run: bool,
    pub changed_paths: Vec<String>,
    pub summary: String,
}

pub fn memory_agent_setup(
    root_path: String,
    request: MemoryAgentSetupRequest,
) -> io::Result<MemoryAgentSetupResult> {
    let configure_all = !request.codex && !request.claude && !request.cursor;
    let targets = AgentSetupTargets {
        codex: configure_all || request.codex,
        claude: configure_all || request.claude,
        cursor: configure_all || request.cursor,
        hooks: request.hooks,
    };
    let paths = AgentSetupPaths::resolve(request.mdx_cli.as_deref(), request.mdx_mcp.as_deref())?;
    let changes = plan_memory_agent_setup(&root_path, &targets, &paths)?;

    if !request.dry_run {
        apply_agent_setup_changes(&changes)?;
    }

    Ok(MemoryAgentSetupResult {
        dry_run: request.dry_run,
        changed_paths: changes
            .iter()
            .map(|change| change.path.to_string_lossy().into_owned())
            .collect(),
        summary: render_agent_setup_summary(&changes, request.dry_run),
    })
}

pub struct AgentSetupTargets {
    pub codex: bool,
    pub claude: bool,
    pub cursor: bool,
    pub hooks: bool,
}

pub struct AgentSetupPaths {
    pub home: PathBuf,
    pub mdx_cli: String,
    pub mdx_mcp: String,
    pub hook_script: PathBuf,
}

impl AgentSetupPaths {
    pub fn resolve(mdx_cli: Option<&str>, mdx_mcp: Option<&str>) -> io::Result<Self> {
        let home = home_dir()?;
        let current_exe = env::current_exe()?;
        let mdx_cli = match mdx_cli {
            Some(path) => normalize_path(path)?,
            None => find_bundled_binary(&current_exe, "mdx-cli")
                .unwrap_or_else(|| current_exe.clone())
                .to_string_lossy()
                .into_owned(),
        };
        let mdx_mcp = match mdx_mcp {
            Some(path) => normalize_path(path)?,
            None => find_bundled_binary(&current_exe, "mdx-mcp")
                .unwrap_or_else(|| {
                    current_exe
                        .parent()
                        .unwrap_or_else(|| Path::new(""))
                        .join("mdx-mcp")
                })
                .to_string_lossy()
                .into_owned(),
        };
        Ok(Self {
            hook_script: home.join(".mdx-memory-precompact-hook.mjs"),
            home,
            mdx_cli,
            mdx_mcp,
        })
    }
}

fn find_bundled_binary(current_exe: &Path, name: &str) -> Option<PathBuf> {
    let parent = current_exe.parent()?;
    let mut candidates = vec![parent.join(name)];
    if let Some(triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
        candidates.push(parent.join(format!("{name}-{triple}")));
    }
    if let Some(resources) = parent.parent().map(|path| path.join("Resources")) {
        candidates.push(resources.join(name));
        if let Some(triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
            candidates.push(resources.join(format!("{name}-{triple}")));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

pub struct AgentSetupChange {
    pub path: PathBuf,
    pub contents: String,
    pub executable: bool,
}

pub fn plan_memory_agent_setup(
    root_path: &str,
    targets: &AgentSetupTargets,
    paths: &AgentSetupPaths,
) -> io::Result<Vec<AgentSetupChange>> {
    let mut changes = Vec::new();

    if targets.hooks && (targets.claude || targets.cursor) {
        changes.push(AgentSetupChange {
            path: paths.hook_script.clone(),
            contents: precompact_hook_script(&paths.mdx_cli, root_path),
            executable: true,
        });
    }

    if targets.codex {
        for skill_root in [
            paths.home.join(".codey/skills/mdx-memory/SKILL.md"),
            paths.home.join(".agents/skills/mdx-memory/SKILL.md"),
        ] {
            changes.push(AgentSetupChange {
                path: skill_root,
                contents: mdx_memory_skill(root_path, &paths.mdx_cli),
                executable: false,
            });
        }
        changes.push(AgentSetupChange {
            path: paths.home.join(".codey/config.toml"),
            contents: update_codex_config(
                &paths.home.join(".codey/config.toml"),
                &paths.mdx_mcp,
                root_path,
            )?,
            executable: false,
        });
    }

    if targets.claude {
        changes.push(AgentSetupChange {
            path: paths.home.join(".claude/skills/mdx-memory/SKILL.md"),
            contents: mdx_memory_skill(root_path, &paths.mdx_cli),
            executable: false,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".claude/CLAUDE.md"),
            contents: update_agent_markdown_block(
                &paths.home.join(".claude/CLAUDE.md"),
                claude_memory_block(),
            )?,
            executable: false,
        });
        if targets.hooks {
            changes.push(AgentSetupChange {
                path: paths.home.join(".claude/hooks/hooks.json"),
                contents: update_claude_hooks(
                    &paths.home.join(".claude/hooks/hooks.json"),
                    &paths.hook_script,
                )?,
                executable: false,
            });
        }
    }

    if targets.cursor {
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/skills/mdx-memory/SKILL.md"),
            contents: mdx_memory_skill(root_path, &paths.mdx_cli),
            executable: false,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/mcp.json"),
            contents: update_cursor_mcp(
                &paths.home.join(".cursor/mcp.json"),
                &paths.mdx_mcp,
                root_path,
            )?,
            executable: false,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/rules/mdx-memory.mdc"),
            contents: cursor_memory_rule(),
            executable: false,
        });
        if targets.hooks {
            changes.push(AgentSetupChange {
                path: paths.home.join(".cursor/hooks.json"),
                contents: update_cursor_hooks(
                    &paths.home.join(".cursor/hooks.json"),
                    &paths.hook_script,
                )?,
                executable: false,
            });
        }
    }

    Ok(changes)
}

pub fn apply_agent_setup_changes(changes: &[AgentSetupChange]) -> io::Result<()> {
    for change in changes {
        if let Some(parent) = change.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&change.path, &change.contents)?;
        if change.executable {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = fs::metadata(&change.path)?.permissions();
                permissions.set_mode(0o755);
                fs::set_permissions(&change.path, permissions)?;
            }
        }
    }
    Ok(())
}

pub fn render_agent_setup_summary(changes: &[AgentSetupChange], dry_run: bool) -> String {
    let action = if dry_run { "would_write" } else { "wrote" };
    let mut lines = vec![format!("memory agent setup {action}:")];
    for change in changes {
        lines.push(format!("- {}", change.path.display()));
    }
    lines.join("\n")
}

fn home_dir() -> io::Result<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))
}

fn normalize_path(input: &str) -> io::Result<String> {
    let path = PathBuf::from(input);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()?.join(path)
    };
    Ok(absolute.to_string_lossy().into_owned())
}

fn update_codex_config(path: &Path, mdx_mcp: &str, root_path: &str) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    let filtered = remove_toml_table(&existing, "[mcp_servers.mdx-memory]");
    let mut output = filtered.trim_end().to_string();
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str("[mcp_servers.mdx-memory]\n");
    output.push_str(&format!("command = \"{}\"\n", toml_escape(mdx_mcp)));
    output.push_str(&format!(
        "args = [\"--workspace\", \"{}\"]\n",
        toml_escape(root_path)
    ));
    Ok(output)
}

fn remove_toml_table(contents: &str, table_header: &str) -> String {
    let mut output = Vec::new();
    let mut skipping = false;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed == table_header {
            skipping = true;
            continue;
        }
        if skipping && trimmed.starts_with('[') && trimmed.ends_with(']') {
            skipping = false;
        }
        if !skipping {
            output.push(line);
        }
    }
    output.join("\n")
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn update_cursor_mcp(path: &Path, mdx_mcp: &str, root_path: &str) -> io::Result<String> {
    let mut value = read_optional_json(path)?;
    if !value.is_object() {
        value = serde_json::json!({});
    }
    if value.get("mcpServers").and_then(|item| item.as_object()).is_none() {
        value["mcpServers"] = serde_json::json!({});
    }
    value["mcpServers"]["mdx-memory"] = serde_json::json!({
        "command": mdx_mcp,
        "args": ["--workspace", root_path]
    });
    pretty_json(&value)
}

fn update_cursor_hooks(path: &Path, hook_script: &Path) -> io::Result<String> {
    let mut value = read_optional_json(path)?;
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value["version"] = value.get("version").cloned().unwrap_or(serde_json::json!(1));
    if value.get("hooks").and_then(|item| item.as_object()).is_none() {
        value["hooks"] = serde_json::json!({});
    }
    value["hooks"]["preCompact"] = serde_json::json!([{
        "command": format!("node {} cursor", hook_script.display()),
        "timeout": 60
    }]);
    pretty_json(&value)
}

fn update_claude_hooks(path: &Path, hook_script: &Path) -> io::Result<String> {
    let mut value = read_optional_json(path)?;
    if !value.is_object() {
        value = serde_json::json!({ "hooks": {} });
    }
    if value.get("hooks").and_then(|item| item.as_object()).is_none() {
        value["hooks"] = serde_json::json!({});
    }
    if value["hooks"]
        .get("PreCompact")
        .and_then(|item| item.as_array())
        .is_none()
    {
        value["hooks"]["PreCompact"] = serde_json::json!([]);
    }
    let precompact = value["hooks"]["PreCompact"].as_array_mut().unwrap();
    precompact.retain(|entry| {
        entry
            .get("id")
            .and_then(|id| id.as_str())
            != Some("mdx-memory:precompact-capture")
    });
    precompact.push(serde_json::json!({
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": format!("node {} claude-code", hook_script.display()),
            "async": true,
            "timeout": 60
        }],
        "description": "Capture and accept MDX Memory before context compaction when transcript_path is available",
        "id": "mdx-memory:precompact-capture"
    }));
    pretty_json(&value)
}

fn read_optional_file(path: &Path) -> io::Result<String> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error),
    }
}

fn read_optional_json(path: &Path) -> io::Result<serde_json::Value> {
    let contents = read_optional_file(path)?;
    if contents.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&contents).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("failed to parse {}: {error}", path.display()),
        )
    })
}

fn pretty_json(value: &serde_json::Value) -> io::Result<String> {
    serde_json::to_string_pretty(value)
        .map(|json| format!("{json}\n"))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn update_agent_markdown_block(path: &Path, block: &str) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if existing.contains("## MDX Memory") {
        return Ok(existing);
    }
    let mut output = existing.trim_end().to_string();
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(block);
    output.push('\n');
    Ok(output)
}

fn precompact_hook_script(mdx_cli: &str, root_path: &str) -> String {
    format!(
        r#"#!/usr/bin/env node

import {{ existsSync }} from "node:fs";
import {{ basename }} from "node:path";
import {{ spawnSync }} from "node:child_process";

const MDX_CLI = {mdx_cli_json};
const MEMORY_ROOT = {root_json};

function readStdin() {{
  return new Promise((resolve) => {{
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {{
      text += chunk;
    }});
    process.stdin.on("end", () => resolve(text));
    if (process.stdin.isTTY) {{
      resolve("");
    }}
  }});
}}

function parseInput(text) {{
  if (!text.trim()) {{
    return {{}};
  }}
  try {{
    return JSON.parse(text);
  }} catch {{
    return {{}};
  }}
}}

function valueAt(input, keys) {{
  for (const key of keys) {{
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) {{
      return value.trim();
    }}
  }}
  return null;
}}

function stableThreadId(source, input, transcriptPath) {{
  const explicit = valueAt(input, [
    "thread_id",
    "threadId",
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
  ]);
  if (explicit) {{
    return `${{source}}:${{explicit.replace(/^.+:/, "")}}`;
  }}
  return `${{source}}:${{basename(transcriptPath).replace(/\.[^.]+$/, "")}}`;
}}

function captureTitle(source, input) {{
  const explicit = valueAt(input, ["title", "session_name", "sessionName"]);
  if (explicit) {{
    return explicit;
  }}
  return `${{source}} pre-compact memory capture`;
}}

const sourceArg = process.argv[2] || "manual";
const input = parseInput(await readStdin());
const transcriptPath = valueAt(input, [
  "transcript_path",
  "transcriptPath",
  "conversation_path",
  "conversationPath",
]);

if (!transcriptPath || !existsSync(transcriptPath)) {{
  process.exit(0);
}}

const threadId = stableThreadId(sourceArg, input, transcriptPath);
const captureResult = spawnSync(
  MDX_CLI,
  [
    "memory",
    "--root",
    MEMORY_ROOT,
    "capture",
    "import",
    "--source",
    sourceArg,
    "--thread-id",
    threadId,
    "--title",
    captureTitle(sourceArg, input),
    "--file",
    transcriptPath,
    "--distill",
  ],
  {{ encoding: "utf8", timeout: 60_000 }},
);

if (captureResult.error) {{
  process.stderr.write(`[mdx-memory] pre-compact memory capture skipped: ${{captureResult.error.message}}\n`);
  process.exit(0);
}}

if (captureResult.status !== 0) {{
  process.stderr.write(
    `[mdx-memory] pre-compact memory capture failed: ${{captureResult.stderr || captureResult.stdout || "unknown error"}}\n`,
  );
  process.exit(0);
}}

const acceptResult = spawnSync(
  MDX_CLI,
  [
    "memory",
    "--root",
    MEMORY_ROOT,
    "distill",
    "--thread",
    threadId,
    "--accept",
  ],
  {{ encoding: "utf8", timeout: 60_000 }},
);

if (acceptResult.error) {{
  process.stderr.write(`[mdx-memory] pre-compact memory accept skipped: ${{acceptResult.error.message}}\n`);
  process.exit(0);
}}

if (acceptResult.status !== 0) {{
  process.stderr.write(
    `[mdx-memory] pre-compact memory accept failed: ${{acceptResult.stderr || acceptResult.stdout || "unknown error"}}\n`,
  );
}}

process.exit(0);
"#,
        mdx_cli_json = serde_json::to_string(mdx_cli).unwrap(),
        root_json = serde_json::to_string(root_path).unwrap()
    )
}

fn mdx_memory_skill(root_path: &str, mdx_cli: &str) -> String {
    format!(
        r#"---
name: mdx-memory
description: Use when the user asks to remember, save, recall, search, summarize for future sessions, persist decisions, load prior context, manage MDX Memory, or distinguish memory capture from full thread archival across Codex, Claude, or Cursor.
---

# MDX Memory

Use MDX Memory as the user's durable cross-agent memory store. The configured workspace is:

```text
{root_path}
```

## Trigger

Use this skill when the user says or implies:

- "记住", "保存到 memory", "以后记得", "沉淀一下", "写入长期记忆"
- "回忆", "查一下 memory", "之前怎么决定的", "加载上下文"
- end-of-session summaries, important decisions, stable preferences, project constraints, or reusable lessons
- pre-compact memory capture before context compression
- explicit full-thread archival, import, show, or distillation

Do not write memory for trivial chatter, transient commands, secrets, API keys, raw credentials, or facts the user has not confirmed.

## Read And Search Flow

At the start of substantive work, or when prior context matters:

1. Call `memory_working_get`.
2. Call `memory_recall` with a task-specific `query`.
3. Use `memory_search` or CLI `memory search` when the user asks to search/list exact stored memories rather than load task context.
4. Keep recalled context scoped to the current task; explicit user instructions still win.

CLI fallback:

```bash
{mdx_cli} memory --root "{root_path}" working get
{mdx_cli} memory --root "{root_path}" recall "<task query>"
{mdx_cli} memory --root "{root_path}" search "<exact query>"
```

## Durable Memory Write Flow

Use `memory_add` for durable atomic memories. Write concise snapshots with enough context to stand alone.

Good memory candidates:

- durable user preferences
- architecture decisions and reasons
- project-specific conventions
- resolved ambiguity or changed direction
- repeated workflow lessons

CLI fallback:

```bash
{mdx_cli} memory --root "{root_path}" add --title "<title>" --body "<body>" --tag "<tag>"
```

## Pre-Compact Memory Capture

Pre-compact hooks are for memory capture before context compression. They are not the same as explicit thread archival.

Claude and Cursor hooks call `~/.mdx-memory-precompact-hook.mjs` on pre-compact events. When the hook input includes a valid `transcript_path`, the hook runs `memory capture import --distill` and then accepts the distilled result into active memories. The implementation may store a source thread internally so distillation has provenance, but the purpose of this hook is to create reusable active memory before compression. If no transcript path is available, the hook silently skips.

Codex currently relies on explicit MCP/CLI calls for pre-compact capture unless a verified Codex lifecycle hook exposes a transcript path.

## Full Thread Archival

Use `memory_thread_save` only when preserving the full original conversation matters. A thread is the raw/original conversation record, not the default memory summary. Use `memory_thread_get` or `memory_thread_show` when the user asks to inspect the original thread. Use `memory_distill` after saving a thread when the user wants reusable long-term memories extracted. Use `memory_promote` only when the user explicitly asks to promote memory into wiki/raw material.

CLI fallback:

```bash
{mdx_cli} memory --root "{root_path}" thread save --source codex --title "<title>" --file <path>
{mdx_cli} memory --root "{root_path}" thread show "<source:thread-id>"
{mdx_cli} memory --root "{root_path}" distill --thread "<source:thread-id>" --accept
```

## Safety

- Ask before storing sensitive personal data, credentials, private keys, tokens, or third-party confidential material.
- If uncertain whether something is worth keeping, ask briefly or put it in the final answer as a suggested memory.
- Never invent provenance. Include source thread/path only when available.
- Do not promote to wiki unless explicitly requested.
"#
    )
}

fn claude_memory_block() -> &'static str {
    "## MDX Memory\nWhen the user asks to remember, save, recall, search, persist decisions, or load prior context, use the `mdx-memory` skill and the `mdx-memory` MCP server.\n\nUse `memory_working_get` and `memory_recall` for task context. Use `memory_add` only for durable decisions, stable preferences, project constraints, or reusable lessons. Pre-compact hooks capture and accept distilled memory before compression; full thread archival is separate and should only be used when preserving original conversation text matters. Do not store secrets or promote memory into wiki/raw material unless the user explicitly asks."
}

fn cursor_memory_rule() -> String {
    r#"---
description: Use MDX Memory when remembering, saving, recalling, searching prior context, persisting decisions, or summarizing durable lessons.
alwaysApply: true
---

Use the `mdx-memory` skill and the `mdx-memory` MCP server for durable memory.

Read task context with `memory_working_get` and `memory_recall`. Search exact stored memories with `memory_search`. Write only stable preferences, project constraints, durable decisions, and reusable lessons. Pre-compact hooks capture and accept distilled memory before compression; full thread archival is separate and should only be used when preserving original conversation text matters. Do not store secrets.
"#
    .to_string()
}
