use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, ExitCode};
use std::thread;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use mdx_lib::cli_protocol::{CliRequest, CliResponse};

#[derive(Parser)]
#[command(
    name = "mdx-cli",
    about = "Control the running MDX desktop workspace over its local socket."
)]
struct Cli {
    #[command(subcommand)]
    command: CommandLine,
}

#[derive(Debug, Clone, PartialEq, Subcommand)]
enum CommandLine {
    New,
    Open {
        path: String,
    },
    List,
    Content {
        #[arg(long)]
        tab: Option<String>,
    },
    Selection {
        #[arg(long)]
        tab: Option<String>,
    },
    Insert {
        #[arg(long)]
        tab: Option<String>,
        text: String,
    },
    Save {
        #[arg(long)]
        tab: Option<String>,
    },
    Focus {
        #[arg(long)]
        tab: Option<String>,
    },
    Close {
        #[arg(long)]
        tab: Option<String>,
        #[arg(long)]
        force: bool,
    },
    CreateFile {
        parent: String,
        name: Option<String>,
    },
    CreateFolder {
        parent: String,
        name: String,
    },
    Rename {
        path: String,
        new_name: String,
    },
    LlmWiki {
        #[command(subcommand)]
        command: LlmWikiCommand,
    },
    Memory {
        #[arg(long)]
        root: Option<String>,
        #[command(subcommand)]
        command: MemoryCommand,
    },
    Serve {
        #[arg(long)]
        workspace: String,
        #[arg(long)]
        port: u16,
        #[arg(long)]
        api_key: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum LlmWikiCommand {
    Status,
    Ingest {
        raw_path: String,
    },
    Digest {
        #[arg(long)]
        title: String,
        #[arg(required = true, num_args = 1..)]
        prompt: Vec<String>,
    },
    Lint {
        #[arg(long)]
        json: bool,
    },
    Query {
        #[arg(long)]
        json: bool,
        #[arg(required = true, num_args = 1..)]
        question: Vec<String>,
    },
    Search {
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Subcommand)]
enum MemoryCommand {
    Daemon {
        #[arg(long, default_value_t = 14243)]
        port: u16,
        #[arg(long)]
        api_key: Option<String>,
    },
    Hook {
        agent: String,
        event: String,
        #[arg(long)]
        deadline_ms: Option<u64>,
    },
    Install {
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    Status {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        agent: Option<String>,
    },
    Doctor {
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        json: bool,
    },
    #[command(name = "repair-agent")]
    RepairAgent {
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    Uninstall {
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        keep_data: bool,
        #[arg(long)]
        dry_run: bool,
    },
    /// Turn memory on for this workspace and bind it to a project.
    Init,
    /// Report on the embedding model, or download it.
    Model {
        #[arg(long)]
        download: bool,
    },
    /// Re-embed the whole library, which is what a model change costs.
    Reindex,
    /// Store material: a decision, a finding, a piece of a conversation.
    Add {
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
        #[arg(long)]
        source: Option<String>,
    },
    /// Read one stored entry in full.
    Show {
        drawer_id: String,
    },
    List {
        /// `material` or `conclusion`; both when unset.
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Hide one entry from every read path.
    Delete {
        drawer_id: String,
    },
    Search {
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        wing: Option<String>,
        #[arg(long)]
        room: Option<String>,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    /// Assemble the conclusions that apply to a task.
    Context {
        #[arg(long)]
        max_items: Option<usize>,
        #[arg(long)]
        dao_tian_limit: Option<usize>,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    /// A deterministic brief for a task. No model is called to write it.
    Brief {
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    /// Context, brief and matching material together.
    Recall {
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        max_items: Option<usize>,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    /// Draw a candidate conclusion from material already stored.
    Distill {
        #[arg(long)]
        statement: String,
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
        /// `concrete` (default) or `pattern`.
        #[arg(long)]
        tier: Option<String>,
        #[arg(long = "ref", required = true, num_args = 1..)]
        supporting_refs: Vec<String>,
    },
    /// Report whether a candidate can be adopted yet. Read-only.
    Gate {
        drawer_id: String,
    },
    /// Adopt a candidate conclusion so later sessions see it.
    Adopt {
        drawer_id: String,
        #[arg(long)]
        note: Option<String>,
    },
    /// Take an adopted conclusion back out of everyone's context.
    Demote {
        drawer_id: String,
        /// `contradicted` | `obsolete` | `superseded` | `out_of_scope` | `unsafe`
        #[arg(long)]
        reason_type: String,
        #[arg(long)]
        reason: String,
        #[arg(long = "evidence-ref", required = true, num_args = 1..)]
        evidence_refs: Vec<String>,
        /// Retire it outright instead of only demoting it.
        #[arg(long)]
        retire: bool,
    },
    /// Copy a conclusion into wiki raw material.
    Promote {
        target: Option<String>,
        #[arg(long = "target")]
        target_flag: Option<String>,
        #[arg(long)]
        ingest: bool,
        #[arg(long)]
        title: Option<String>,
    },
    Capture {
        #[command(subcommand)]
        command: MemoryCaptureCommand,
    },
    /// Read an old `memory/` directory in as material. The old files are left alone.
    #[command(name = "legacy-import")]
    LegacyImport {
        #[arg(long)]
        dry_run: bool,
    },
    /// Write this project's memory out as a readable Markdown bundle.
    Export {
        #[arg(long)]
        output: String,
    },
    /// Read a Markdown bundle back into the library.
    Import {
        #[arg(long)]
        input: String,
    },
    Agent {
        #[command(subcommand)]
        command: MemoryAgentCommand,
    },
}

/// Getting outside text into the library.
///
/// The pair the old thread capture left behind: ask where something would be
/// filed, then file it. Both halves land in material — nothing here draws a
/// conclusion, and nothing here can be undone except by deleting afterwards.
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryCaptureCommand {
    /// Report where a file or directory would be filed, without storing it.
    Scan {
        #[arg(long)]
        path: String,
    },
    /// Read a file or directory into the library as material.
    Import {
        #[arg(long)]
        path: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryAgentCommand {
    Setup {
        #[arg(long)]
        codex: bool,
        #[arg(long)]
        claude: bool,
        #[arg(long)]
        cursor: bool,
        #[arg(long)]
        all: bool,
        #[arg(long)]
        hooks: bool,
        #[arg(long)]
        no_hooks: bool,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        mdx_cli: Option<String>,
        #[arg(long)]
        mdx_mcp: Option<String>,
    },
}

fn main() -> ExitCode {
    match run() {
        Ok((command, response)) => print_response(command, response),
        Err(error) => {
            let response = response_from_io_error(&error);
            eprintln!(
                "{}",
                serde_json::to_string(&response)
                    .unwrap_or_else(|_| "{\"ok\":false,\"error_code\":\"io_error\"}".into())
            );
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
#[derive(Debug)]
#[allow(dead_code)]
pub(crate) struct ParsedCommandForTest(CommandLine);

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn parse_command_for_test<I, T>(args: I) -> io::Result<ParsedCommandForTest>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    Cli::try_parse_from(args)
        .map(|cli| ParsedCommandForTest(cli.command))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))
}

fn run() -> io::Result<(CommandLine, CliResponse)> {
    let cli = Cli::parse();
    let command = cli.command;
    if let CommandLine::Serve {
        workspace,
        port,
        api_key,
    } = &command
    {
        serve_memory_daemon(workspace, *port, api_key.as_deref())?;
        return Ok((
            command,
            CliResponse {
                ok: true,
                ..CliResponse::default()
            },
        ));
    }

    if let CommandLine::Memory {
        root: Some(root),
        command: MemoryCommand::Daemon { port, api_key },
    } = &command
    {
        serve_memory_daemon(root, *port, api_key.as_deref())?;
        return Ok((
            command,
            CliResponse {
                ok: true,
                ..CliResponse::default()
            },
        ));
    }

    if let Some(root_path) = memory_root_override(&command)? {
        let response = execute_memory_headless(&command, root_path)?;
        return Ok((command, response));
    }

    let request = request_from_command(&command)?;
    let mut conn = Connection::open()?;

    conn.send(&request).map(|response| (command, response))
}

fn request_from_command(command: &CommandLine) -> io::Result<CliRequest> {
    Ok(match command {
        CommandLine::New => CliRequest::New,
        CommandLine::Open { path } => CliRequest::Open {
            path: normalize_cli_path(&path)?,
        },
        CommandLine::List => CliRequest::List,
        CommandLine::Content { tab } => CliRequest::Content {
            tab_id: tab.clone(),
        },
        CommandLine::Selection { tab } => CliRequest::Selection {
            tab_id: tab.clone(),
        },
        CommandLine::Insert { tab, text } => CliRequest::Insert {
            tab_id: tab.clone(),
            text: text.clone(),
        },
        CommandLine::Save { tab } => CliRequest::Save {
            tab_id: tab.clone(),
        },
        CommandLine::Focus { tab } => CliRequest::Focus {
            tab_id: tab.clone(),
        },
        CommandLine::Close { tab, force } => CliRequest::Close {
            tab_id: tab.clone(),
            force: Some(*force),
        },
        CommandLine::CreateFile { parent, name } => CliRequest::CreateFile {
            parent_dir: Some(normalize_cli_path(parent)?),
            name: name.clone(),
        },
        CommandLine::CreateFolder { parent, name } => CliRequest::CreateFolder {
            parent_dir: Some(normalize_cli_path(parent)?),
            name: Some(name.clone()),
        },
        CommandLine::Rename { path, new_name } => CliRequest::Rename {
            path: Some(normalize_cli_path(path)?),
            new_name: new_name.clone(),
        },
        CommandLine::LlmWiki { command } => match command {
            LlmWikiCommand::Status => CliRequest::LlmWikiStatus,
            LlmWikiCommand::Ingest { raw_path } => CliRequest::LlmWikiIngest {
                raw_path: raw_path.clone(),
            },
            LlmWikiCommand::Digest { title, prompt } => CliRequest::LlmWikiDigest {
                title: trim_required_value(title, "title")?,
                prompt: join_required_words(prompt, "prompt")?,
            },
            LlmWikiCommand::Lint { .. } => CliRequest::LlmWikiLint,
            LlmWikiCommand::Query { question, .. } => CliRequest::LlmWikiQuery {
                question: join_required_words(question, "question")?,
            },
            LlmWikiCommand::Search { query } => CliRequest::LlmWikiSearch {
                query: join_required_words(query, "query")?,
            },
        },
        CommandLine::Memory { command, .. } => request_from_memory_command(command)?,
        CommandLine::Serve { .. } => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "serve does not use the MDX desktop socket",
            ));
        }
    })
}

fn request_from_memory_command(command: &MemoryCommand) -> io::Result<CliRequest> {
    Ok(match command {
        MemoryCommand::Status { agent: Some(_), .. } => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "memory status --agent requires --root <workspace>",
            ));
        }
        MemoryCommand::Status { .. } => CliRequest::MemoryStatus,
        MemoryCommand::Init => CliRequest::MemoryInit,
        MemoryCommand::Model { download } => CliRequest::MemoryModel {
            download: *download,
        },
        MemoryCommand::Reindex => CliRequest::MemoryReindex,
        MemoryCommand::Add {
            body,
            file,
            stdin,
            source,
        } => CliRequest::MemoryAdd {
            body: read_input_from_file_or_stdin(file.as_deref(), body.as_deref(), *stdin)?,
            source: source
                .as_deref()
                .map(|value| trim_required_value(value, "source"))
                .transpose()?,
        },
        MemoryCommand::Show { drawer_id } => CliRequest::MemoryShow {
            drawer_id: trim_required_value(drawer_id, "drawer_id")?,
        },
        MemoryCommand::List {
            kind,
            status,
            limit,
        } => CliRequest::MemoryList {
            kind: kind.clone(),
            status: status.clone(),
            limit: *limit,
        },
        MemoryCommand::Delete { drawer_id } => CliRequest::MemoryDelete {
            drawer_id: trim_required_value(drawer_id, "drawer_id")?,
        },
        MemoryCommand::Search {
            query,
            limit,
            wing,
            room,
        } => CliRequest::MemorySearch {
            query: join_required_words(query, "query")?,
            limit: *limit,
            wing: wing.clone(),
            room: room.clone(),
        },
        MemoryCommand::Context {
            query,
            max_items,
            dao_tian_limit,
        } => CliRequest::MemoryContext {
            query: join_required_words(query, "query")?,
            max_items: *max_items,
            dao_tian_limit: *dao_tian_limit,
        },
        MemoryCommand::Brief { query } => CliRequest::MemoryBrief {
            query: join_required_words(query, "query")?,
        },
        MemoryCommand::Recall {
            query,
            limit,
            max_items,
        } => CliRequest::MemoryRecall {
            query: join_required_words(query, "query")?,
            limit: *limit,
            max_items: *max_items,
        },
        MemoryCommand::Distill {
            statement,
            body,
            file,
            stdin,
            tier,
            supporting_refs,
        } => CliRequest::MemoryDistill {
            statement: trim_required_value(statement, "statement")?,
            body: read_input_from_file_or_stdin(file.as_deref(), body.as_deref(), *stdin)?,
            tier: tier.clone(),
            supporting_refs: supporting_refs.clone(),
        },
        MemoryCommand::Gate { drawer_id } => CliRequest::MemoryGate {
            drawer_id: trim_required_value(drawer_id, "drawer_id")?,
        },
        MemoryCommand::Adopt { drawer_id, note } => CliRequest::MemoryAdopt {
            drawer_id: trim_required_value(drawer_id, "drawer_id")?,
            note: note
                .as_deref()
                .map(|value| trim_required_value(value, "note"))
                .transpose()?,
        },
        MemoryCommand::Demote {
            drawer_id,
            reason_type,
            reason,
            evidence_refs,
            retire,
        } => CliRequest::MemoryDemote {
            drawer_id: trim_required_value(drawer_id, "drawer_id")?,
            reason_type: trim_required_value(reason_type, "reason_type")?,
            reason: trim_required_value(reason, "reason")?,
            evidence_refs: evidence_refs.clone(),
            retire: *retire,
        },
        MemoryCommand::Promote {
            target,
            target_flag,
            ingest,
            title,
        } => CliRequest::MemoryPromote {
            target: trim_required_value(
                target
                    .as_deref()
                    .or(target_flag.as_deref())
                    .unwrap_or_default(),
                "target",
            )?,
            ingest: *ingest,
            title: title.clone(),
        },
        MemoryCommand::Capture { command } => match command {
            MemoryCaptureCommand::Scan { path } => CliRequest::MemoryCaptureScan {
                path: normalize_cli_path(path)?,
            },
            MemoryCaptureCommand::Import { path } => CliRequest::MemoryCaptureImport {
                path: normalize_cli_path(path)?,
            },
        },
        MemoryCommand::LegacyImport { dry_run } => CliRequest::MemoryLegacyImport {
            dry_run: *dry_run,
        },
        MemoryCommand::Export { output } => CliRequest::MemoryExport {
            output_path: normalize_cli_path(output)?,
        },
        MemoryCommand::Import { input } => CliRequest::MemoryImport {
            input_path: normalize_cli_path(input)?,
        },
        MemoryCommand::Daemon { .. }
        | MemoryCommand::Hook { .. }
        | MemoryCommand::Install { .. }
        | MemoryCommand::Doctor { .. }
        | MemoryCommand::RepairAgent { .. }
        | MemoryCommand::Uninstall { .. }
        | MemoryCommand::Agent { .. } => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "this memory command requires --root <workspace>",
            ));
        }
    })
}

fn memory_root_override(command: &CommandLine) -> io::Result<Option<String>> {
    match command {
        CommandLine::Memory {
            root: Some(root), ..
        } => normalize_cli_path(root).map(Some),
        _ => Ok(None),
    }
}

fn execute_memory_headless(command: &CommandLine, root_path: String) -> io::Result<CliResponse> {
    let CommandLine::Memory { command, .. } = command else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "headless execution is only supported for memory commands",
        ));
    };

    // Agent integration and the hook daemon are not memory protocol commands:
    // they configure the editors that call it, so they answer before the
    // library is ever opened.
    match command {
        MemoryCommand::Daemon { port, api_key } => {
            serve_memory_daemon(&root_path, *port, api_key.as_deref())?;
            return Ok(CliResponse {
                ok: true,
                root_path: Some(root_path),
                ..CliResponse::default()
            });
        }
        MemoryCommand::Hook {
            agent,
            event,
            deadline_ms,
        } => {
            return execute_memory_hook_headless(root_path, agent, event, *deadline_ms);
        }
        MemoryCommand::Install { agent, dry_run } => {
            return execute_memory_agent_install_headless(root_path, agent.clone(), *dry_run);
        }
        MemoryCommand::Status {
            agent: Some(agent), ..
        } => {
            return execute_memory_agent_status_headless(root_path, Some(agent.clone()));
        }
        MemoryCommand::Doctor { agent, .. } => {
            return execute_memory_agent_doctor_headless(root_path, agent.clone());
        }
        MemoryCommand::RepairAgent { agent, dry_run } => {
            return execute_memory_agent_repair_headless(root_path, agent.clone(), *dry_run);
        }
        MemoryCommand::Uninstall {
            agent,
            keep_data,
            dry_run,
        } => {
            return execute_memory_agent_uninstall_headless(
                root_path,
                agent.clone(),
                *keep_data,
                *dry_run,
            );
        }
        MemoryCommand::Agent { command } => {
            return execute_memory_agent_headless(command, root_path);
        }
        _ => {}
    }

    let request = request_from_memory_command(command)?;

    Ok(mdx_lib::cli_protocol::run_memory_request(
        std::path::Path::new(&root_path),
        request,
    ))
}

