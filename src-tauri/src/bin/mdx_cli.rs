use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, ExitCode};
use std::thread;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use mdx_lib::cli_protocol::{CliRequest, CliResponse};
use mdx_lib::memory;

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
    Status {
        #[arg(long)]
        json: bool,
    },
    Init,
    Repair {
        #[arg(long)]
        rebuild_index: bool,
    },
    Index {
        #[command(subcommand)]
        command: MemoryIndexCommand,
    },
    Thread {
        #[command(subcommand)]
        command: MemoryThreadCommand,
    },
    Add {
        #[arg(long)]
        title: String,
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
        #[arg(long = "tag")]
        tags: Vec<String>,
        #[arg(long)]
        source_thread: Option<String>,
        #[arg(long)]
        importance: Option<f64>,
        #[arg(long)]
        confidence: Option<f64>,
    },
    Show {
        target: String,
    },
    List {
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        since: Option<String>,
    },
    Search {
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    Archive {
        target: String,
    },
    Inbox {
        #[command(subcommand)]
        command: MemoryInboxCommand,
    },
    Working {
        #[command(subcommand)]
        command: MemoryWorkingCommand,
    },
    Recall {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long)]
        byte_budget: Option<usize>,
        #[arg(long)]
        no_working: bool,
        #[arg(long)]
        include_threads: bool,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    Promote {
        #[arg(long = "thread")]
        target: String,
        #[arg(long)]
        ingest: bool,
        #[arg(long)]
        title: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryIndexCommand {
    Status,
    Rebuild,
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryThreadCommand {
    Save {
        #[arg(long)]
        source: String,
        #[arg(long)]
        thread_id: Option<String>,
        #[arg(long)]
        title: String,
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
    },
    Show {
        target: String,
    },
    List {
        #[arg(long)]
        source: Option<String>,
        #[arg(long)]
        since: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryInboxCommand {
    List {
        #[arg(long)]
        include_reviewed: bool,
        #[arg(long)]
        json: bool,
    },
    Accept {
        inbox_id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        body: Option<String>,
    },
    Reject {
        inbox_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
enum MemoryWorkingCommand {
    Get,
    Set {
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
    },
    Append {
        #[arg(long)]
        section: String,
        #[arg(long)]
        text: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        stdin: bool,
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

fn run() -> io::Result<(CommandLine, CliResponse)> {
    let cli = Cli::parse();
    let command = cli.command;
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
    })
}

fn request_from_memory_command(command: &MemoryCommand) -> io::Result<CliRequest> {
    Ok(match command {
        MemoryCommand::Status { .. } => CliRequest::MemoryStatus,
        MemoryCommand::Init => CliRequest::MemoryInit,
        MemoryCommand::Repair { rebuild_index } => CliRequest::MemoryRepair {
            rebuild_index: *rebuild_index,
        },
        MemoryCommand::Index { command } => match command {
            MemoryIndexCommand::Status => CliRequest::MemoryIndexStatus,
            MemoryIndexCommand::Rebuild => CliRequest::MemoryIndexRebuild,
        },
        MemoryCommand::Thread { command } => match command {
            MemoryThreadCommand::Save {
                source,
                thread_id,
                title,
                body,
                file,
                stdin,
            } => CliRequest::MemoryThreadSave {
                source: trim_required_value(source, "source")?,
                thread_id: thread_id.clone(),
                title: trim_required_value(title, "title")?,
                body: read_input_from_file_or_stdin(file.as_deref(), body.as_deref(), *stdin)?,
            },
            MemoryThreadCommand::Show { target } => CliRequest::MemoryThreadShow {
                target: trim_required_value(target, "target")?,
            },
            MemoryThreadCommand::List { source, since } => CliRequest::MemoryThreadList {
                source: source.clone(),
                since: parse_since_arg(since)?,
            },
        },
        MemoryCommand::Add {
            title,
            body,
            file,
            stdin,
            tags,
            source_thread,
            importance,
            confidence,
        } => CliRequest::MemoryAdd {
            title: trim_required_value(title, "title")?,
            body: read_input_from_file_or_stdin(file.as_deref(), body.as_deref(), *stdin)?,
            tags: tags.clone(),
            source_thread: source_thread.clone(),
            importance: *importance,
            confidence: *confidence,
        },
        MemoryCommand::Show { target } => CliRequest::MemoryShow {
            target: trim_required_value(target, "target")?,
        },
        MemoryCommand::List { tag, since } => CliRequest::MemoryList {
            tag: tag.clone(),
            since: parse_since_arg(since)?,
        },
        MemoryCommand::Search {
            query,
            limit,
            tag,
            since,
        } => CliRequest::MemorySearch {
            query: join_required_words(query, "query")?,
            limit: *limit,
            tag: tag.clone(),
            since: parse_since_arg(since)?,
        },
        MemoryCommand::Archive { target } => CliRequest::MemoryArchive {
            target: trim_required_value(target, "target")?,
        },
        MemoryCommand::Inbox { command } => match command {
            MemoryInboxCommand::List {
                include_reviewed, ..
            } => CliRequest::MemoryInboxList {
                include_reviewed: *include_reviewed,
            },
            MemoryInboxCommand::Accept {
                inbox_id,
                title,
                file,
                body,
            } => CliRequest::MemoryInboxAccept {
                inbox_id: trim_required_value(inbox_id, "inbox_id")?,
                title: title
                    .as_deref()
                    .map(|value| trim_required_value(value, "title"))
                    .transpose()?,
                body: read_optional_input_from_file_or_inline(file.as_deref(), body.as_deref())?,
                tags: None,
            },
            MemoryInboxCommand::Reject { inbox_id } => CliRequest::MemoryInboxReject {
                inbox_id: trim_required_value(inbox_id, "inbox_id")?,
            },
        },
        MemoryCommand::Working { command } => match command {
            MemoryWorkingCommand::Get => CliRequest::MemoryWorkingGet,
            MemoryWorkingCommand::Set { body, file, stdin } => CliRequest::MemoryWorkingSet {
                content: read_input_from_file_or_stdin(file.as_deref(), body.as_deref(), *stdin)?,
            },
            MemoryWorkingCommand::Append {
                section,
                text,
                file,
                stdin,
            } => CliRequest::MemoryWorkingAppend {
                section: trim_required_value(section, "section")?,
                text: read_input_from_file_or_stdin(file.as_deref(), text.as_deref(), *stdin)?,
            },
        },
        MemoryCommand::Recall {
            query,
            limit,
            byte_budget,
            no_working,
            include_threads,
            tag,
            since,
            ..
        } => CliRequest::MemoryRecall {
            query: join_required_words(query, "query")?,
            limit: *limit,
            byte_budget: *byte_budget,
            include_working: if *no_working { Some(false) } else { None },
            include_threads: Some(*include_threads),
            tag: tag.clone(),
            since: parse_since_arg(since)?,
        },
        MemoryCommand::Promote {
            target,
            ingest,
            title,
        } => CliRequest::MemoryPromote {
            target: trim_required_value(target, "target")?,
            ingest: Some(*ingest),
            title: title.clone(),
        },
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

    if let MemoryCommand::Index { command } = command {
        return Ok(execute_memory_index_headless(command, root_path));
    }

    let response = match request_from_memory_command(command)? {
        CliRequest::MemoryStatus => match memory::memory_detect_workspace(root_path.clone()) {
            Ok(status) => CliResponse {
                ok: true,
                root_path: Some(root_path),
                memory_status: Some(status),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryInit => match memory::memory_initialize_workspace(root_path.clone()) {
            Ok(result) => CliResponse {
                ok: true,
                root_path: Some(root_path),
                memory_init: Some(result),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryRepair { rebuild_index } => {
            let request = memory::MemoryRepairRequest { rebuild_index };
            match memory::memory_repair_workspace(root_path.clone(), request) {
                Ok(result) => CliResponse {
                    ok: true,
                    root_path: Some(root_path),
                    memory_repair: Some(result),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryIndexStatus => match memory::memory_index_status(root_path.clone()) {
            Ok(status) => CliResponse {
                ok: true,
                root_path: Some(root_path),
                memory_index_status: Some(status),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryIndexRebuild => match memory::memory_index_rebuild(root_path.clone()) {
            Ok(status) => CliResponse {
                ok: true,
                root_path: Some(root_path),
                memory_index_status: Some(status),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryThreadSave {
            source,
            thread_id,
            title,
            body,
        } => {
            let request = memory::ThreadSaveRequest {
                source,
                thread_id,
                title,
                body,
                started_at: None,
                ended_at: None,
                model: None,
                workspace_root: None,
                tags: Vec::new(),
            };
            match memory::memory_thread_save(root_path.clone(), request)
                .and_then(|result| memory::memory_thread_get(root_path, result.thread_id))
            {
                Ok(record) => CliResponse {
                    ok: true,
                    memory_thread: Some(record),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryThreadShow { target } => {
            match memory::memory_thread_get(root_path.clone(), target) {
                Ok(record) => {
                    record_response_with_content(root_path, record.path.clone(), |response| {
                        CliResponse {
                            memory_thread: Some(record),
                            ..response
                        }
                    })
                }
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryThreadList { source, since } => {
            match memory::memory_thread_list(root_path, memory::ThreadListFilter { source, since })
            {
                Ok(threads) => CliResponse {
                    ok: true,
                    memory_threads: Some(threads),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryAdd {
            title,
            body,
            tags,
            source_thread,
            importance,
            confidence,
        } => {
            let request = memory::MemoryAddRequest {
                title,
                body,
                tags,
                source_thread,
                importance,
                confidence,
            };
            match memory::memory_add(root_path, request) {
                Ok(record) => CliResponse {
                    ok: true,
                    memory_entry: Some(record),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryShow { target } => match memory::memory_get(root_path.clone(), target) {
            Ok(record) => {
                record_response_with_content(root_path, record.path.clone(), |response| {
                    CliResponse {
                        memory_entry: Some(record),
                        ..response
                    }
                })
            }
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryList { tag, since } => match memory::memory_list(
            root_path,
            memory::MemoryListFilter {
                tag,
                since,
                include_archived: false,
            },
        ) {
            Ok(entries) => CliResponse {
                ok: true,
                memory_entries: Some(entries),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemorySearch {
            query,
            limit,
            tag,
            since,
        } => match memory::memory_search(root_path, query, limit, tag, since) {
            Ok(entries) => CliResponse {
                ok: true,
                memory_entries: Some(entries),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryArchive { target } => match memory::memory_archive(root_path, target) {
            Ok(record) => CliResponse {
                ok: true,
                memory_entry: Some(record),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryInboxList { include_reviewed } => {
            match memory::memory_inbox_list(root_path, include_reviewed) {
                Ok(entries) => CliResponse {
                    ok: true,
                    memory_inbox_entries: Some(entries),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryInboxAccept {
            inbox_id,
            title,
            body,
            tags,
        } => {
            let request = memory::InboxReviewRequest {
                inbox_id,
                title,
                body,
                tags,
            };
            match memory::memory_inbox_accept(root_path, request) {
                Ok(result) => CliResponse {
                    ok: true,
                    memory_inbox_review: Some(result),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryInboxReject { inbox_id } => {
            match memory::memory_inbox_reject(root_path, inbox_id) {
                Ok(result) => CliResponse {
                    ok: true,
                    memory_inbox_review: Some(result),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryWorkingGet => match memory::memory_working_get(root_path) {
            Ok(content) => CliResponse {
                ok: true,
                content: Some(content),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        CliRequest::MemoryWorkingSet { content } => {
            match memory::memory_working_set(root_path, content) {
                Ok(content) => CliResponse {
                    ok: true,
                    content: Some(content),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryWorkingAppend { section, text } => {
            match memory::memory_working_append(root_path, section, text) {
                Ok(content) => CliResponse {
                    ok: true,
                    content: Some(content),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryRecall {
            query,
            limit,
            byte_budget,
            include_working,
            include_threads,
            tag,
            since,
        } => {
            let request = memory::RecallRequest {
                query,
                limit,
                byte_budget,
                include_working: include_working.unwrap_or(true),
                include_threads: include_threads.unwrap_or(false),
                thread_ids: Vec::new(),
                include_wiki_refs: false,
                include_wiki_snippets: false,
                tag,
                since,
            };
            match memory::memory_recall(root_path, request) {
                Ok(result) => CliResponse {
                    ok: true,
                    memory_recall: Some(result),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        CliRequest::MemoryPromote {
            target,
            ingest,
            title,
        } => {
            let request = memory::MemoryPromoteRequest {
                target,
                ingest: ingest.unwrap_or(false),
                title,
            };
            match memory::memory_promote(root_path, request) {
                Ok(result) => CliResponse {
                    ok: true,
                    memory_promote: Some(result),
                    ..CliResponse::default()
                },
                Err(error) => workspace_error_response(error),
            }
        }
        _ => unreachable!("request_from_memory_command only returns memory requests"),
    };

    Ok(response)
}

fn execute_memory_index_headless(command: &MemoryIndexCommand, root_path: String) -> CliResponse {
    match command {
        MemoryIndexCommand::Status => match memory::memory_index_status(root_path.clone()) {
            Ok(status) => CliResponse {
                ok: true,
                root_path: Some(root_path),
                memory_index_status: Some(status),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
        MemoryIndexCommand::Rebuild => match memory::memory_index_rebuild(root_path.clone()) {
            Ok(status) => CliResponse {
                ok: true,
                root_path: Some(root_path),
                memory_index_status: Some(status),
                ..CliResponse::default()
            },
            Err(error) => workspace_error_response(error),
        },
    }
}

fn workspace_error_response(error: mdx_lib::WorkspaceError) -> CliResponse {
    CliResponse::error(error.error_code(), error.to_string())
}

fn record_response_with_content<T>(
    root_path: String,
    relative_path: String,
    build: impl FnOnce(CliResponse) -> T,
) -> T {
    let response = match fs::read_to_string(PathBuf::from(root_path).join(relative_path)) {
        Ok(content) => CliResponse {
            ok: true,
            content: Some(content),
            ..CliResponse::default()
        },
        Err(error) => CliResponse::error("read_failed", error.to_string()),
    };
    build(response)
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

fn read_optional_input_from_file_or_inline(
    file: Option<&str>,
    inline: Option<&str>,
) -> io::Result<Option<String>> {
    if file.is_some() && inline.is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "provide at most one of --body or --file",
        ));
    }

    let value = if let Some(path) = file {
        Some(fs::read_to_string(path)?)
    } else {
        inline.map(ToString::to_string)
    };

    value
        .as_deref()
        .map(|content| trim_required_value(content, "content"))
        .transpose()
}

fn parse_since_arg(since: &Option<String>) -> io::Result<Option<String>> {
    since
        .as_deref()
        .map(|value| trim_required_value(value, "since"))
        .transpose()
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
                command: MemoryCommand::Working {
                    command: MemoryWorkingCommand::Get,
                } | MemoryCommand::Show { .. }
                    | MemoryCommand::Thread {
                        command: MemoryThreadCommand::Show { .. },
                    },
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
            command:
                MemoryCommand::Working {
                    command: MemoryWorkingCommand::Get,
                }
                | MemoryCommand::Show { .. }
                | MemoryCommand::Thread {
                    command: MemoryThreadCommand::Show { .. },
                },
            ..
        } => response.content.clone().unwrap_or_default(),
        CommandLine::Memory {
            command: MemoryCommand::Recall { json: false, .. },
            ..
        } => response
            .memory_recall
            .as_ref()
            .map(render_memory_recall)
            .unwrap_or_default(),
        _ => serde_json::to_string(response).unwrap_or_else(|_| "{\"ok\":true}".into()),
    }
}

fn render_memory_recall(result: &memory::RecallResult) -> String {
    let mut output = String::new();
    if let Some(working) = result.working.as_ref() {
        output.push_str(working);
        if !output.ends_with('\n') {
            output.push('\n');
        }
    }
    for item in &result.memories {
        output.push_str("\n## ");
        output.push_str(&item.title);
        output.push('\n');
        output.push_str(&item.snippet);
        output.push('\n');
    }
    for item in &result.threads {
        output.push_str("\n## ");
        output.push_str(&item.title);
        output.push('\n');
        output.push_str(&item.path);
        output.push('\n');
    }
    output
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
    use tempfile::TempDir;

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
                json: false,
                limit: Some(3),
                byte_budget: None,
                no_working: false,
                include_threads: true,
                tag: None,
                since: None,
                query: vec!["phase".to_string(), "one".to_string()],
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::MemoryRecall {
                query,
                limit: Some(3),
                include_working: None,
                include_threads: Some(true),
                ..
            } if query == "phase one"
        ));
    }

    #[test]
    fn memory_recall_no_working_passes_false_to_protocol() {
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Recall {
                json: false,
                limit: None,
                byte_budget: None,
                no_working: true,
                include_threads: false,
                tag: None,
                since: None,
                query: vec!["phase".to_string()],
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::MemoryRecall {
                include_working: Some(false),
                ..
            }
        ));
    }

    #[test]
    fn memory_index_requests_use_socket_protocol_without_root() {
        let status = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Index {
                command: MemoryIndexCommand::Status,
            },
        };
        assert_eq!(
            request_from_command(&status).unwrap(),
            CliRequest::MemoryIndexStatus
        );

        let rebuild = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Index {
                command: MemoryIndexCommand::Rebuild,
            },
        };
        assert_eq!(
            request_from_command(&rebuild).unwrap(),
            CliRequest::MemoryIndexRebuild
        );
    }

    #[test]
    fn memory_inbox_requests_use_socket_protocol_without_root() {
        let list = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Inbox {
                command: MemoryInboxCommand::List {
                    include_reviewed: true,
                    json: true,
                },
            },
        };
        assert_eq!(
            request_from_command(&list).unwrap(),
            CliRequest::MemoryInboxList {
                include_reviewed: true
            }
        );

        let accept = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Inbox {
                command: MemoryInboxCommand::Accept {
                    inbox_id: "inbox_1".to_string(),
                    title: Some("Reviewed".to_string()),
                    file: None,
                    body: Some("Accepted body".to_string()),
                },
            },
        };
        assert_eq!(
            request_from_command(&accept).unwrap(),
            CliRequest::MemoryInboxAccept {
                inbox_id: "inbox_1".to_string(),
                title: Some("Reviewed".to_string()),
                body: Some("Accepted body".to_string()),
                tags: None,
            }
        );

        let reject = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Inbox {
                command: MemoryInboxCommand::Reject {
                    inbox_id: "inbox_1".to_string(),
                },
            },
        };
        assert_eq!(
            request_from_command(&reject).unwrap(),
            CliRequest::MemoryInboxReject {
                inbox_id: "inbox_1".to_string(),
            }
        );
    }

    #[test]
    fn memory_thread_save_request_reads_file_body() {
        let root = TempDir::new().unwrap();
        let body_path = root.path().join("thread.md");
        fs::write(&body_path, "Thread transcript").unwrap();
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Thread {
                command: MemoryThreadCommand::Save {
                    source: "manual".to_string(),
                    thread_id: Some("thread-1".to_string()),
                    title: "Decision".to_string(),
                    body: None,
                    file: Some(body_path.to_string_lossy().into_owned()),
                    stdin: false,
                },
            },
        };

        assert!(matches!(
            request_from_command(&command).unwrap(),
            CliRequest::MemoryThreadSave {
                source,
                thread_id,
                title,
                body,
            } if source == "manual"
                && thread_id == Some("thread-1".to_string())
                && title == "Decision"
                && body == "Thread transcript"
        ));
    }

    #[test]
    fn memory_root_override_detects_headless_root() {
        let root = TempDir::new().unwrap();
        let command = CommandLine::Memory {
            root: Some(root.path().to_string_lossy().into_owned()),
            command: MemoryCommand::Status { json: false },
        };

        assert_eq!(
            memory_root_override(&command).unwrap(),
            Some(root.path().to_string_lossy().into_owned())
        );
    }

    #[test]
    fn memory_working_get_default_output_is_markdown_only() {
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Working {
                command: MemoryWorkingCommand::Get,
            },
        };
        let response = CliResponse {
            ok: true,
            content: Some("# Working Memory\n".to_string()),
            ..CliResponse::default()
        };

        assert_eq!(success_output(&command, &response), "# Working Memory\n");
    }

    #[test]
    fn memory_index_status_output_uses_structured_response_json() {
        let command = CommandLine::Memory {
            root: None,
            command: MemoryCommand::Index {
                command: MemoryIndexCommand::Status,
            },
        };
        let response = CliResponse {
            ok: true,
            memory_index_status: Some(memory::MemoryIndexStatus {
                index_status: "clean".to_string(),
                document_count: 1,
                dirty: false,
            }),
            ..CliResponse::default()
        };

        assert_eq!(
            success_output(&command, &response),
            r#"{"ok":true,"memory_index_status":{"index_status":"clean","document_count":1,"dirty":false}}"#
        );
    }

    #[test]
    fn memory_headless_preserves_workspace_error_code() {
        let root = TempDir::new().unwrap();
        memory::memory_initialize_workspace(root.path().to_string_lossy().into_owned()).unwrap();
        memory::memory_thread_save(
            root.path().to_string_lossy().into_owned(),
            memory::ThreadSaveRequest {
                source: "manual".to_string(),
                thread_id: Some("thread-1".to_string()),
                title: "Thread".to_string(),
                body: "Thread body".to_string(),
                started_at: None,
                ended_at: None,
                model: None,
                workspace_root: None,
                tags: Vec::new(),
            },
        )
        .unwrap();
        let command = CommandLine::Memory {
            root: Some(root.path().to_string_lossy().into_owned()),
            command: MemoryCommand::Promote {
                target: "thread-1".to_string(),
                ingest: true,
                title: None,
            },
        };

        let response =
            execute_memory_headless(&command, root.path().to_string_lossy().into_owned()).unwrap();

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("llm_wiki_not_ready"));
    }
}
