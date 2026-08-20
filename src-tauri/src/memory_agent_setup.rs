use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::memory_models::{MemoryDoctorReport, MemoryIntegrationStatus};

pub const LOAM_MEMORY_HOOK_VERSION: &str = "1";
pub const CLAUDE_MCP_SERVER_NAME: &str = "loam-memory";
const AGENT_COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
pub const LOAM_MEMORY_BLOCK_BEGIN: &str = "<!-- BEGIN LOAM MEMORY v1 -->";
pub const LOAM_MEMORY_BLOCK_END: &str = "<!-- END LOAM MEMORY -->";

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
    pub loam_cli: Option<String>,
    #[serde(default)]
    pub loam_mcp: Option<String>,
    #[serde(default)]
    pub claude_cli: Option<String>,
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
    let paths = AgentSetupPaths::resolve(
        request.loam_cli.as_deref(),
        request.loam_mcp.as_deref(),
        request.claude_cli.as_deref(),
    )?;
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
    let paths = AgentSetupPaths::resolve(None, None, None)?;
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
    let paths = AgentSetupPaths::resolve(None, None, None)?;
    let changes = plan_memory_agent_uninstall(request.agent.as_deref(), &paths)?;

    if !request.dry_run {
        apply_agent_setup_changes(&changes)?;
    }

    let data_note = if request.keep_data {
        "keeping memory data"
    } else {
        "memory data preserved; installer uninstall only removes agent integration files"
    };
    let left_registered = claude_mcp_left_registered(request.agent.as_deref(), &paths)?;
    let mut summary = render_agent_setup_summary(&changes, request.dry_run);
    if left_registered {
        summary.push_str(&format!(
            "\n- left registered: the {CLAUDE_MCP_SERVER_NAME} MCP server in \
             ~/.claude.json, because the claude CLI is not on this machine to \
             remove it with"
        ));
    }
    Ok(MemoryAgentSetupResult {
        dry_run: request.dry_run,
        changed_paths: changes
            .iter()
            .map(|change| change.path.to_string_lossy().into_owned())
            .collect(),
        summary: format!("{summary}\n{data_note}"),
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
        loam_cli: None,
        loam_mcp: None,
        claude_cli: None,
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
    pub loam_cli: String,
    pub loam_mcp: String,
    // Claude keeps its MCP registry in `~/.claude.json`, a file it rewrites while
    // it runs, and registration goes through its own CLI rather than that file.
    // `None` when Claude Code is not on this machine, and then the claude branch
    // refuses rather than installing an instruction block for tools that will not
    // exist.
    pub claude_cli: Option<String>,
    // `CLAUDE_CONFIG_DIR`, when it is set: the docs say every `~/.claude` path
    // moves under it. `~/.claude.json` is not one of those paths — it is the
    // directory's sibling — and where it goes is undocumented, so it was measured:
    // with the variable set the registry is `$CLAUDE_CONFIG_DIR/.claude.json`,
    // inside the directory, dot and all. The two cases are not symmetrical, which
    // is why this carries the directory rather than deriving both from one root.
    pub claude_config_dir: Option<PathBuf>,
    pub hook_script: PathBuf,
}

impl AgentSetupPaths {
    pub fn resolve(
        loam_cli: Option<&str>,
        loam_mcp: Option<&str>,
        claude_cli: Option<&str>,
    ) -> io::Result<Self> {
        let home = home_dir()?;
        let current_exe = env::current_exe()?;
        let loam_cli = match loam_cli {
            Some(path) => normalize_path(path)?,
            None => find_bundled_binary(&current_exe, "loam-cli")
                .unwrap_or_else(|| current_exe.clone())
                .to_string_lossy()
                .into_owned(),
        };
        let loam_mcp = match loam_mcp {
            Some(path) => normalize_path(path)?,
            None => find_bundled_binary(&current_exe, "loam-mcp")
                .unwrap_or_else(|| {
                    current_exe
                        .parent()
                        .unwrap_or_else(|| Path::new(""))
                        .join("loam-mcp")
                })
                .to_string_lossy()
                .into_owned(),
        };
        let claude_cli = match claude_cli {
            Some(path) => Some(normalize_path(path)?),
            None => find_claude_cli(&home),
        };
        Ok(Self {
            hook_script: home.join(".loam-memory-precompact-hook.mjs"),
            home,
            loam_cli,
            loam_mcp,
            claude_cli,
            claude_config_dir: claude_config_dir_from_env(),
        })
    }

    /// Where `CLAUDE.md`, `settings.json` and `skills/` live.
    pub fn claude_dir(&self) -> PathBuf {
        self.claude_config_dir
            .clone()
            .unwrap_or_else(|| self.home.join(".claude"))
    }

    /// Where the user-scope `mcpServers` registry lives.
    pub fn claude_registry(&self) -> PathBuf {
        match &self.claude_config_dir {
            Some(dir) => dir.join(".claude.json"),
            None => self.home.join(".claude.json"),
        }
    }
}

// Passed through as given. Whether a relative path or a `~` is accepted is
// undocumented, so this does not decide: the same string Claude was given is the
// string used here, and the command run to register the server inherits it.
fn claude_config_dir_from_env() -> Option<PathBuf> {
    env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

// A GUI process inherits a minimal `PATH`, so the places Claude Code actually
// installs itself are checked as well rather than trusting `PATH` alone.
fn find_claude_cli(home: &Path) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|dir| dir.join("claude")));
    }
    candidates.push(home.join(".claude/local/claude"));
    candidates.push(home.join(".local/bin/claude"));
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
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