fn execute_memory_agent_headless(
    command: &MemoryAgentCommand,
    root_path: String,
) -> io::Result<CliResponse> {
    let MemoryAgentCommand::Setup {
        codex,
        claude,
        cursor,
        all,
        hooks,
        no_hooks,
        dry_run,
        mdx_cli,
        mdx_mcp,
    } = command;

    if *hooks && *no_hooks {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--hooks and --no-hooks cannot be used together",
        ));
    }

    let configure_all = *all || (!*codex && !*claude && !*cursor);
    let request = mdx_lib::memory_agent_setup::MemoryAgentSetupRequest {
        codex: configure_all || *codex,
        claude: configure_all || *claude,
        cursor: configure_all || *cursor,
        hooks: !*no_hooks,
        dry_run: *dry_run,
        mdx_cli: mdx_cli.clone(),
        mdx_mcp: mdx_mcp.clone(),
    };

    match mdx_lib::memory_agent_setup::memory_agent_setup(root_path.clone(), request) {
        Ok(result) => Ok(CliResponse {
            ok: true,
            root_path: Some(root_path),
            content: Some(result.summary),
            ..CliResponse::default()
        }),
        Err(error) => Err(error),
    }
}

fn execute_memory_hook_headless(
    root_path: String,
    agent: &str,
    event_name: &str,
    // Still accepted because it is baked into hook command lines already
    // installed on user machines, and rejecting it would break every one of
    // them. Not enforced: the new path's slow step is embedding, and cutting
    // that off midway would leave the transcript half-stored. Tracked as a gap
    // rather than pretended away.
    _deadline_ms: Option<u64>,
) -> io::Result<CliResponse> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let payload = serde_json::from_str::<serde_json::Value>(&input).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid hook JSON: {error}"),
        )
    })?;
    // The hook speaks the daemon's shape directly. Everything a hook can
    // usefully say is in the payload it was handed: which agent, which event,
    // the transcript to keep, and the prompt that is starting.
    let request = mdx_lib::memory::daemon::HookEventRequest {
        agent_source: agent.to_string(),
        event_name: event_name.to_string(),
        workspace_root: Some(root_path.clone()),
        session_id: hook_payload_string(&payload, &["session_id", "sessionId"]),
        transcript_path: hook_payload_string(
            &payload,
            &["transcript_path", "transcriptPath", "conversation_path"],
        ),
        prompt: hook_payload_string(&payload, &["prompt", "user_prompt", "userPrompt"]),
    };
    let body = serde_json::to_string(&serde_json::json!({
        "agent_source": request.agent_source,
        "event_name": request.event_name,
        "workspace_root": request.workspace_root,
        "session_id": request.session_id,
        "transcript_path": request.transcript_path,
        "prompt": request.prompt,
    }))
    .map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("failed to encode hook event: {error}"),
        )
    })?;
    let daemon_response =
        mdx_lib::memory::daemon::dispatch(root_path.clone(), "POST", "/hook/events", &body)
            .map_err(workspace_error_to_io)?;
    if !(200..300).contains(&daemon_response.status) {
        return Err(io::Error::new(io::ErrorKind::Other, daemon_response.body));
    }
    let response = serde_json::from_str::<mdx_lib::memory::daemon::HookEventResponse>(
        &daemon_response.body,
    )
    .map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid hook response: {error}"),
        )
    })?;
    let output = mdx_lib::memory_hooks::format_hook_output(
        &request.agent_source,
        &request.event_name,
        Some(&response.additional_context),
    )
    .map_err(workspace_error_to_io)?;

    Ok(CliResponse {
        ok: true,
        root_path: Some(root_path),
        content: Some(output),
        ..CliResponse::default()
    })
}

