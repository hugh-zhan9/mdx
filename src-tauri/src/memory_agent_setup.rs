use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::memory_models::{MemoryDoctorReport, MemoryIntegrationStatus};

pub const MDX_MEMORY_HOOK_VERSION: &str = "1";
pub const MDX_MEMORY_BLOCK_BEGIN: &str = "<!-- BEGIN MDX MEMORY v1 -->";
pub const MDX_MEMORY_BLOCK_END: &str = "<!-- END MDX MEMORY -->";

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

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryAgentCommandRequest {
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub keep_data: bool,
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

pub fn memory_agent_install(
    root_path: String,
    request: MemoryAgentCommandRequest,
) -> io::Result<MemoryAgentSetupResult> {
    memory_agent_setup(
        root_path,
        setup_request_for_agent(request.agent.as_deref(), request.dry_run)?,
    )
}

pub fn memory_agent_repair(
    root_path: String,
    request: MemoryAgentCommandRequest,
) -> io::Result<MemoryAgentSetupResult> {
    let paths = AgentSetupPaths::resolve(None, None)?;
    let changes = plan_memory_agent_repair(&root_path, request.agent.as_deref(), &paths)?;

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

pub fn memory_agent_uninstall(
    _root_path: String,
    request: MemoryAgentCommandRequest,
) -> io::Result<MemoryAgentSetupResult> {
    let paths = AgentSetupPaths::resolve(None, None)?;
    let changes = plan_memory_agent_uninstall(request.agent.as_deref(), &paths)?;

    if !request.dry_run {
        apply_agent_setup_changes(&changes)?;
    }

    let data_note = if request.keep_data {
        "keeping memory data"
    } else {
        "memory data preserved; installer uninstall only removes agent integration files"
    };
    Ok(MemoryAgentSetupResult {
        dry_run: request.dry_run,
        changed_paths: changes
            .iter()
            .map(|change| change.path.to_string_lossy().into_owned())
            .collect(),
        summary: format!(
            "{}\n{data_note}",
            render_agent_setup_summary(&changes, request.dry_run)
        ),
    })
}

pub fn memory_agent_status(
    root_path: String,
    agent: Option<String>,
) -> io::Result<Vec<MemoryIntegrationStatus>> {
    let home = home_dir()?;
    let report = memory_agent_doctor_for_home(&root_path, &home)?;
    let selected = agent_sources(agent.as_deref())?;
    Ok(report
        .statuses
        .into_iter()
        .filter(|status| selected.iter().any(|agent| agent == &status.agent_source))
        .collect())
}

pub fn memory_agent_doctor(
    root_path: String,
    agent: Option<String>,
) -> io::Result<MemoryDoctorReport> {
    let home = home_dir()?;
    let mut report = memory_agent_doctor_for_home(&root_path, &home)?;
    let selected = agent_sources(agent.as_deref())?;
    report
        .statuses
        .retain(|status| selected.iter().any(|agent| agent == &status.agent_source));
    report.errors.retain(|error| {
        selected
            .iter()
            .any(|agent| error.to_lowercase().contains(agent))
    });
    report.warnings.retain(|warning| {
        selected
            .iter()
            .any(|agent| warning.to_lowercase().contains(agent))
    });
    report.ok = report.statuses.iter().all(status_ok) && report.errors.is_empty();
    Ok(report)
}

fn setup_request_for_agent(
    agent: Option<&str>,
    dry_run: bool,
) -> io::Result<MemoryAgentSetupRequest> {
    let normalized = normalize_agent_selector(agent)?;
    let codex = matches!(normalized, Some("codex"));
    let claude = matches!(normalized, Some("claude"));
    let cursor = matches!(normalized, Some("cursor"));
    Ok(MemoryAgentSetupRequest {
        codex,
        claude,
        cursor,
        hooks: true,
        dry_run,
        mdx_cli: None,
        mdx_mcp: None,
    })
}

fn agent_sources(agent: Option<&str>) -> io::Result<Vec<String>> {
    Ok(match normalize_agent_selector(agent)? {
        Some("codex") => vec!["codex".to_string()],
        Some("claude") => vec!["claude".to_string()],
        Some("cursor") => vec!["cursor".to_string()],
        Some("all") | None => vec![
            "codex".to_string(),
            "claude".to_string(),
            "cursor".to_string(),
        ],
        Some(_) => unreachable!("normalize_agent_selector returned an unsupported agent"),
    })
}

fn targets_for_agent(agent: Option<&str>, hooks: bool) -> io::Result<AgentSetupTargets> {
    Ok(match normalize_agent_selector(agent)? {
        Some("codex") => AgentSetupTargets {
            codex: true,
            claude: false,
            cursor: false,
            hooks,
        },
        Some("claude") => AgentSetupTargets {
            codex: false,
            claude: true,
            cursor: false,
            hooks,
        },
        Some("cursor") => AgentSetupTargets {
            codex: false,
            claude: false,
            cursor: true,
            hooks,
        },
        Some("all") | None => AgentSetupTargets {
            codex: true,
            claude: true,
            cursor: true,
            hooks,
        },
        Some(_) => unreachable!("normalize_agent_selector returned an unsupported agent"),
    })
}

fn normalize_agent_selector(agent: Option<&str>) -> io::Result<Option<&'static str>> {
    match agent.map(str::trim).filter(|value| !value.is_empty()) {
        Some(agent) if agent.eq_ignore_ascii_case("codex") => Ok(Some("codex")),
        Some(agent) if agent.eq_ignore_ascii_case("claude") => Ok(Some("claude")),
        Some(agent)
            if agent.eq_ignore_ascii_case("claude-code")
                || agent.eq_ignore_ascii_case("claude_code") =>
        {
            Ok(Some("claude"))
        }
        Some(agent) if agent.eq_ignore_ascii_case("cursor") => Ok(Some("cursor")),
        Some(agent) if agent.eq_ignore_ascii_case("all") => Ok(Some("all")),
        Some(agent) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid memory agent '{agent}'; expected codex, claude, cursor, or all"),
        )),
        None => Ok(None),
    }
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
    pub action: AgentSetupChangeAction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentSetupChangeAction {
    Write,
    RemoveFile,
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
            action: AgentSetupChangeAction::Write,
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
                action: AgentSetupChangeAction::Write,
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
            action: AgentSetupChangeAction::Write,
        });
    }

    if targets.claude {
        changes.push(AgentSetupChange {
            path: paths.home.join(".claude/skills/mdx-memory/SKILL.md"),
            contents: mdx_memory_skill(root_path, &paths.mdx_cli),
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".claude/CLAUDE.md"),
            contents: update_agent_markdown_block(
                &paths.home.join(".claude/CLAUDE.md"),
                &claude_memory_block(root_path, &paths.mdx_cli),
            )?,
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        if targets.hooks {
            changes.push(AgentSetupChange {
                path: paths.home.join(".claude/hooks/hooks.json"),
                contents: update_claude_hooks(
                    &paths.home.join(".claude/hooks/hooks.json"),
                    &paths.mdx_cli,
                    root_path,
                )?,
                executable: false,
                action: AgentSetupChangeAction::Write,
            });
        }
    }

    if targets.cursor {
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/skills/mdx-memory/SKILL.md"),
            contents: mdx_memory_skill(root_path, &paths.mdx_cli),
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/mcp.json"),
            contents: update_cursor_mcp(
                &paths.home.join(".cursor/mcp.json"),
                &paths.mdx_mcp,
                root_path,
            )?,
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/rules/mdx-memory.mdc"),
            contents: cursor_memory_rule(root_path, &paths.mdx_cli),
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        if targets.hooks {
            changes.push(AgentSetupChange {
                path: paths.home.join(".cursor/hooks.json"),
                contents: update_cursor_hooks(
                    &paths.home.join(".cursor/hooks.json"),
                    &paths.mdx_cli,
                    root_path,
                )?,
                executable: false,
                action: AgentSetupChangeAction::Write,
            });
        }
    }

    Ok(changes)
}