#[derive(Debug)]
pub struct AgentSetupChange {
    pub path: PathBuf,
    pub contents: String,
    pub executable: bool,
    pub action: AgentSetupChangeAction,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AgentSetupChangeAction {
    Write,
    RemoveFile,
    // For the one piece of state this installer does not own: Claude's MCP
    // registry. `path` still names the file the command ends up editing, so a
    // plan and its summary stay readable.
    RunCommand {
        program: String,
        args: Vec<String>,
        home: PathBuf,
    },
}

pub fn plan_memory_agent_setup(
    root_path: &str,
    targets: &AgentSetupTargets,
    paths: &AgentSetupPaths,
) -> io::Result<Vec<AgentSetupChange>> {
    let mut changes = Vec::new();

    if targets.claude || targets.cursor {
        // Earlier versions wrote this wrapper on every install and nothing ever
        // invoked it: `loam-cli hook` reads the payload and stores the transcript
        // itself. A repair is how most machines will pass through here, so it is
        // where the leftover goes.
        push_remove_file_contents_if_exists(&mut changes, paths.hook_script.clone())?;
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.home.join(".mdx-memory-precompact-hook.mjs"),
        )?;
    }

    if targets.codex {
        // `~/.codex`, which is where Codex reads: its own `AGENTS.md` is the file
        // with real content in it, and it is where mempal registered its MCP before
        // this. The install used to write `~/.codey` — a directory that also exists
        // on some machines, so nothing failed; the integration simply landed
        // somewhere the agent never looks.
        for skill_root in [
            paths.home.join(".codex/skills/loam-memory/SKILL.md"),
            paths.home.join(".agents/skills/loam-memory/SKILL.md"),
        ] {
            changes.push(AgentSetupChange {
                path: skill_root,
                contents: loam_memory_skill(root_path, &paths.loam_cli),
                executable: false,
                action: AgentSetupChangeAction::Write,
            });
        }
        changes.push(AgentSetupChange {
            path: paths.home.join(".codex/config.toml"),
            contents: update_codex_config(
                &paths.home.join(".codex/config.toml"),
                &paths.loam_mcp,
                root_path,
            )?,
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        // The instruction block, the same way Claude gets one. Without it a
        // correctly registered MCP server is a set of tools nothing tells the agent
        // to reach for — which is the difference this integration had against
        // mempal, whose own block sat in this file until it was switched off.
        // Everything outside our markers is preserved, including that block.
        changes.push(AgentSetupChange {
            path: paths.home.join(".codex/AGENTS.md"),
            contents: update_agent_markdown_block(
                &paths.home.join(".codex/AGENTS.md"),
                &codex_memory_block(root_path, &paths.loam_cli),
            )?,
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
    }

    if targets.claude {
        // First, so that a registration that cannot be done leaves nothing written:
        // the block that goes into CLAUDE.md tells the agent to call `memory_recall`,
        // and that is only true once the server is there.
        changes.extend(claude_mcp_changes(paths, root_path)?);
        changes.push(AgentSetupChange {
            path: paths.claude_dir().join("skills/loam-memory/SKILL.md"),
            contents: loam_memory_skill(root_path, &paths.loam_cli),
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        changes.push(AgentSetupChange {
            path: paths.claude_dir().join("CLAUDE.md"),
            contents: update_agent_markdown_block(
                &paths.claude_dir().join("CLAUDE.md"),
                &claude_memory_block(root_path, &paths.loam_cli),
            )?,
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        if targets.hooks {
            // Claude loads hooks from its settings files. `hooks/hooks.json` is a
            // plugin bundle's layout; a copy of that name under the user's own
            // `~/.claude` is read by nothing, so the PreCompact entry written there
            // never fired once — while the doctor kept reporting it installed,
            // because it was reading the same dead file back.
            changes.push(AgentSetupChange {
                path: paths.claude_dir().join("settings.json"),
                contents: update_claude_settings_hooks(
                    &paths.claude_dir().join("settings.json"),
                    &paths.loam_cli,
                    root_path,
                )?,
                executable: false,
                action: AgentSetupChangeAction::Write,
            });
            // And take the dead entry back out on the way past.
            push_if_changed(
                &mut changes,
                paths.claude_dir().join("hooks/hooks.json"),
                |path| remove_claude_hooks(path, &paths.loam_cli),
            )?;
        }
    }

    if targets.cursor {
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/skills/loam-memory/SKILL.md"),
            contents: loam_memory_skill(root_path, &paths.loam_cli),
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/mcp.json"),
            contents: update_cursor_mcp(
                &paths.home.join(".cursor/mcp.json"),
                &paths.loam_mcp,
                root_path,
            )?,
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        changes.push(AgentSetupChange {
            path: paths.home.join(".cursor/rules/loam-memory.mdc"),
            contents: cursor_memory_rule(root_path, &paths.loam_cli),
            executable: false,
            action: AgentSetupChangeAction::Write,
        });
        if targets.hooks {
            changes.push(AgentSetupChange {
                path: paths.home.join(".cursor/hooks.json"),
                contents: update_cursor_hooks(
                    &paths.home.join(".cursor/hooks.json"),
                    &paths.loam_cli,
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
            paths.home.join(".codex/skills/loam-memory/SKILL.md"),
            paths.home.join(".agents/skills/loam-memory/SKILL.md"),
        ] {
            push_remove_file_contents_if_exists(&mut changes, path)?;
        }
        push_if_changed(
            &mut changes,
            paths.home.join(".codex/config.toml"),
            |path| remove_codex_config(path),
        )?;
        // Only our own block comes out of AGENTS.md; anything else in the file,
        // including another tool's section, is left exactly as it was.
        push_if_changed(
            &mut changes,
            paths.home.join(".codex/AGENTS.md"),
            remove_agent_markdown_block,
        )?;
    }

    if selected.iter().any(|agent| agent == "claude") {
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.claude_dir().join("skills/loam-memory/SKILL.md"),
        )?;
        push_if_changed(
            &mut changes,
            paths.claude_dir().join("CLAUDE.md"),
            remove_agent_markdown_block,
        )?;
        push_if_changed(
            &mut changes,
            paths.claude_dir().join("settings.json"),
            |path| remove_claude_hooks(path, &paths.loam_cli),
        )?;
        push_if_changed(
            &mut changes,
            paths.claude_dir().join("hooks/hooks.json"),
            |path| remove_claude_hooks(path, &paths.loam_cli),
        )?;
        changes.extend(claude_mcp_removal(paths)?);
    }

    if selected.iter().any(|agent| agent == "claude" || agent == "cursor") {
        push_remove_file_contents_if_exists(&mut changes, paths.hook_script.clone())?;
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.home.join(".mdx-memory-precompact-hook.mjs"),
        )?;
    }

    if selected.iter().any(|agent| agent == "cursor") {
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.home.join(".cursor/skills/loam-memory/SKILL.md"),
        )?;
        push_remove_file_contents_if_exists(
            &mut changes,
            paths.home.join(".cursor/rules/loam-memory.mdc"),
        )?;
        push_if_changed(
            &mut changes,
            paths.home.join(".cursor/mcp.json"),
            remove_cursor_mcp,
        )?;
        push_if_changed(
            &mut changes,
            paths.home.join(".cursor/hooks.json"),
            |path| remove_cursor_hooks(path, &paths.loam_cli),
        )?;
    }

    Ok(changes)
}

pub fn apply_agent_setup_changes(changes: &[AgentSetupChange]) -> io::Result<()> {
    for change in changes {
        match &change.action {
            AgentSetupChangeAction::Write => {
                if let Some(parent) = change.path.parent() {
                    fs::create_dir_all(parent)?;
                }
                // Through a temporary file in the same directory and a rename, so
                // that an interrupted install cannot leave someone's settings file
                // truncated. These are files the app writes into and does not own.
                let staged = change.path.with_extension(format!(
                    "{}loam-tmp",
                    change
                        .path
                        .extension()
                        .map(|extension| format!("{}.", extension.to_string_lossy()))
                        .unwrap_or_default()
                ));
                fs::write(&staged, &change.contents)?;
                fs::rename(&staged, &change.path)?;
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
            AgentSetupChangeAction::RunCommand {
                program,
                args,
                home,
            } => {
                // `HOME` is passed explicitly because it is the home being
                // configured that the command has to write into. The app and this
                // are the same home; a test's is not.
                let output = run_with_deadline(program, args, home)?;
                if !output.status.success() {
                    let detail = String::from_utf8_lossy(&output.stderr);
                    let detail = if detail.trim().is_empty() {
                        String::from_utf8_lossy(&output.stdout).trim().to_string()
                    } else {
                        detail.trim().to_string()
                    };
                    return Err(io::Error::new(
                        io::ErrorKind::Other,
                        format!("{program} {} failed: {detail}", args.join(" ")),
                    ));
                }
            }
        }
    }
    Ok(())
}

// `output()` waits for as long as the command takes, and the panel has no way to
// cancel: a row would sit on 安装中 for ever. The output of a config write is a
// line or two, well inside the pipe buffer, so polling for the exit and reading
// afterwards cannot deadlock on it.
fn run_with_deadline(
    program: &str,
    args: &[String],
    home: &Path,
) -> io::Result<std::process::Output> {
    let mut child = Command::new(program)
        .args(args)
        .env("HOME", home)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let deadline = std::time::Instant::now() + AGENT_COMMAND_TIMEOUT;
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output();
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "{program} {} did not finish within {} seconds",
                    args.join(" "),
                    AGENT_COMMAND_TIMEOUT.as_secs()
                ),
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
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
        if let AgentSetupChangeAction::RunCommand { program, args, .. } = &change.action {
            let action = if dry_run { "would_run" } else { "ran" };
            lines.push(format!("- {action} {program} {}", args.join(" ")));
            continue;
        }
        let action = match (dry_run, &change.action) {
            (true, AgentSetupChangeAction::Write) => "would_write",
            (false, AgentSetupChangeAction::Write) => "wrote",
            (true, AgentSetupChangeAction::RemoveFile) => "would_remove",
            (false, AgentSetupChangeAction::RemoveFile) => "removed",
            (_, AgentSetupChangeAction::RunCommand { .. }) => unreachable!(),
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
    let config = read_status_file(&home.join(".codex/config.toml"), "codex", errors);
    let agents_md = read_status_file(&home.join(".codex/AGENTS.md"), "codex", errors);
    let agents_skill = read_status_file(
        &home.join(".agents/skills/loam-memory/SKILL.md"),
        "codex",
        errors,
    );
    let codex_skill = read_status_file(
        &home.join(".codex/skills/loam-memory/SKILL.md"),
        "codex",
        errors,
    );
    let config_ok = config.as_deref().is_some_and(|contents| {
        contents.contains("[mcp_servers.loam-memory]") && contents.contains(root_path)
    });
    let skill_ok = agents_skill
        .as_deref()
        .or(codex_skill.as_deref())
        .is_some_and(|contents| contents.contains("name: loam-memory"));
    // Checked because it is now written: an install without the block leaves the
    // agent with tools and no instruction to use them.
    let block_ok = agents_md
        .as_deref()
        .is_some_and(|contents| contents.contains(LOAM_MEMORY_BLOCK_BEGIN));
    build_status("codex", config_ok && skill_ok && block_ok, None, warnings)
}

fn inspect_claude_status(
    root_path: &str,
    home: &Path,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> MemoryIntegrationStatus {
    // The same two rules the installer follows, so that the doctor cannot report on
    // files nothing wrote.
    let claude_dir = claude_config_dir_from_env().unwrap_or_else(|| home.join(".claude"));
    let registry_path = match claude_config_dir_from_env() {
        Some(dir) => dir.join(".claude.json"),
        None => home.join(".claude.json"),
    };
    let claude_md = read_status_file(&claude_dir.join("CLAUDE.md"), "claude", errors);
    let settings = read_status_file(&claude_dir.join("settings.json"), "claude", errors);
    let registry = read_status_file(&registry_path, "claude", errors);
    let skill = read_status_file(
        &claude_dir.join("skills/loam-memory/SKILL.md"),
        "claude",
        errors,
    );
    let block_ok = claude_md
        .as_deref()
        .is_some_and(|contents| contents.contains(LOAM_MEMORY_BLOCK_BEGIN));
    let skill_ok = skill
        .as_deref()
        .is_some_and(|contents| contents.contains("name: loam-memory"));
    // Read from the settings file Claude loads. This used to read the same
    // `hooks/hooks.json` the installer wrote, so `ok` meant only that the two
    // halves of a dead integration agreed with each other. An earlier fix made
    // that check parse rather than grep, which turned the panel green and removed
    // the one symptom pointing at the real fault.
    let hook_ok = settings
        .as_deref()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(contents).ok())
        .and_then(|value| {
            value
                .get("hooks")
                .and_then(|hooks| hooks.get("PreCompact"))
                .and_then(|entries| entries.as_array())
                .cloned()
        })
        .is_some_and(|entries| {
            entries.iter().any(|entry| {
                entry
                    .get("hooks")
                    .and_then(|hooks| hooks.as_array())
                    .is_some_and(|hooks| {
                        hooks.iter().any(|hook| {
                            hook.get("command")
                                .and_then(|command| command.as_str())
                                .is_some_and(|command| {
                                    // Against the quoted form: a workspace whose path
                                    // contains a quote is written escaped, and matching
                                    // the raw path would report a correct install as
                                    // missing, permanently.
                                    command.contains("hook claude")
                                        && command.contains(&shell_quote(root_path))
                                        // And the binary it names has to be there. The
                                        // app bundle moving used to leave every file in
                                        // place, pointing at nothing, with the panel
                                        // still reporting 已安装 and nothing prompting a
                                        // repair.
                                        && hook_command_program_exists(command)
                                })
                        })
                    })
            })
        });
    // And the MCP server, which the status never used to ask about — the one part
    // of the integration the instruction block in CLAUDE.md depends on.
    let mcp_ok = registry
        .as_deref()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(contents).ok())
        .and_then(|value| {
            value
                .get("mcpServers")
                .and_then(|servers| servers.get(CLAUDE_MCP_SERVER_NAME))
                .cloned()
        })
        .is_some_and(|entry| {
            let workspace_matches = entry
                .get("args")
                .and_then(|args| args.as_array())
                .is_some_and(|args| args.iter().any(|arg| arg.as_str() == Some(root_path)));
            let program_exists = entry
                .get("command")
                .and_then(|command| command.as_str())
                .is_some_and(|command| Path::new(command).is_file());
            workspace_matches && program_exists
        });
    build_status(
        "claude",
        block_ok && skill_ok && hook_ok && mcp_ok,
        // The version is ours, from the constant. It used to be read back out of
        // the file this installer had just written.
        hook_ok.then(|| LOAM_MEMORY_HOOK_VERSION.to_string()),
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
    let rule = read_status_file(&home.join(".cursor/rules/loam-memory.mdc"), "cursor", errors);
    let skill = read_status_file(
        &home.join(".cursor/skills/loam-memory/SKILL.md"),
        "cursor",
        errors,
    );
    let mcp_ok = mcp.as_deref().is_some_and(|contents| {
        contents.contains("\"loam-memory\"") && contents.contains(root_path)
    });
    let hook_ok = hooks.as_deref().is_some_and(|contents| {
        contents.contains("\"loam-memory\"")
            && contents.contains("\"hook\"")
            && contents.contains("\"cursor\"")
            && contents.contains(root_path)
    });
    let rule_ok = rule
        .as_deref()
        .is_some_and(|contents| contents.contains("Loam Memory"));
    let skill_ok = skill
        .as_deref()
        .is_some_and(|contents| contents.contains("name: loam-memory"));
    build_status(
        "cursor",
        mcp_ok && hook_ok && rule_ok && skill_ok,
        hook_ok.then(|| LOAM_MEMORY_HOOK_VERSION.to_string()),
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

fn update_codex_config(path: &Path, loam_mcp: &str, root_path: &str) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    let filtered = remove_toml_table(&existing, "[mcp_servers.loam-memory]");
    let mut output = filtered.trim_end().to_string();
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str("[mcp_servers.loam-memory]\n");
    output.push_str(&format!("command = \"{}\"\n", toml_escape(loam_mcp)));
    output.push_str(&format!(
        "args = [\"--workspace\", \"{}\"]\n",
        toml_escape(root_path)
    ));
    Ok(output)
}

fn remove_codex_config(path: &Path) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if !existing.contains("[mcp_servers.loam-memory]") {
        return Ok(existing);
    }
    Ok(remove_toml_table(&existing, "[mcp_servers.loam-memory]"))
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

fn update_cursor_mcp(path: &Path, loam_mcp: &str, root_path: &str) -> io::Result<String> {
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
    value["mcpServers"]["loam-memory"] = serde_json::json!({
        "command": loam_mcp,
        "args": ["--workspace", root_path]
    });
    pretty_json(&value)
}

fn remove_cursor_mcp(path: &Path) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if !existing.contains("\"loam-memory\"") {
        return Ok(existing);
    }
    let mut value = read_optional_json(path)?;
    if let Some(servers) = value
        .get_mut("mcpServers")
        .and_then(|item| item.as_object_mut())
    {
        servers.remove("loam-memory");
    }
    pretty_json(&value)
}

fn update_cursor_hooks(path: &Path, loam_cli: &str, root_path: &str) -> io::Result<String> {
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
    remove_loam_hook_entries(precompact, loam_cli);
    precompact.push(serde_json::json!({
        "id": "loam-memory",
        "name": "loam-memory",
        "version": LOAM_MEMORY_HOOK_VERSION,
        "command": loam_cli,
        "args": ["memory", "--root", root_path, "hook", "cursor", "preCompact"],
        "timeout": 60
    }));
    pretty_json(&value)
}

fn remove_cursor_hooks(path: &Path, loam_cli: &str) -> io::Result<String> {
    remove_json_hook_entries(path, "preCompact", loam_cli)
}

// Claude's own CLI owns the write to `~/.claude.json`, so registration is planned
// as a command rather than as file contents. `claude mcp add` refuses a name that
// is already taken instead of replacing it, so a stale entry is removed first and
// an entry that already matches produces no command at all.
fn claude_mcp_changes(
    paths: &AgentSetupPaths,
    root_path: &str,
) -> io::Result<Vec<AgentSetupChange>> {
    let registry = paths.claude_registry();
    let desired_args = vec!["--workspace".to_string(), root_path.to_string()];
    let existing = claude_registered_server(&registry)?;
    if let Some(entry) = &existing {
        let command_matches =
            entry.get("command").and_then(|value| value.as_str()) == Some(paths.loam_mcp.as_str());
        let args_match = entry
            .get("args")
            .and_then(|value| value.as_array())
            .is_some_and(|args| {
                args.iter()
                    .map(|arg| arg.as_str().unwrap_or_default())
                    .eq(desired_args.iter().map(String::as_str))
            });
        if command_matches && args_match {
            return Ok(Vec::new());
        }
    }
    let claude_cli = paths.claude_cli.as_deref().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "claude CLI not found, so the loam-memory MCP server cannot be registered: \
             install Claude Code, or install one of the other agents on its own \
             (--agent codex, --agent cursor)",
        )
    })?;
    let mut changes = Vec::new();
    if existing.is_some() {
        changes.push(claude_command(
            &registry,
            claude_cli,
            &paths.home,
            claude_mcp_remove_args(),
        ));
    }
    let mut add = vec![
        "mcp".to_string(),
        "add".to_string(),
        CLAUDE_MCP_SERVER_NAME.to_string(),
        "--scope".to_string(),
        "user".to_string(),
        "--".to_string(),
        paths.loam_mcp.clone(),
    ];
    add.extend(desired_args);
    changes.push(claude_command(&registry, claude_cli, &paths.home, add));
    Ok(changes)
}

fn claude_mcp_removal(paths: &AgentSetupPaths) -> io::Result<Vec<AgentSetupChange>> {
    let registry = paths.claude_registry();
    if claude_registered_server(&registry)?.is_none() {
        return Ok(Vec::new());
    }
    // Nothing to remove it with is not an error on the way out: the entry stays,
    // and the doctor keeps saying so.
    let Some(claude_cli) = paths.claude_cli.as_deref() else {
        return Ok(Vec::new());
    };
    Ok(vec![claude_command(
        &registry,
        claude_cli,
        &paths.home,
        claude_mcp_remove_args(),
    )])
}

/// Whether an uninstall leaves the MCP server registered because there is no
/// Claude CLI on this machine to unregister it with. Only Claude's CLI can undo
/// what Claude's CLI did, and a summary listing clean removals over a server that
/// is still there is the same kind of lie the doctor used to tell.
pub fn claude_mcp_left_registered(
    agent: Option<&str>,
    paths: &AgentSetupPaths,
) -> io::Result<bool> {
    if !agent_sources(agent)?.iter().any(|agent| agent == "claude") {
        return Ok(false);
    }
    if paths.claude_cli.is_some() {
        return Ok(false);
    }
    Ok(claude_registered_server(&paths.claude_registry())?.is_some())
}

fn claude_mcp_remove_args() -> Vec<String> {
    vec![
        "mcp".to_string(),
        "remove".to_string(),
        CLAUDE_MCP_SERVER_NAME.to_string(),
        "-s".to_string(),
        "user".to_string(),
    ]
}

fn claude_registered_server(registry: &Path) -> io::Result<Option<serde_json::Value>> {
    Ok(read_optional_json(registry)?
        .get("mcpServers")
        .and_then(|servers| servers.get(CLAUDE_MCP_SERVER_NAME))
        .cloned())
}

fn claude_command(
    registry: &Path,
    claude_cli: &str,
    home: &Path,
    args: Vec<String>,
) -> AgentSetupChange {
    AgentSetupChange {
        path: registry.to_path_buf(),
        contents: format!("{claude_cli} {}", args.join(" ")),
        executable: false,
        action: AgentSetupChangeAction::RunCommand {
            program: claude_cli.to_string(),
            args,
            home: home.to_path_buf(),
        },
    }
}

fn update_claude_settings_hooks(
    path: &Path,
    loam_cli: &str,
    root_path: &str,
) -> io::Result<String> {
    let mut value = read_optional_json(path)?;
    if !value.is_object() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{} is not a JSON object", path.display()),
        ));
    }
    match value.get("hooks") {
        None => value["hooks"] = serde_json::json!({}),
        Some(hooks) if hooks.is_object() => {}
        // Not a shape this installer wrote, and not one to overwrite either: the
        // whole point of merging into a file the app does not own is that what is
        // already in it survives.
        Some(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{}: `hooks` is not an object", path.display()),
            ))
        }
    }
    match value["hooks"].get("PreCompact") {
        None => value["hooks"]["PreCompact"] = serde_json::json!([]),
        Some(entries) if entries.is_array() => {}
        Some(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{}: `hooks.PreCompact` is not an array", path.display()),
            ))
        }
    }
    let precompact = value["hooks"]["PreCompact"].as_array_mut().unwrap();
    remove_loam_hook_entries(precompact, loam_cli);
    // Only the fields Claude defines. The shape written before this also carried
    // `id`, `name` and `version`, which are a plugin manifest's fields rather than
    // a hook entry's, and the hook version the doctor reported was the one written
    // here a moment earlier, so it confirmed nothing. `matcher` is a real field —
    // `manual` or `auto` for this event — and omitting it is documented as
    // activating on every occurrence, which is what pre-compact capture wants.
    precompact.push(serde_json::json!({
        "hooks": [{
            "type": "command",
            "command": claude_hook_command(loam_cli, root_path),
            "async": true,
            "timeout": 60
        }]
    }));
    pretty_json(&value)
}