fn execute_memory_agent_install_headless(
    root_path: String,
    agent: Option<String>,
    dry_run: bool,
) -> io::Result<CliResponse> {
    let result = mdx_lib::memory_agent_setup::memory_agent_install(
        root_path.clone(),
        mdx_lib::memory_agent_setup::MemoryAgentCommandRequest {
            agent,
            dry_run,
            keep_data: false,
        },
    )?;
    Ok(CliResponse {
        ok: true,
        root_path: Some(root_path),
        content: Some(result.summary),
        ..CliResponse::default()
    })
}

fn execute_memory_agent_repair_headless(
    root_path: String,
    agent: Option<String>,
    dry_run: bool,
) -> io::Result<CliResponse> {
    let result = mdx_lib::memory_agent_setup::memory_agent_repair(
        root_path.clone(),
        mdx_lib::memory_agent_setup::MemoryAgentCommandRequest {
            agent,
            dry_run,
            keep_data: false,
        },
    )?;
    Ok(CliResponse {
        ok: true,
        root_path: Some(root_path),
        content: Some(result.summary),
        ..CliResponse::default()
    })
}

fn execute_memory_agent_uninstall_headless(
    root_path: String,
    agent: Option<String>,
    keep_data: bool,
    dry_run: bool,
) -> io::Result<CliResponse> {
    let result = mdx_lib::memory_agent_setup::memory_agent_uninstall(
        root_path.clone(),
        mdx_lib::memory_agent_setup::MemoryAgentCommandRequest {
            agent,
            dry_run,
            keep_data,
        },
    )?;
    Ok(CliResponse {
        ok: true,
        root_path: Some(root_path),
        content: Some(result.summary),
        ..CliResponse::default()
    })
}