pub fn plan_memory_agent_repair(
    root_path: &str,
    agent: Option<&str>,
    paths: &AgentSetupPaths,
) -> io::Result<Vec<AgentSetupChange>> {
    let targets = targets_for_agent(agent, true)?;
    plan_memory_agent_setup(root_path, &targets, paths)
}

pub fn plan_memory_agent_uninstall(
    agent: Option<&str>,
    paths: &AgentSetupPaths,
) -> io::Result<Vec<AgentSetupChange>> {
    let selected = agent_sources(agent)?;
    let mut changes = Vec::new();

    if selected.iter().any(|agent| agent == "codex") {
        for path in [
            paths.home.join(".codey/skills/mdx-memory/SKILL.md"),
            paths.home.join(".agents/skills/mdx-memory/SKILL.md"),
        ] {
            push_remove_file_contents_if_exists(&mut changes, path)?;
        }
        push_if_changed(
            &mut changes,
            paths.home.join(".codey/config.toml"),
            |path| remove_codex_config(path),
        )?;
    }

    if selected.iter().any(|agent| agent == "claude") {
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.home.join(".claude/skills/mdx-memory/SKILL.md"),
        )?;
        push_if_changed(
            &mut changes,
            paths.home.join(".claude/CLAUDE.md"),
            remove_agent_markdown_block,
        )?;
        push_if_changed(
            &mut changes,
            paths.home.join(".claude/hooks/hooks.json"),
            remove_claude_hooks,
        )?;
    }

    if selected.iter().any(|agent| agent == "cursor") {
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.home.join(".cursor/skills/mdx-memory/SKILL.md"),
        )?;
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.home.join(".cursor/rules/mdx-memory.mdc"),
        )?;
        push_if_changed(
            &mut changes,
            paths.home.join(".cursor/mcp.json"),
            remove_cursor_mcp,
        )?;
        push_if_changed(
            &mut changes,
            paths.home.join(".cursor/hooks.json"),
            remove_cursor_hooks,
        )?;
    }

    Ok(changes)
}