// The program a hook command runs, unquoted back out of the command line this
// installer wrote.
fn hook_command_program_exists(command: &str) -> bool {
    let Some(program) = command.split(" memory ").next() else {
        return false;
    };
    let program = program.trim();
    let program = match program.strip_prefix('\'') {
        Some(rest) => rest.strip_suffix('\'').unwrap_or(rest).replace("'\\''", "'"),
        None => program.to_string(),
    };
    !program.is_empty() && Path::new(&program).is_file()
}

fn claude_hook_command(loam_cli: &str, root_path: &str) -> String {
    format!(
        "{} memory --root {} hook claude PreCompact",
        shell_quote(loam_cli),
        shell_quote(root_path)
    )
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

fn remove_claude_hooks(path: &Path, loam_cli: &str) -> io::Result<String> {
    remove_json_hook_entries(path, "PreCompact", loam_cli)
}

// The guard this replaces returned early unless the file mentioned `mdx-memory`,
// a string no version has written since the rename — so uninstall quietly stopped
// removing the hook it had just installed. Comparing the parsed value keeps a file
// we have nothing in from being reformatted, without depending on a name.
fn remove_json_hook_entries(path: &Path, event_key: &str, loam_cli: &str) -> io::Result<String> {
    let existing = read_optional_file(path)?;
    if existing.trim().is_empty() {
        return Ok(existing);
    }
    // A file that does not parse holds nothing anyone can read, so there is nothing
    // to take out of it. Failing here would let a junk file left by something else
    // block an install that only meant to tidy it up.
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&existing) else {
        return Ok(existing);
    };
    let before = value.clone();
    if let Some(hooks) = value.get_mut("hooks").and_then(|item| item.as_object_mut()) {
        if let Some(entries) = hooks.get_mut(event_key).and_then(|item| item.as_array_mut()) {
            remove_loam_hook_entries(entries, loam_cli);
            if entries.is_empty() {
                hooks.remove(event_key);
            }
        }
    }
    if value == before {
        return Ok(existing);
    }
    pretty_json(&value)
}