fn execute_memory_agent_status_headless(
    root_path: String,
    agent: Option<String>,
) -> io::Result<CliResponse> {
    let statuses = mdx_lib::memory_agent_setup::memory_agent_status(root_path.clone(), agent)?;
    Ok(CliResponse {
        ok: true,
        root_path: Some(root_path),
        memory_integrations: Some(statuses),
        ..CliResponse::default()
    })
}

fn execute_memory_agent_doctor_headless(
    root_path: String,
    agent: Option<String>,
) -> io::Result<CliResponse> {
    let report = mdx_lib::memory_agent_setup::memory_agent_doctor(root_path.clone(), agent)?;
    Ok(CliResponse {
        ok: true,
        root_path: Some(root_path),
        memory_doctor: Some(report),
        ..CliResponse::default()
    })
}


/// Reads the first of several possible field names out of a hook payload.
///
/// Each agent spells these differently, and a hook that silently drops the
/// transcript because the key was `transcriptPath` would look like memory not
/// working at all.
fn hook_payload_string(payload: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = payload.get(*key).and_then(serde_json::Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

fn serve_memory_daemon(workspace: &str, port: u16, api_key: Option<&str>) -> io::Result<()> {
    let root_path = normalize_cli_path(workspace)?;
    let api_key = api_key
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string);
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    eprintln!("mdx memory daemon listening on 127.0.0.1:{port}");

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) =
                    handle_http_connection(&mut stream, root_path.clone(), api_key.as_deref())
                {
                    eprintln!("mdx memory daemon request failed: {error}");
                }
            }
            Err(error) => eprintln!("mdx memory daemon accept failed: {error}"),
        }
    }

    Ok(())
}

fn handle_http_connection(
    stream: &mut TcpStream,
    root_path: String,
    api_key: Option<&str>,
) -> io::Result<()> {
    let request = read_http_request(stream)?;
    if !is_authorized(api_key, request.authorization.as_deref()) {
        return write_http_response(
            stream,
            mdx_lib::memory::daemon::DaemonResponse {
                status: 401,
                body: serde_json::json!({
                    "ok": false,
                    "error_code": "unauthorized",
                    "message": "missing or invalid Authorization bearer token",
                })
                .to_string(),
            },
        );
    }
    let response =
        match mdx_lib::memory::daemon::dispatch(root_path, &request.method, &request.path, &request.body) {
            Ok(response) => response,
            Err(error) => mdx_lib::memory::daemon::DaemonResponse {
                status: 500,
                body: serde_json::json!({
                    "ok": false,
                    "error_code": error.error_code(),
                    "message": error.to_string(),
                })
                .to_string(),
            },
        };

    write_http_response(stream, response)
}

struct HttpRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    body: String,
}

fn read_http_request(stream: &mut TcpStream) -> io::Result<HttpRequest> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "empty HTTP request",
        ));
    }

    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing HTTP method"))?
        .to_string();
    let raw_path = parts
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing HTTP path"))?;
    let path = raw_path
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(raw_path)
        .to_string();

    let mut content_length = 0usize;
    let mut authorization = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().map_err(|error| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("invalid Content-Length: {error}"),
                    )
                })?;
            } else if name.eq_ignore_ascii_case("authorization") {
                authorization = Some(value.trim().to_string());
            }
        }
    }

    let mut body = vec![0; content_length];
    reader.read_exact(&mut body)?;
    let body = String::from_utf8(body)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;

    Ok(HttpRequest {
        method,
        path,
        authorization,
        body,
    })
}

fn is_authorized(api_key: Option<&str>, authorization: Option<&str>) -> bool {
    let Some(api_key) = api_key.map(str::trim).filter(|key| !key.is_empty()) else {
        return true;
    };
    let Some(authorization) = authorization.map(str::trim) else {
        return false;
    };
    authorization
        .strip_prefix("Bearer ")
        .map(str::trim)
        .is_some_and(|token| token == api_key)
}

fn write_http_response(
    stream: &mut TcpStream,
    response: mdx_lib::memory::daemon::DaemonResponse,
) -> io::Result<()> {
    let status_text = match response.status {
        200 => "OK",
        401 => "Unauthorized",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let bytes = response.body.as_bytes();
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        status_text,
        bytes.len()
    )?;
    stream.write_all(bytes)?;
    stream.flush()
}

fn read_input_from_file_or_stdin(
    file: Option<&str>,
    inline: Option<&str>,
    read_stdin: bool,
) -> io::Result<String> {
    let sources =
        usize::from(file.is_some()) + usize::from(inline.is_some()) + usize::from(read_stdin);
    if sources != 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "provide exactly one of --body, --file, or --stdin",
        ));
    }

    let value = if let Some(path) = file {
        fs::read_to_string(path)?
    } else if read_stdin {
        let mut value = String::new();
        io::stdin().read_to_string(&mut value)?;
        value
    } else {
        inline.unwrap_or_default().to_string()
    };

    trim_required_value(&value, "content")
}

fn join_required_words(words: &[String], noun: &str) -> io::Result<String> {
    let value = words.join(" ");
    trim_required_value(&value, noun)
}

fn trim_required_value(value: &str, noun: &str) -> io::Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{noun} must not be empty"),
        ));
    }

    Ok(value.to_string())
}

fn response_from_io_error(error: &io::Error) -> CliResponse {
    let message = error.to_string();
    let code = if error.kind() == io::ErrorKind::InvalidInput {
        match message.as_str() {
            "question must not be empty" => "invalid_question",
            "query must not be empty" => "invalid_query",
            "prompt must not be empty" => "invalid_prompt",
            "title must not be empty" => "invalid_title",
            _ => "io_error",
        }
    } else {
        "io_error"
    };

    CliResponse::error(code, message)
}

fn workspace_error_to_io(error: mdx_lib::WorkspaceError) -> io::Error {
    io::Error::new(
        io::ErrorKind::Other,
        format!("{}: {}", error.error_code(), error),
    )
}

fn print_response(command: CommandLine, response: CliResponse) -> ExitCode {
    if !response.ok {
        let json = serde_json::to_string(&response)
            .unwrap_or_else(|_| "{\"ok\":false,\"error_code\":\"encode_error\"}".into());
        eprintln!("{json}");
        return ExitCode::FAILURE;
    }

    let output = success_output(&command, &response);
    print!("{output}");
    if !matches!(
        command,
        CommandLine::Content { .. }
            | CommandLine::Memory {
                command: MemoryCommand::Hook { .. },
                ..
            }
            | CommandLine::LlmWiki {
                command: LlmWikiCommand::Query { json: false, .. },
            }
    ) {
        println!();
    }
    let _ = io::stdout().flush();
    ExitCode::SUCCESS
}