pub fn apply_agent_setup_changes(changes: &[AgentSetupChange]) -> io::Result<()> {
    for change in changes {
        match change.action {
            AgentSetupChangeAction::Write => {
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
            AgentSetupChangeAction::RemoveFile => match fs::remove_file(&change.path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            },
        }
    }
    Ok(())
}

pub fn memory_agent_doctor_for_home(
    root_path: &str,
    home: &Path,
) -> io::Result<MemoryDoctorReport> {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let statuses = vec![
        inspect_codex_status(root_path, home, &mut errors, &mut warnings),
        inspect_claude_status(root_path, home, &mut errors, &mut warnings),
        inspect_cursor_status(root_path, home, &mut errors, &mut warnings),
    ];
    let ok = errors.is_empty() && statuses.iter().all(status_ok);
    Ok(MemoryDoctorReport {
        ok,
        statuses,
        errors,
        warnings,
    })
}

fn status_ok(status: &MemoryIntegrationStatus) -> bool {
    status.installed && status.enabled && status.authorized && status.doctor_status == "ok"
}

pub fn render_agent_setup_summary(changes: &[AgentSetupChange], dry_run: bool) -> String {
    let action = if dry_run { "would_write" } else { "wrote" };
    let mut lines = vec![format!("memory agent setup {action}:")];
    for change in changes {
        let action = match (dry_run, change.action) {
            (true, AgentSetupChangeAction::Write) => "would_write",
            (false, AgentSetupChangeAction::Write) => "wrote",
            (true, AgentSetupChangeAction::RemoveFile) => "would_remove",
            (false, AgentSetupChangeAction::RemoveFile) => "removed",
        };
        lines.push(format!("- {action} {}", change.path.display()));
    }
    lines.join("\n")
}

fn inspect_codex_status(
    root_path: &str,
    home: &Path,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> MemoryIntegrationStatus {
    let config = read_status_file(&home.join(".codey/config.toml"), "codex", errors);
    let agents_skill = read_status_file(
        &home.join(".agents/skills/mdx-memory/SKILL.md"),
        "codex",
        errors,
    );
    let codey_skill = read_status_file(
        &home.join(".codey/skills/mdx-memory/SKILL.md"),
        "codex",
        errors,
    );
    let config_ok = config.as_deref().is_some_and(|contents| {
        contents.contains("[mcp_servers.mdx-memory]") && contents.contains(root_path)
    });
    let skill_ok = agents_skill
        .as_deref()
        .or(codey_skill.as_deref())
        .is_some_and(|contents| contents.contains("name: mdx-memory"));
    build_status("codex", config_ok && skill_ok, None, warnings)
}

fn inspect_claude_status(
    root_path: &str,
    home: &Path,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> MemoryIntegrationStatus {
    let claude_md = read_status_file(&home.join(".claude/CLAUDE.md"), "claude", errors);
    let hooks = read_status_file(&home.join(".claude/hooks/hooks.json"), "claude", errors);
    let skill = read_status_file(
        &home.join(".claude/skills/mdx-memory/SKILL.md"),
        "claude",
        errors,
    );
    let block_ok = claude_md
        .as_deref()
        .is_some_and(|contents| contents.contains(MDX_MEMORY_BLOCK_BEGIN));
    let skill_ok = skill
        .as_deref()
        .is_some_and(|contents| contents.contains("name: mdx-memory"));
    let hook_ok = hooks.as_deref().is_some_and(|contents| {
        contents.contains("\"mdx-memory\"")
            && contents.contains("\"hook\"")
            && contents.contains("\"claude\"")
            && contents.contains(root_path)
    });
    build_status(
        "claude",
        block_ok && skill_ok && hook_ok,
        hook_ok.then(|| MDX_MEMORY_HOOK_VERSION.to_string()),
        warnings,
    )
}

fn inspect_cursor_status(
    root_path: &str,
    home: &Path,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> MemoryIntegrationStatus {
    let mcp = read_status_file(&home.join(".cursor/mcp.json"), "cursor", errors);
    let hooks = read_status_file(&home.join(".cursor/hooks.json"), "cursor", errors);
    let rule = read_status_file(&home.join(".cursor/rules/mdx-memory.mdc"), "cursor", errors);
    let skill = read_status_file(
        &home.join(".cursor/skills/mdx-memory/SKILL.md"),
        "cursor",
        errors,
    );
    let mcp_ok = mcp.as_deref().is_some_and(|contents| {
        contents.contains("\"mdx-memory\"") && contents.contains(root_path)
    });
    let hook_ok = hooks.as_deref().is_some_and(|contents| {
        contents.contains("\"mdx-memory\"")
            && contents.contains("\"hook\"")
            && contents.contains("\"cursor\"")
            && contents.contains(root_path)
    });
    let rule_ok = rule
        .as_deref()
        .is_some_and(|contents| contents.contains("MDX Memory"));
    let skill_ok = skill
        .as_deref()
        .is_some_and(|contents| contents.contains("name: mdx-memory"));
    build_status(
        "cursor",
        mcp_ok && hook_ok && rule_ok && skill_ok,
        hook_ok.then(|| MDX_MEMORY_HOOK_VERSION.to_string()),
        warnings,
    )
}

fn read_status_file(path: &Path, agent: &str, errors: &mut Vec<String>) -> Option<String> {
    match fs::read_to_string(path) {
        Ok(contents) => Some(contents),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            errors.push(format!(
                "{agent} installer-managed file unreadable: {}: {error}",
                path.display()
            ));
            None
        }
    }
}

fn build_status(
    agent_source: &str,
    installed: bool,
    hook_version: Option<String>,
    warnings: &mut Vec<String>,
) -> MemoryIntegrationStatus {
    if !installed {
        warnings.push(format!("{agent_source} not installed or not configured"));
    }
    MemoryIntegrationStatus {
        agent_source: agent_source.to_string(),
        installed,
        enabled: installed,
        authorized: installed,
        hook_version,
        last_event_at: None,
        last_error: None,
        doctor_status: if installed {
            "ok".to_string()
        } else {
            "not_installed_or_configured".to_string()
        },
    }
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

fn remove_codex_config(path: &Path) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if !existing.contains("[mcp_servers.mdx-memory]") {
        return Ok(existing);
    }
    Ok(remove_toml_table(&existing, "[mcp_servers.mdx-memory]"))
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
    if value
        .get("mcpServers")
        .and_then(|item| item.as_object())
        .is_none()
    {
        value["mcpServers"] = serde_json::json!({});
    }
    value["mcpServers"]["mdx-memory"] = serde_json::json!({
        "command": mdx_mcp,
        "args": ["--workspace", root_path]
    });
    pretty_json(&value)
}

fn remove_cursor_mcp(path: &Path) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if !existing.contains("\"mdx-memory\"") {
        return Ok(existing);
    }
    let mut value = read_optional_json(path)?;
    if let Some(servers) = value
        .get_mut("mcpServers")
        .and_then(|item| item.as_object_mut())
    {
        servers.remove("mdx-memory");
    }
    pretty_json(&value)
}

fn update_cursor_hooks(path: &Path, mdx_cli: &str, root_path: &str) -> io::Result<String> {
    let mut value = read_optional_json(path)?;
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value["version"] = value
        .get("version")
        .cloned()
        .unwrap_or(serde_json::json!(1));
    if value
        .get("hooks")
        .and_then(|item| item.as_object())
        .is_none()
    {
        value["hooks"] = serde_json::json!({});
    }
    if value["hooks"]
        .get("preCompact")
        .and_then(|item| item.as_array())
        .is_none()
    {
        value["hooks"]["preCompact"] = serde_json::json!([]);
    }
    let precompact = value["hooks"]["preCompact"].as_array_mut().unwrap();
    precompact.retain(|entry| !is_mdx_memory_json_entry(entry));
    precompact.push(serde_json::json!({
        "id": "mdx-memory",
        "name": "mdx-memory",
        "version": MDX_MEMORY_HOOK_VERSION,
        "command": mdx_cli,
        "args": ["memory", "--root", root_path, "hook", "cursor", "preCompact"],
        "timeout": 60
    }));
    pretty_json(&value)
}

fn remove_cursor_hooks(path: &Path) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if !existing.contains("mdx-memory") && !existing.contains("mdx-memory-precompact-hook") {
        return Ok(existing);
    }
    let mut value = read_optional_json(path)?;
    if let Some(hooks) = value.get_mut("hooks").and_then(|item| item.as_object_mut()) {
        if let Some(precompact) = hooks
            .get_mut("preCompact")
            .and_then(|item| item.as_array_mut())
        {
            precompact.retain(|entry| !is_mdx_memory_json_entry(entry));
        }
    }
    pretty_json(&value)
}

fn update_claude_hooks(path: &Path, mdx_cli: &str, root_path: &str) -> io::Result<String> {
    let mut value = read_optional_json(path)?;
    if !value.is_object() {
        value = serde_json::json!({ "hooks": {} });
    }
    if value
        .get("hooks")
        .and_then(|item| item.as_object())
        .is_none()
    {
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
    precompact.retain(|entry| !is_mdx_memory_json_entry(entry));
    let command = format!(
        "{} memory --root {} hook claude PreCompact",
        shell_quote(mdx_cli),
        shell_quote(root_path)
    );
    precompact.push(serde_json::json!({
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": command,
            "async": true,
            "timeout": 60
        }],
        "description": "Capture and accept MDX Memory before context compaction when transcript_path is available",
        "id": "mdx-memory",
        "name": "mdx-memory",
        "version": MDX_MEMORY_HOOK_VERSION
    }));
    pretty_json(&value)
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    if value
        .bytes()
        .all(|byte| matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-' | b'.' | b'/' | b':' | b'+' | b'='))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn remove_claude_hooks(path: &Path) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if !existing.contains("mdx-memory") && !existing.contains("mdx-memory-precompact-hook") {
        return Ok(existing);
    }
    let mut value = read_optional_json(path)?;
    if let Some(hooks) = value.get_mut("hooks").and_then(|item| item.as_object_mut()) {
        if let Some(precompact) = hooks
            .get_mut("PreCompact")
            .and_then(|item| item.as_array_mut())
        {
            precompact.retain(|entry| !is_mdx_memory_json_entry(entry));
        }
    }
    pretty_json(&value)
}