// One hook at a time, not one entry at a time. An entry's `hooks` is an array, so
// somebody may have put ours in the same entry as their own; taking the entry out
// would take theirs with it.
fn remove_loam_hook_entries(entries: &mut Vec<serde_json::Value>, loam_cli: &str) {
    entries.retain_mut(|entry| {
        if is_loam_memory_named_entry(entry) {
            return false;
        }
        let Some(nested) = entry.get_mut("hooks").and_then(|hooks| hooks.as_array_mut()) else {
            return true;
        };
        let before = nested.len();
        nested.retain(|hook| {
            !hook
                .get("command")
                .and_then(|command| command.as_str())
                .is_some_and(|command| is_loam_memory_hook_command(command, loam_cli))
        });
        // Nothing of ours was in it, or something of somebody else's still is.
        before == nested.len() || !nested.is_empty()
    });
}

// The shapes that name themselves: everything this installer wrote before the
// Claude entry lost its naming fields, which it lost because Claude does not read
// them.
fn is_loam_memory_named_entry(entry: &serde_json::Value) -> bool {
    entry
        .get("id")
        .and_then(|id| id.as_str())
        .is_some_and(|id| id == "loam-memory" || id.starts_with("loam-memory:"))
        || entry.get("name").and_then(|name| name.as_str()) == Some("loam-memory")
        || entry
            .get("command")
            .and_then(|command| command.as_str())
            .is_some_and(|command| command.contains("mdx-memory-precompact-hook"))
        || entry.to_string().contains("mdx-memory-precompact-hook")
}