/// What a successful command prints.
///
/// Memory commands print the response document, because their payload is
/// whatever the memory layer returned and this CLI is read by agents and
/// scripts before it is read by people. The exceptions are the commands whose
/// whole answer is one piece of text.
fn success_output(command: &CommandLine, response: &CliResponse) -> String {
    match command {
        CommandLine::Content { .. } => response.content.clone().unwrap_or_default(),
        CommandLine::LlmWiki {
            command: LlmWikiCommand::Query { json: false, .. },
        } => response.answer.clone().unwrap_or_default(),
        CommandLine::LlmWiki {
            command: LlmWikiCommand::Digest { .. },
        } => response.digest_path.clone().unwrap_or_default(),
        CommandLine::LlmWiki {
            command: LlmWikiCommand::Lint { json: false },
        } => response.lint_report.clone().unwrap_or_default(),
        CommandLine::Memory {
            command: MemoryCommand::Hook { .. },
            ..
        } => response.content.clone().unwrap_or_default(),
        _ => serde_json::to_string(response).unwrap_or_else(|_| "{\"ok\":true}".into()),
    }
}

struct Connection {
    write: UnixStream,
    read: BufReader<UnixStream>,
}

impl Connection {
    fn open() -> io::Result<Self> {
        let stream = connect_with_bootstrap()?;
        let write = stream.try_clone()?;

        Ok(Self {
            write,
            read: BufReader::new(stream),
        })
    }

    fn send(&mut self, request: &CliRequest) -> io::Result<CliResponse> {
        let mut json = serde_json::to_vec(request)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        json.push(b'\n');
        self.write.write_all(&json)?;
        self.write.flush()?;

        let mut line = String::new();
        let read = self.read.read_line(&mut line)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "MDX socket closed before responding",
            ));
        }

        serde_json::from_str(line.trim())
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }
}

fn connect_with_bootstrap() -> io::Result<UnixStream> {
    let path = socket_path()?;
    if let Ok(stream) = UnixStream::connect(&path) {
        return Ok(stream);
    }

    launch_mdx();

    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(8) {
        thread::sleep(Duration::from_millis(100));
        if let Ok(stream) = UnixStream::connect(&path) {
            return Ok(stream);
        }
    }

    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        format!("could not reach MDX socket at {}", path.display()),
    ))
}

fn launch_mdx() {
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe) = env::current_exe() {
            if let Some(app_path) = exe
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
            {
                if app_path.extension().and_then(|value| value.to_str()) == Some("app") {
                    let _ = Command::new("open").arg(app_path).spawn();
                    return;
                }
            }
        }

        let _ = Command::new("open").args(["-b", "com.hugh.mdx"]).spawn();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("mdx").spawn();
    }
}

fn socket_path() -> io::Result<PathBuf> {
    let home = env::var_os("HOME")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))?;
    Ok(PathBuf::from(home).join(".mdx").join("cli.sock"))
}