fn is_mdx_memory_json_entry(entry: &serde_json::Value) -> bool {
    entry
        .get("id")
        .and_then(|id| id.as_str())
        .is_some_and(|id| id == "mdx-memory" || id.starts_with("mdx-memory:"))
        || entry.get("name").and_then(|name| name.as_str()) == Some("mdx-memory")
        || entry
            .get("command")
            .and_then(|command| command.as_str())
            .is_some_and(|command| command.contains("mdx-memory-precompact-hook"))
        || entry.to_string().contains("mdx-memory-precompact-hook")
}

fn push_remove_file_contents_if_exists(
    changes: &mut Vec<AgentSetupChange>,
    path: PathBuf,
) -> io::Result<()> {
    if path.exists() {
        changes.push(AgentSetupChange {
            path,
            contents: String::new(),
            executable: false,
            action: AgentSetupChangeAction::RemoveFile,
        });
    }
    Ok(())
}

fn push_if_changed(
    changes: &mut Vec<AgentSetupChange>,
    path: PathBuf,
    update: impl FnOnce(&Path) -> io::Result<String>,
) -> io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let existing = read_optional_file(&path)?;
    let contents = update(&path)?;
    if contents != existing {
        changes.push(AgentSetupChange {
            path,
            contents,
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
    }
    Ok(())
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
    let mut output = remove_managed_markdown_block(&existing)
        .trim_end()
        .to_string();
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(MDX_MEMORY_BLOCK_BEGIN);
    output.push('\n');
    output.push_str(block);
    output.push('\n');
    output.push_str(MDX_MEMORY_BLOCK_END);
    output.push('\n');
    Ok(output)
}

fn remove_agent_markdown_block(path: &Path) -> io::Result<String> {
    read_optional_file(path).map(|existing| remove_managed_markdown_block(&existing))
}

fn remove_managed_markdown_block(contents: &str) -> String {
    let Some(begin) = contents.find(MDX_MEMORY_BLOCK_BEGIN) else {
        return contents.to_string();
    };
    let Some(relative_end) = contents[begin..].find(MDX_MEMORY_BLOCK_END) else {
        return contents.to_string();
    };
    let end = begin + relative_end + MDX_MEMORY_BLOCK_END.len();
    let mut output = String::new();
    output.push_str(contents[..begin].trim_end());
    let tail = contents[end..].trim_start_matches(['\r', '\n']);
    if !output.is_empty() && !tail.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(tail);
    output
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

const captureResult = spawnSync(
  MDX_CLI,
  [
    "memory",
    "--root",
    MEMORY_ROOT,
    "capture",
    "import",
    "--path",
    transcriptPath,
  ],
  {{ encoding: "utf8", timeout: 60_000 }},
);

if (captureResult.error) {{
  process.stderr.write(`[mdx-memory] pre-compact capture skipped: ${{captureResult.error.message}}\n`);
  process.exit(0);
}}

if (captureResult.status !== 0) {{
  process.stderr.write(
    `[mdx-memory] pre-compact capture failed: ${{captureResult.stderr || captureResult.stdout || "unknown error"}}\n`,
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

1. Call `memory_recall` with a task-specific `query`. It returns the conclusions that apply, a brief with citations, and matching material.
2. Use `memory_search` when the user asks to find something specific rather than load task context.
3. Cite what you use: every item carries the id and source file it came from.
4. Keep recalled context scoped to the current task; explicit user instructions still win.

CLI fallback:

```bash
{mdx_cli} memory --root "{root_path}" recall "<task query>"
{mdx_cli} memory --root "{root_path}" search "<exact query>"
```

## Durable Memory Write Flow

Memory has two layers, and knowing which one you are writing to is the whole job.

**Material** is what happened, stored verbatim: `memory_add`. A decision and the reasoning behind it, a measurement, a chunk of conversation worth keeping. Material is a record, not a claim — nothing is inferred from it, and storing it commits nobody to anything.

**Conclusions** are what you take material to mean: `memory_distill`, referencing the material ids it rests on. A conclusion starts as a candidate and reaches nobody's context until a person adopts it. Do not adopt on the user's behalf without asking.

Good material to keep:

- decisions and the reasons behind them
- durable user preferences
- project-specific conventions
- resolved ambiguity or a changed direction
- a lesson that cost something to learn

CLI fallback:

```bash
{mdx_cli} memory --root "{root_path}" add --body "<what happened>"
{mdx_cli} memory --root "{root_path}" distill --statement "<the claim>" --body "<why>" --ref <material-id>
```

Capture is one-way. Anything written can be deleted afterwards but never unremembered, so do not store secrets, credentials, or anything the user has not confirmed.

## Agent-Time Memory Extraction

Extract and write durable memories during active conversation turns when decisions, stable preferences, project constraints, or reusable lessons become clear. Do not wait for background capture, thread archival, or pre-compact hooks before preserving confirmed information that should survive future sessions.

Use background capture as a fallback safety net, not as the primary workflow. If the user asks to remember something, or the conversation resolves something worth keeping, call `memory_add` in that turn. Ask before storing anything sensitive or uncertain: there is no holding area any more, so material goes straight into the library.

## Pre-Compact Memory Capture

Pre-compact hooks are for memory capture before context compression. They are not the same as explicit thread archival.

Claude and Cursor hooks call `~/.mdx-memory-precompact-hook.mjs` on pre-compact events. When the hook input includes a valid `transcript_path`, the hook reads that transcript in as material so the conversation survives compression. It stops there: it does not draw conclusions, because nothing about a compression event tells anyone what the conversation meant. If no transcript path is available, the hook silently skips.

Codex currently relies on explicit MCP/CLI calls for pre-compact capture unless a verified Codex lifecycle hook exposes a transcript path.

## Keeping A Whole Conversation

A transcript is material like anything else: read it in with `capture import --path <file>` and it is stored verbatim with its source. There is no separate thread layer, no archival step, and no automatic extraction — turning a conversation into a conclusion is a judgement, so it goes through `memory_distill` and a person's adoption like every other conclusion.

CLI fallback:

```bash
{mdx_cli} memory --root "{root_path}" capture scan --path <file-or-dir>
{mdx_cli} memory --root "{root_path}" capture import --path <file-or-dir>
```

## Safety

- Ask before storing sensitive personal data, credentials, private keys, tokens, or third-party confidential material.
- If uncertain whether something is worth keeping, ask briefly or put it in the final answer as a suggested memory.
- Never invent provenance. Include source thread/path only when available.
- Do not promote to wiki unless explicitly requested.
"#
    )
}

fn claude_memory_block(root_path: &str, mdx_cli: &str) -> String {
    format!(
        "## MDX Memory\nWhen the user asks to remember, save, recall, search, persist decisions, or load prior context, use the `mdx-memory` skill and the `mdx-memory` MCP server.\n\nUse `memory_recall` for task context and cite what you use. Store what happened with `memory_add` during the turn it happens; draw conclusions from stored material with `memory_distill`, which produces a candidate that only a person can adopt. Do not wait for background capture or pre-compact hooks before preserving something confirmed. Ask before storing anything sensitive or uncertain — capture is one-way. Pre-compact hooks capture and accept distilled memory before compression; the installed Claude hook command is `{mdx_cli} memory --root \"{root_path}\" hook claude PreCompact`. Full thread archival is separate and should only be used when preserving original conversation text matters. Do not store secrets or promote memory into wiki/raw material unless the user explicitly asks."
    )
}

fn cursor_memory_rule(root_path: &str, mdx_cli: &str) -> String {
    format!(
        r#"---
description: Use MDX Memory when remembering, saving, recalling, searching prior context, persisting decisions, or summarizing durable lessons.
alwaysApply: true
---

Use the `mdx-memory` skill and the `mdx-memory` MCP server for durable memory.

Read task context with `memory_recall` and cite what you use. Find specific items with `memory_search`. Store what happened with `memory_add` during the turn it happens; draw conclusions from stored material with `memory_distill`, which produces a candidate that only a person can adopt. Do not wait for background capture or pre-compact hooks before preserving something confirmed. Ask before storing anything sensitive or uncertain — capture is one-way. Pre-compact hooks capture and accept distilled memory before compression; the installed Cursor hook command is `{mdx_cli} memory --root "{root_path}" hook cursor preCompact`. Full thread archival is separate and should only be used when preserving original conversation text matters. Do not store secrets.
"#
    )
}