// And the shape that names nothing, identified by the command line this installer
// builds. The event alone is not enough to go on: another tool's
// `<its-cli> memory --root X hook claude PreCompact` has the same shape, and
// deleting somebody else's hook is worse than leaving one of ours behind.
fn is_loam_memory_hook_command(command: &str, loam_cli: &str) -> bool {
    if !(command.contains(" hook claude ") || command.contains(" hook cursor ")) {
        return false;
    }
    if command.starts_with(&shell_quote(loam_cli)) {
        return true;
    }
    // An entry an earlier build wrote from a different path is still ours.
    command
        .split_whitespace()
        .next()
        .and_then(|program| Path::new(program.trim_matches('\'')).file_name())
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("loam"))
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
    output.push_str(LOAM_MEMORY_BLOCK_BEGIN);
    output.push('\n');
    output.push_str(block);
    output.push('\n');
    output.push_str(LOAM_MEMORY_BLOCK_END);
    output.push('\n');
    Ok(output)
}

fn remove_agent_markdown_block(path: &Path) -> io::Result<String> {
    read_optional_file(path).map(|existing| remove_managed_markdown_block(&existing))
}

fn remove_managed_markdown_block(contents: &str) -> String {
    let Some(begin) = contents.find(LOAM_MEMORY_BLOCK_BEGIN) else {
        return contents.to_string();
    };
    let Some(relative_end) = contents[begin..].find(LOAM_MEMORY_BLOCK_END) else {
        return contents.to_string();
    };
    let end = begin + relative_end + LOAM_MEMORY_BLOCK_END.len();
    let mut output = String::new();
    output.push_str(contents[..begin].trim_end());
    let tail = contents[end..].trim_start_matches(['\r', '\n']);
    if !output.is_empty() && !tail.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(tail);
    output
}

