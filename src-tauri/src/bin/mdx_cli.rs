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

#[derive(Subcommand)]
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
}

fn main() -> ExitCode {
    match run() {
        Ok((command, response)) => print_response(command, response),
        Err(error) => {
            let response = CliResponse::error("io_error", error.to_string());
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
    })
}

fn print_response(command: CommandLine, response: CliResponse) -> ExitCode {
    if !response.ok {
        let json = serde_json::to_string(&response)
            .unwrap_or_else(|_| "{\"ok\":false,\"error_code\":\"encode_error\"}".into());
        eprintln!("{json}");
        return ExitCode::FAILURE;
    }

    match command {
        CommandLine::Content { .. } => {
            if let Some(content) = response.content {
                print!("{content}");
                let _ = io::stdout().flush();
            }
        }
        _ => {
            let json = serde_json::to_string(&response).unwrap_or_else(|_| "{\"ok\":true}".into());
            println!("{json}");
        }
    }

    ExitCode::SUCCESS
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