fn normalize_cli_path(input: &str) -> io::Result<String> {
    if input.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path must not be empty",
        ));
    }

    let expanded = if input == "~" {
        PathBuf::from(
            env::var_os("HOME")
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))?,
        )
    } else if let Some(rest) = input.strip_prefix("~/") {
        PathBuf::from(
            env::var_os("HOME")
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))?,
        )
        .join(rest)
    } else {
        PathBuf::from(input)
    };

    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        env::current_dir()?.join(expanded)
    };

    Ok(absolute.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mdx_lib::cli_protocol::{CliResponse, CliWikiSearchResult};
    use std::ffi::OsString;
    use std::sync::MutexGuard;
    use tempfile::TempDir;

    struct CodexCaptureEnvGuard {
        _lock: MutexGuard<'static, ()>,
        home: Option<OsString>,
        userprofile: Option<OsString>,
        codex_session_dirs: Option<OsString>,
    }

    impl CodexCaptureEnvGuard {
        fn use_home_and_session_dirs(
            home_path: impl AsRef<std::path::Path>,
            session_dirs: impl AsRef<std::ffi::OsStr>,
        ) -> Self {
            let lock = mdx_lib::llm_wiki_llm::llm_config_env_lock()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let home = std::env::var_os("HOME");
            let userprofile = std::env::var_os("USERPROFILE");
            let codex_session_dirs = std::env::var_os("MDX_CODEX_SESSION_DIRS");
            std::env::set_var("HOME", home_path.as_ref());
            std::env::remove_var("USERPROFILE");
            std::env::set_var("MDX_CODEX_SESSION_DIRS", session_dirs);
            Self {
                _lock: lock,
                home,
                userprofile,
                codex_session_dirs,
            }
        }
    }

    impl Drop for CodexCaptureEnvGuard {
        fn drop(&mut self) {
            if let Some(value) = self.home.take() {
                std::env::set_var("HOME", value);
            } else {
                std::env::remove_var("HOME");
            }
            if let Some(value) = self.userprofile.take() {
                std::env::set_var("USERPROFILE", value);
            } else {
                std::env::remove_var("USERPROFILE");
            }
            if let Some(value) = self.codex_session_dirs.take() {
                std::env::set_var("MDX_CODEX_SESSION_DIRS", value);
            } else {
                std::env::remove_var("MDX_CODEX_SESSION_DIRS");
            }
        }
    }

    #[test]
    fn llm_wiki_query_request_joins_multiword_question() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: false,
                question: vec!["raw".to_string(), "目录".to_string(), "是什么".to_string()],
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::LlmWikiQuery { question } if question == "raw 目录 是什么"
        ));
    }

    #[test]
    fn llm_wiki_search_request_joins_multiword_query() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Search {
                query: vec!["Document".to_string(), "Mode".to_string()],
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::LlmWikiSearch { query } if query == "Document Mode"
        ));
    }

    #[test]
    fn llm_wiki_digest_request_trims_title_and_joins_multiword_prompt() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Digest {
                title: " karpathy-llm-wiki ".to_string(),
                prompt: vec!["Summarize".to_string(), "notes".to_string()],
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::LlmWikiDigest { title, prompt }
                if title == "karpathy-llm-wiki" && prompt == "Summarize notes"
        ));
    }

    #[test]
    fn llm_wiki_lint_request_maps_to_lint_protocol_request() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Lint { json: false },
        };

        assert_eq!(
            request_from_command(&command).unwrap(),
            CliRequest::LlmWikiLint
        );
    }

    #[test]
    fn llm_wiki_digest_rejects_blank_title() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Digest {
                title: "   ".to_string(),
                prompt: vec!["Summarize".to_string()],
            },
        };

        let error = request_from_command(&command).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "title must not be empty");
        assert_eq!(
            response_from_io_error(&error).error_code.as_deref(),
            Some("invalid_title")
        );
    }

    #[test]
    fn llm_wiki_digest_rejects_blank_prompt() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Digest {
                title: "karpathy-llm-wiki".to_string(),
                prompt: vec!["   ".to_string()],
            },
        };

        let error = request_from_command(&command).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "prompt must not be empty");
        assert_eq!(
            response_from_io_error(&error).error_code.as_deref(),
            Some("invalid_prompt")
        );
    }

    #[test]
    fn llm_wiki_query_rejects_blank_question() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: false,
                question: vec!["   ".to_string()],
            },
        };

        let error = request_from_command(&command).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "question must not be empty");
        assert_eq!(
            response_from_io_error(&error).error_code.as_deref(),
            Some("invalid_question")
        );
    }

    #[test]
    fn llm_wiki_search_rejects_blank_query() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Search {
                query: vec!["   ".to_string()],
            },
        };

        let error = request_from_command(&command).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "query must not be empty");
        assert_eq!(
            response_from_io_error(&error).error_code.as_deref(),
            Some("invalid_query")
        );
    }

    #[test]
    fn llm_wiki_query_default_output_is_answer_text_only() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: false,
                question: vec!["raw".to_string()],
            },
        };
        let response = CliResponse {
            ok: true,
            answer: Some("raw 目录用于存放一手素材。".to_string()),
            references: Some(vec![CliWikiSearchResult {
                path: "wiki/concepts/raw.md".to_string(),
                title: "raw".to_string(),
                snippet: "raw 目录用于存放一手素材".to_string(),
            }]),
            insufficient_context: Some(false),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            "raw 目录用于存放一手素材。"
        );
    }

    #[test]
    fn llm_wiki_query_json_output_is_full_response_json() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Query {
                json: true,
                question: vec!["raw".to_string()],
            },
        };
        let response = CliResponse {
            ok: true,
            answer: Some("资料不足。".to_string()),
            insufficient_context: Some(true),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            r#"{"ok":true,"answer":"资料不足。","insufficient_context":true}"#
        );
    }

    #[test]
    fn llm_wiki_search_output_is_json_with_empty_results() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Search {
                query: vec!["missing".to_string()],
            },
        };
        let response = CliResponse {
            ok: true,
            results: Some(Vec::new()),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            r#"{"ok":true,"results":[]}"#
        );
    }

    #[test]
    fn llm_wiki_digest_output_is_digest_path() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Digest {
                title: "karpathy-llm-wiki".to_string(),
                prompt: vec!["Summarize".to_string()],
            },
        };
        let response = CliResponse {
            ok: true,
            digest_path: Some("wiki/syntheses/karpathy-llm-wiki.md".to_string()),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            "wiki/syntheses/karpathy-llm-wiki.md"
        );
    }

    #[test]
    fn llm_wiki_lint_default_output_is_report_text_only() {
        let command = CommandLine::LlmWiki {
            command: LlmWikiCommand::Lint { json: false },
        };
        let response = CliResponse {
            ok: true,
            lint_report: Some("OK".to_string()),
            ..CliResponse::default()
        };

        assert_eq!(success_output(&command, &response), "OK");
    }

    #[test]
    fn memory_recall_request_joins_multiword_query() {
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Recall {
                limit: Some(3),
                max_items: Some(5),
                query: vec!["phase".to_string(), "one".to_string()],
            },
        };

        assert_eq!(
            request_from_command(&command).unwrap(),
            CliRequest::MemoryRecall {
                query: "phase one".to_string(),
                limit: Some(3),
                max_items: Some(5),
            }
        );
    }

    #[test]
    fn memory_reading_requests_use_socket_protocol_without_root() {
        let context = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "context",
            "--max-items",
            "4",
            "auth",
            "flow",
        ])
        .unwrap();
        assert_eq!(
            request_from_command(&context.command).unwrap(),
            CliRequest::MemoryContext {
                query: "auth flow".to_string(),
                max_items: Some(4),
                dao_tian_limit: None,
            }
        );

        let brief = Cli::try_parse_from(["mdx-cli", "memory", "brief", "auth", "flow"]).unwrap();
        assert_eq!(
            request_from_command(&brief.command).unwrap(),
            CliRequest::MemoryBrief {
                query: "auth flow".to_string(),
            }
        );

        let search =
            Cli::try_parse_from(["mdx-cli", "memory", "search", "--limit", "5", "auth"]).unwrap();
        assert_eq!(
            request_from_command(&search.command).unwrap(),
            CliRequest::MemorySearch {
                query: "auth".to_string(),
                limit: Some(5),
                wing: None,
                room: None,
            }
        );
    }

    #[test]
    fn memory_conclusion_requests_use_socket_protocol_without_root() {
        let distill = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "distill",
            "--statement",
            " We use JWT ",
            "--body",
            "Access tokens are JWTs.",
            "--tier",
            "pattern",
            "--ref",
            "drawer-1",
            "--ref",
            "drawer-2",
        ])
        .unwrap();
        assert_eq!(
            request_from_command(&distill.command).unwrap(),
            CliRequest::MemoryDistill {
                statement: "We use JWT".to_string(),
                body: "Access tokens are JWTs.".to_string(),
                tier: Some("pattern".to_string()),
                supporting_refs: vec!["drawer-1".to_string(), "drawer-2".to_string()],
            }
        );

        let gate = Cli::try_parse_from(["mdx-cli", "memory", "gate", "drawer-1"]).unwrap();
        assert_eq!(
            request_from_command(&gate.command).unwrap(),
            CliRequest::MemoryGate {
                drawer_id: "drawer-1".to_string(),
            }
        );

        let adopt =
            Cli::try_parse_from(["mdx-cli", "memory", "adopt", "drawer-1", "--note", "checked"])
                .unwrap();
        assert_eq!(
            request_from_command(&adopt.command).unwrap(),
            CliRequest::MemoryAdopt {
                drawer_id: "drawer-1".to_string(),
                note: Some("checked".to_string()),
            }
        );

        let demote = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "demote",
            "drawer-1",
            "--reason-type",
            "contradicted",
            "--reason",
            "the flow changed",
            "--evidence-ref",
            "drawer-2",
            "--retire",
        ])
        .unwrap();
        assert_eq!(
            request_from_command(&demote.command).unwrap(),
            CliRequest::MemoryDemote {
                drawer_id: "drawer-1".to_string(),
                reason_type: "contradicted".to_string(),
                reason: "the flow changed".to_string(),
                evidence_refs: vec!["drawer-2".to_string()],
                retire: true,
            }
        );
    }

    /// Demoting a conclusion without saying what contradicts it is refused by
    /// the parser: the evidence is the point of the record.
    #[test]
    fn memory_demote_requires_evidence() {
        let error = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "demote",
            "drawer-1",
            "--reason-type",
            "contradicted",
            "--reason",
            "the flow changed",
        ])
        .err()
        .expect("demoting without evidence must be refused");

        assert!(error.to_string().contains("--evidence-ref"), "{error}");
    }

    /// A conclusion has to rest on material that is already stored, so the
    /// parser will not build the request without at least one reference.
    #[test]
    fn memory_distill_requires_supporting_material() {
        let error = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "distill",
            "--statement",
            "We use JWT",
            "--body",
            "Access tokens are JWTs.",
        ])
        .err()
        .expect("a conclusion without supporting material must be refused");

        assert!(error.to_string().contains("--ref"), "{error}");
    }

    #[test]
    fn memory_lifecycle_requests_use_socket_protocol_without_root() {
        let model = Cli::try_parse_from(["mdx-cli", "memory", "model", "--download"]).unwrap();
        assert_eq!(
            request_from_command(&model.command).unwrap(),
            CliRequest::MemoryModel { download: true }
        );

        let reindex = Cli::try_parse_from(["mdx-cli", "memory", "reindex"]).unwrap();
        assert_eq!(
            request_from_command(&reindex.command).unwrap(),
            CliRequest::MemoryReindex
        );

        let list = Cli::try_parse_from([
            "mdx-cli", "memory", "list", "--kind", "conclusion", "--status", "candidate",
        ])
        .unwrap();
        assert_eq!(
            request_from_command(&list.command).unwrap(),
            CliRequest::MemoryList {
                kind: Some("conclusion".to_string()),
                status: Some("candidate".to_string()),
                limit: None,
            }
        );

        let delete = Cli::try_parse_from(["mdx-cli", "memory", "delete", "drawer-1"]).unwrap();
        assert_eq!(
            request_from_command(&delete.command).unwrap(),
            CliRequest::MemoryDelete {
                drawer_id: "drawer-1".to_string(),
            }
        );

        let legacy =
            Cli::try_parse_from(["mdx-cli", "memory", "legacy-import", "--dry-run"]).unwrap();
        assert_eq!(
            request_from_command(&legacy.command).unwrap(),
            CliRequest::MemoryLegacyImport { dry_run: true }
        );
    }

    #[test]
    fn memory_bundle_requests_use_socket_protocol_without_root() {
        let export = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Export {
                output: "memory-bundle".to_string(),
            },
        };
        assert!(matches!(
            request_from_command(&export).unwrap(),
            CliRequest::MemoryExport { output_path } if output_path.ends_with("memory-bundle")
        ));

        let import = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Import {
                input: "memory-bundle".to_string(),
            },
        };
        assert!(matches!(
            request_from_command(&import).unwrap(),
            CliRequest::MemoryImport { input_path } if input_path.ends_with("memory-bundle")
        ));
    }

    #[test]
    fn memory_promote_request_accepts_a_positional_or_flagged_target() {
        let positional = Cli::try_parse_from(["mdx-cli", "memory", "promote", "drawer-1"]).unwrap();
        assert_eq!(
            request_from_command(&positional.command).unwrap(),
            CliRequest::MemoryPromote {
                target: "drawer-1".to_string(),
                ingest: false,
                title: None,
            }
        );

        let flagged = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "promote",
            "--target",
            "drawer-1",
            "--ingest",
            "--title",
            "Promoted",
        ])
        .unwrap();
        assert_eq!(
            request_from_command(&flagged.command).unwrap(),
            CliRequest::MemoryPromote {
                target: "drawer-1".to_string(),
                ingest: true,
                title: Some("Promoted".to_string()),
            }
        );
    }

    #[test]
    fn memory_capture_requests_use_socket_protocol_without_root() {
        let scan = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "capture",
            "scan",
            "--path",
            "/tmp/ws/notes",
        ])
        .unwrap();
        assert_eq!(
            request_from_command(&scan.command).unwrap(),
            CliRequest::MemoryCaptureScan {
                path: "/tmp/ws/notes".to_string(),
            }
        );

        let import = Cli::try_parse_from([
            "mdx-cli",
            "memory",
            "capture",
            "import",
            "--path",
            "/tmp/ws/notes/session.md",
        ])
        .unwrap();
        assert_eq!(
            request_from_command(&import.command).unwrap(),
            CliRequest::MemoryCaptureImport {
                path: "/tmp/ws/notes/session.md".to_string(),
            }
        );
    }

    #[test]
    fn memory_add_request_reads_the_body_from_a_file() {
        let root = TempDir::new().unwrap();
        let body_path = root.path().join("decision.md");
        fs::write(&body_path, "We chose SQLite.").unwrap();
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Add {
                body: None,
                file: Some(body_path.to_string_lossy().into_owned()),
                stdin: false,
                source: Some(" meeting-notes ".to_string()),
            },
        };

        assert_eq!(
            request_from_command(&command).unwrap(),
            CliRequest::MemoryAdd {
                body: "We chose SQLite.".to_string(),
                source: Some("meeting-notes".to_string()),
            }
        );
    }

    #[test]
    fn memory_add_rejects_two_sources_of_the_same_body() {
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Add {
                body: Some("inline".to_string()),
                file: Some("/tmp/body.md".to_string()),
                stdin: false,
                source: None,
            },
        };

        let error = request_from_command(&command).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(
            error.to_string(),
            "provide exactly one of --body, --file, or --stdin"
        );
    }

    #[test]
    fn memory_root_override_detects_headless_root() {
        let root = TempDir::new().unwrap();
        let command = CommandLine::Memory {
            root: Some(root.path().to_string_lossy().into_owned()),
            command: MemoryCommand::Status {
                json: false,
                agent: None,
            },
        };

        assert_eq!(
            memory_root_override(&command).unwrap(),
            Some(root.path().to_string_lossy().into_owned())
        );
    }

    #[test]
    fn memory_status_agent_without_root_is_invalid_input() {
        let parsed =
            Cli::try_parse_from(["mdx-cli", "memory", "status", "--agent", "codex"]).unwrap();
        let error = request_from_command(&parsed.command).unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(error
            .to_string()
            .contains("memory status --agent requires --root <workspace>"));
    }

    /// A memory command prints the response document, payload and all: its
    /// readers are agents and scripts, and the payload is the memory layer's
    /// own, not a shape this CLI restates.
    #[test]
    fn memory_output_is_the_response_document() {
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Show {
                drawer_id: "drawer-1".to_string(),
            },
        };
        let response = CliResponse {
            ok: true,
            memory: Some(serde_json::json!({
                "drawerId": "drawer-1",
                "kind": "material",
            })),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            r#"{"ok":true,"memory":{"drawerId":"drawer-1","kind":"material"}}"#
        );
    }


    #[test]
    fn serve_authorization_requires_matching_bearer_token_when_configured() {
        assert!(is_authorized(None, None));
        assert!(is_authorized(Some("secret"), Some("Bearer secret")));
        assert!(is_authorized(Some(" secret "), Some("Bearer secret")));
        assert!(!is_authorized(Some("secret"), None));
        assert!(!is_authorized(Some("secret"), Some("Bearer wrong")));
        assert!(!is_authorized(Some("secret"), Some("Basic secret")));
    }

    #[test]
    fn serve_http_connection_enforces_api_key_on_routes() {
        fn request(root: String, api_key: Option<&'static str>, raw: &'static str) -> String {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let addr = listener.local_addr().unwrap();
            let client = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(addr).unwrap();
                stream.write_all(raw.as_bytes()).unwrap();
                stream.shutdown(std::net::Shutdown::Write).unwrap();
                let mut response = String::new();
                stream.read_to_string(&mut response).unwrap();
                response
            });
            let (mut server_stream, _) = listener.accept().unwrap();
            handle_http_connection(&mut server_stream, root, api_key).unwrap();
            drop(server_stream);
            client.join().unwrap()
        }

        let root = TempDir::new().unwrap();
        let root_path = root.path().to_string_lossy().into_owned();

        let unauthorized = request(
            root_path.clone(),
            Some("secret"),
            "GET /memory/status HTTP/1.1\r\nHost: localhost\r\n\r\n",
        );
        assert!(unauthorized.starts_with("HTTP/1.1 401 Unauthorized"));

        // An unknown path proves the key was accepted without opening the
        // library: a bin test has no scratch memory home, and a request that
        // reached the engine would touch the developer's own `~/.mdx`.
        let authorized = request(
            root_path,
            Some("secret"),
            "GET /not-a-route HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer secret\r\n\r\n",
        );
        assert!(authorized.starts_with("HTTP/1.1 404"), "{authorized}");
        assert!(authorized.contains("not_found"), "{authorized}");
    }

    /// The commands that carry a workspace root still reach the memory
    /// executor; the executor itself is covered where a scratch memory home
    /// can be arranged, since running one of these for real would open the
    /// library in the developer's own home.
    #[test]
    fn memory_headless_execution_routes_agent_commands_before_the_library() {
        let root = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        let _env = CodexCaptureEnvGuard::use_home_and_session_dirs(home.path(), "");
        let command = CommandLine::Memory {
            root: Some(root.path().to_string_lossy().into_owned()),
            command: MemoryCommand::Status {
                json: false,
                agent: Some("codex".to_string()),
            },
        };

        let response =
            execute_memory_headless(&command, root.path().to_string_lossy().into_owned()).unwrap();

        assert!(response.ok);
        let statuses = response.memory_integrations.expect("agent statuses");
        assert_eq!(statuses.len(), 1);
        assert!(response.memory.is_none());
    }

    #[test]
    fn memory_agent_setup_dry_run_plans_cross_agent_files_without_writing() {
        let home = TempDir::new().unwrap();
        let root = TempDir::new().unwrap();
        let paths = mdx_lib::memory_agent_setup::AgentSetupPaths {
            home: home.path().to_path_buf(),
            mdx_cli: "/tmp/mdx-cli".to_string(),
            mdx_mcp: "/tmp/mdx-mcp".to_string(),
            hook_script: home.path().join(".mdx-memory-precompact-hook.mjs"),
        };
        let targets = mdx_lib::memory_agent_setup::AgentSetupTargets {
            codex: true,
            claude: true,
            cursor: true,
            hooks: true,
        };
        let changes = mdx_lib::memory_agent_setup::plan_memory_agent_setup(
            &root.path().to_string_lossy(),
            &targets,
            &paths,
        )
        .unwrap();
        let summary = mdx_lib::memory_agent_setup::render_agent_setup_summary(&changes, true);
        let skill = changes
            .iter()
            .find(|change| change.path.ends_with(".codey/skills/mdx-memory/SKILL.md"))
            .expect("codex skill change");
        assert!(skill.contents.contains("## Agent-Time Memory Extraction"));
        // The skill has to teach the two layers, because an agent that thinks
        // storing material is the same as asserting a conclusion will fill the
        // library with claims nobody made.
        assert!(skill
            .contents
            .contains("Material is a record, not a claim"));
        assert!(skill
            .contents
            .contains("reaches nobody's context until a person adopts it"));
        assert!(skill
            .contents
            .contains("Do not adopt on the user's behalf without asking."));
        assert!(skill
            .contents
            .contains("deleted afterwards but never unremembered"));
        assert!(skill
            .contents
            .contains("Do not wait for background capture"));
        // Nothing may keep teaching the abandoned model.
        for gone in ["memory_working_get", "memory_inbox_add", "inbox review candidates"] {
            assert!(
                !skill.contents.contains(gone),
                "the installed skill still teaches {gone}"
            );
        }
        assert!(skill.contents.contains("## Keeping A Whole Conversation"));
        assert!(
            skill.contents.contains("stored verbatim with its source"),
            "a transcript is material, and the skill has to say so"
        );
        for gone in ["## Full Thread Archival", "thread save", "Raw Codex JSONL"] {
            assert!(
                !skill.contents.contains(gone),
                "the installed skill still describes the thread layer: {gone}"
            );
        }
        let claude = changes
            .iter()
            .find(|change| change.path.ends_with(".claude/CLAUDE.md"))
            .expect("claude memory block change");
        assert!(claude.contents.contains("cite what you use"));
        assert!(claude.contents.contains("only a person can adopt"));
        assert!(claude.contents.contains("capture is one-way"));
        for gone in ["memory_working_get", "memory_inbox_add"] {
            assert!(
                !claude.contents.contains(gone),
                "the installed Claude block still teaches {gone}"
            );
        }
        let cursor = changes
            .iter()
            .find(|change| change.path.ends_with(".cursor/rules/mdx-memory.mdc"))
            .expect("cursor memory rule change");
        assert!(cursor.contents.contains("cite what you use"));
        assert!(cursor.contents.contains("only a person can adopt"));
        assert!(cursor.contents.contains("capture is one-way"));
        for gone in ["memory_working_get", "memory_inbox_add"] {
            assert!(
                !cursor.contents.contains(gone),
                "the installed Cursor rule still teaches {gone}"
            );
        }
        assert!(summary.contains("would_write"));
        assert!(summary.contains(".codey/config.toml"));
        assert!(summary.contains(".claude/hooks/hooks.json"));
        assert!(summary.contains(".cursor/hooks.json"));
        assert!(!home.path().join(".codey/config.toml").exists());
    }

    #[test]
    fn memory_agent_commands_reject_invalid_agent_names() {
        fn request() -> mdx_lib::memory_agent_setup::MemoryAgentCommandRequest {
            mdx_lib::memory_agent_setup::MemoryAgentCommandRequest {
                agent: Some("unknown".to_string()),
                dry_run: true,
                keep_data: false,
            }
        }

        let root = TempDir::new().unwrap();
        let root_path = root.path().to_string_lossy().into_owned();
        let home = TempDir::new().unwrap();
        let _env = CodexCaptureEnvGuard::use_home_and_session_dirs(home.path(), "");
        let install_error =
            mdx_lib::memory_agent_setup::memory_agent_install(root_path.clone(), request())
                .unwrap_err();
        let repair_error =
            mdx_lib::memory_agent_setup::memory_agent_repair(root_path.clone(), request())
                .unwrap_err();
        let uninstall_error =
            mdx_lib::memory_agent_setup::memory_agent_uninstall(root_path.clone(), request())
                .unwrap_err();
        let status_error = mdx_lib::memory_agent_setup::memory_agent_status(
            root_path.clone(),
            Some("unknown".to_string()),
        )
        .unwrap_err();
        let doctor_error = mdx_lib::memory_agent_setup::memory_agent_doctor(
            root_path,
            Some("unknown".to_string()),
        )
        .unwrap_err();

        for error in [
            install_error,
            repair_error,
            uninstall_error,
            status_error,
            doctor_error,
        ] {
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(error.to_string().contains("invalid memory agent 'unknown'"));
        }
        assert!(!home.path().join(".codey/config.toml").exists());
        assert!(!home.path().join(".claude/CLAUDE.md").exists());
        assert!(!home.path().join(".cursor/rules/mdx-memory.mdc").exists());
    }

    #[test]
    fn memory_agent_setup_writes_cursor_mcp_and_precompact_hook() {
        let home = TempDir::new().unwrap();
        let root = TempDir::new().unwrap();
        let paths = mdx_lib::memory_agent_setup::AgentSetupPaths {
            home: home.path().to_path_buf(),
            mdx_cli: "/tmp/mdx-cli".to_string(),
            mdx_mcp: "/tmp/mdx-mcp".to_string(),
            hook_script: home.path().join(".mdx-memory-precompact-hook.mjs"),
        };
        let targets = mdx_lib::memory_agent_setup::AgentSetupTargets {
            codex: false,
            claude: false,
            cursor: true,
            hooks: true,
        };
        let changes = mdx_lib::memory_agent_setup::plan_memory_agent_setup(
            &root.path().to_string_lossy(),
            &targets,
            &paths,
        )
        .unwrap();
        mdx_lib::memory_agent_setup::apply_agent_setup_changes(&changes).unwrap();
        let mcp = fs::read_to_string(home.path().join(".cursor/mcp.json")).unwrap();
        assert!(mcp.contains("\"mdx-memory\""));
        assert!(mcp.contains("/tmp/mdx-mcp"));
        let hook = fs::read_to_string(home.path().join(".mdx-memory-precompact-hook.mjs")).unwrap();
        assert!(hook.contains("\"capture\""));
        assert!(hook.contains("\"import\""));
        assert!(hook.contains("\"--path\""));
        // The hook must not decide what a compressed conversation meant.
        assert!(!hook.contains("\"distill\""));
        assert!(!hook.contains("\"--accept\""));
    }
}