fn loam_memory_skill(root_path: &str, loam_cli: &str) -> String {
    format!(
        r#"---
name: loam-memory
description: Use when the user asks to remember, save, recall, search, summarize for future sessions, persist decisions, load prior context, manage Loam Memory, or distinguish memory capture from full thread archival across Codex, Claude, or Cursor.
---

# Loam Memory

Use Loam Memory as the user's durable cross-agent memory store. The configured workspace is:

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
{loam_cli} memory --root "{root_path}" recall "<task query>"
{loam_cli} memory --root "{root_path}" search "<exact query>"
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
{loam_cli} memory --root "{root_path}" add --body "<what happened>"
{loam_cli} memory --root "{root_path}" distill --statement "<the claim>" --body "<why>" --ref <material-id>
```

Capture is one-way. Anything written can be deleted afterwards but never unremembered, so do not store secrets, credentials, or anything the user has not confirmed.

## Agent-Time Memory Extraction

Extract and write durable memories during active conversation turns when decisions, stable preferences, project constraints, or reusable lessons become clear. Do not wait for background capture, thread archival, or pre-compact hooks before preserving confirmed information that should survive future sessions.

Use background capture as a fallback safety net, not as the primary workflow. If the user asks to remember something, or the conversation resolves something worth keeping, call `memory_add` in that turn. Ask before storing anything sensitive or uncertain: there is no holding area any more, so material goes straight into the library.

## Pre-Compact Memory Capture

Pre-compact hooks are for memory capture before context compression. They are not the same as explicit thread archival.

Claude and Cursor call `{loam_cli} memory --root "{root_path}" hook <agent> <event>` on pre-compact events. The hook reads the agent's payload on stdin, and when that payload carries a valid `transcript_path` the transcript is stored as material so the conversation survives compression. It stops there: it does not draw conclusions, because nothing about a compression event tells anyone what the conversation meant. With no transcript path it stores nothing.

Codex currently relies on explicit MCP/CLI calls for pre-compact capture unless a verified Codex lifecycle hook exposes a transcript path.

## Keeping A Whole Conversation

A transcript is material like anything else: read it in with `capture import --path <file>` and it is stored verbatim with its source. There is no separate thread layer, no archival step, and no automatic extraction — turning a conversation into a conclusion is a judgement, so it goes through `memory_distill` and a person's adoption like every other conclusion.

CLI fallback:

```bash
{loam_cli} memory --root "{root_path}" capture scan --path <file-or-dir>
{loam_cli} memory --root "{root_path}" capture import --path <file-or-dir>
```

## Safety

- Ask before storing sensitive personal data, credentials, private keys, tokens, or third-party confidential material.
- If uncertain whether something is worth keeping, ask briefly or put it in the final answer as a suggested memory.
- Never invent provenance. Include source thread/path only when available.
- Do not promote to wiki unless explicitly requested.
"#
    )
}

fn claude_memory_block(root_path: &str, loam_cli: &str) -> String {
    format!(
        "## Loam Memory\nWhen the user asks to remember, save, recall, search, persist decisions, or load prior context, use the `loam-memory` skill and the `loam-memory` MCP server.\n\nUse `memory_recall` for task context and cite what you use. Store what happened with `memory_add` during the turn it happens; draw conclusions from stored material with `memory_distill`, which produces a candidate that only a person can adopt. Do not wait for background capture or pre-compact hooks before preserving something confirmed. Ask before storing anything sensitive or uncertain — capture is one-way. Pre-compact hooks capture and accept distilled memory before compression; the installed Claude hook command is `{loam_cli} memory --root \"{root_path}\" hook claude PreCompact`. Full thread archival is separate and should only be used when preserving original conversation text matters. Do not store secrets or promote memory into wiki/raw material unless the user explicitly asks."
    )
}

