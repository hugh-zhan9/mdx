use std::env;
use std::io::{self, BufRead, BufReader, Write};
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

#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
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
    })
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
}