fn codex_memory_block(root_path: &str, loam_cli: &str) -> String {
    format!(
        "## Loam Memory\nWhen the user asks to remember, save, recall, search, persist decisions, or load prior context, use the `loam-memory` skill and the `loam-memory` MCP server.\n\nUse `memory_recall` for task context and cite what you use. Store what happened with `memory_add` during the turn it happens; draw conclusions from stored material with `memory_distill`, which produces a candidate that only a person can adopt. Ask before storing anything sensitive or uncertain — capture is one-way. There is no pre-compaction hook on this side, so preserve anything confirmed when it happens rather than waiting for one. The library for this workspace is `{root_path}`; the same reads and writes are available from the command line as `{loam_cli} memory`. Do not store secrets or promote memory into wiki/raw material unless the user explicitly asks."
    )
}

fn cursor_memory_rule(root_path: &str, loam_cli: &str) -> String {
    format!(
        r#"---
description: Use Loam Memory when remembering, saving, recalling, searching prior context, persisting decisions, or summarizing durable lessons.
alwaysApply: true
---

Use the `loam-memory` skill and the `loam-memory` MCP server for durable memory.

Read task context with `memory_recall` and cite what you use. Find specific items with `memory_search`. Store what happened with `memory_add` during the turn it happens; draw conclusions from stored material with `memory_distill`, which produces a candidate that only a person can adopt. Do not wait for background capture or pre-compact hooks before preserving something confirmed. Ask before storing anything sensitive or uncertain — capture is one-way. Pre-compact hooks capture and accept distilled memory before compression; the installed Cursor hook command is `{loam_cli} memory --root "{root_path}" hook cursor preCompact`. Full thread archival is separate and should only be used when preserving original conversation text matters. Do not store secrets.
"#
    )
}
