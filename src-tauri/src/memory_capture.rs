use serde::Deserialize;

use crate::memory_models::{
    MemoryCaptureCandidate, MemoryCaptureImportRequest, MemoryCaptureImportResult,
    MemoryCaptureScanRequest, MemoryCaptureScanResult, MemoryDistillRequest, ThreadSaveRequest,
};
use crate::models::WorkspaceError;

const VALID_CAPTURE_SOURCES: &[&str] = &["codex", "cursor", "claude-code", "manual"];
const CODEX_SESSION_DIRS_ENV: &str = "MDX_CODEX_SESSION_DIRS";

#[derive(Debug)]
struct ParsedCapture {
    source_thread_id: Option<String>,
    title: Option<String>,
    body: String,
    started_at: Option<String>,
    ended_at: Option<String>,
    message_count: usize,
}

#[derive(Debug, Deserialize)]
struct TranscriptMessage {
    role: String,
    timestamp: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct CursorTranscript {
    id: String,
    messages: Vec<TranscriptMessage>,
}

#[derive(Debug, Deserialize)]
struct ClaudeCodeTranscript {
    session_id: String,
    messages: Vec<TranscriptMessage>,
}

pub(crate) fn memory_capture_import(
    root: impl AsRef<std::path::Path>,
    request: MemoryCaptureImportRequest,
) -> Result<MemoryCaptureImportResult, WorkspaceError> {
    let root = root.as_ref();
    let source = validate_capture_source(&request.source)?;
    let import_path = validate_import_path(&request.path)?;
    let contents = std::fs::read_to_string(&import_path).map_err(|error| {
        WorkspaceError::new(
            "capture_import_read_failed",
            format!("failed to read capture import file: {error}"),
        )
    })?;
    let parsed = parse_capture(source, &contents)?;
    let title = request
        .title
        .clone()
        .filter(|title| !title.trim().is_empty())
        .or_else(|| parsed.title.clone())
        .or_else(|| parsed.source_thread_id.clone())
        .unwrap_or_else(|| "Manual import".to_string());

    let save_result = crate::memory_thread::memory_thread_save(
        root,
        ThreadSaveRequest {
            source: source.to_string(),
            thread_id: request.thread_id.or(parsed.source_thread_id),
            title: title.clone(),
            body: parsed.body,
            started_at: parsed.started_at,
            ended_at: parsed.ended_at,
            model: None,
            workspace_root: None,
            tags: Vec::new(),
        },
    )?;

    let mut distill_status = "not_requested".to_string();
    let mut distill_error_code = None;
    let mut distill_error_message = None;
    let mut distill_result = None;
    if request.distill {
        match crate::memory_distill::memory_distill(
            root,
            MemoryDistillRequest {
                target: save_result.thread_id.clone(),
                accept: false,
                force: false,
            },
        ) {
            Ok(result) => {
                distill_status = "succeeded".to_string();
                distill_result = Some(result);
            }
            Err(error) => {
                distill_status = "failed".to_string();
                distill_error_code = Some(error.error_code().to_string());
                distill_error_message = Some(error.to_string());
            }
        }
    }

    Ok(MemoryCaptureImportResult {
        source: source.to_string(),
        thread_id: save_result.thread_id,
        path: save_result.path,
        title,
        message_count: parsed.message_count,
        distilled: distill_result.is_some(),
        distill_status,
        distill_error_code,
        distill_error_message,
        distill_result,
    })
}

pub(crate) fn memory_capture_scan(
    _root: impl AsRef<std::path::Path>,
    request: MemoryCaptureScanRequest,
) -> Result<MemoryCaptureScanResult, WorkspaceError> {
    let source = validate_capture_source(&request.source)?;
    if source == "codex" {
        return Ok(scan_codex_capture_candidates());
    }

    Ok(MemoryCaptureScanResult {
        source: source.to_string(),
        status: "capture_scan_not_configured".to_string(),
        paths: Vec::new(),
        candidates: Vec::new(),
    })
}

fn scan_codex_capture_candidates() -> MemoryCaptureScanResult {
    let dirs = codex_session_dirs();
    let existing_dirs = existing_unique_codex_session_dirs(dirs);
    if existing_dirs.is_empty() {
        return MemoryCaptureScanResult {
            source: "codex".to_string(),
            status: "capture_scan_not_configured".to_string(),
            paths: Vec::new(),
            candidates: Vec::new(),
        };
    }

    let mut candidates = Vec::new();
    for dir in existing_dirs {
        collect_codex_candidates(&dir, &mut candidates);
    }

    dedupe_codex_candidates_by_path(&mut candidates);
    candidates.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| right.path.cmp(&left.path))
    });
    let paths = candidates
        .iter()
        .map(|candidate| candidate.path.clone())
        .collect();

    MemoryCaptureScanResult {
        source: "codex".to_string(),
        status: "configured".to_string(),
        paths,
        candidates,
    }
}

fn codex_session_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Some(configured_dirs) = std::env::var_os(CODEX_SESSION_DIRS_ENV) {
        dirs.extend(
            std::env::split_paths(&configured_dirs).filter(|path| !path.as_os_str().is_empty()),
        );
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = std::path::PathBuf::from(home);
        dirs.push(home.join(".codex/sessions"));
        dirs.push(home.join(".codex/archived_sessions"));
    }
    dirs
}

fn existing_unique_codex_session_dirs(dirs: Vec<std::path::PathBuf>) -> Vec<std::path::PathBuf> {
    let mut seen = std::collections::BTreeSet::new();
    let mut unique_dirs = Vec::new();
    for dir in dirs {
        let Ok(canonical_dir) = std::fs::canonicalize(dir) else {
            continue;
        };
        if !canonical_dir.is_dir() {
            continue;
        }
        let key = canonical_dir.to_string_lossy().into_owned();
        if seen.insert(key) {
            unique_dirs.push(canonical_dir);
        }
    }
    unique_dirs
}

fn collect_codex_candidates(dir: &std::path::Path, candidates: &mut Vec<MemoryCaptureCandidate>) {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current_dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(current_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() || !is_codex_rollout_jsonl(&path) {
                continue;
            }
            candidates.push(build_codex_candidate(path));
        }
    }
}

fn dedupe_codex_candidates_by_path(candidates: &mut Vec<MemoryCaptureCandidate>) {
    let mut seen = std::collections::BTreeSet::new();
    candidates.retain(|candidate| seen.insert(candidate.path.clone()));
}

fn is_codex_rollout_jsonl(path: &std::path::Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    path.extension().and_then(|extension| extension.to_str()) == Some("jsonl")
        && file_name.starts_with("rollout-")
}

fn build_codex_candidate(path: std::path::PathBuf) -> MemoryCaptureCandidate {
    let metadata = std::fs::metadata(&path).ok();
    let bytes = metadata.as_ref().map_or(0, std::fs::Metadata::len);
    let modified_at = metadata
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_rfc3339);
    let session_meta = read_codex_session_meta(&path);

    MemoryCaptureCandidate {
        path: path.to_string_lossy().into_owned(),
        source: "codex".to_string(),
        thread_id: session_meta
            .id
            .as_ref()
            .map(|id| format!("codex:{}", id.trim())),
        title: session_meta.id.as_ref().map(|id| {
            let preview: String = id.chars().take(8).collect();
            format!("Codex session {preview}")
        }),
        started_at: session_meta.timestamp,
        modified_at,
        bytes,
    }
}

#[derive(Default)]
struct CodexSessionMeta {
    id: Option<String>,
    timestamp: Option<String>,
}

fn read_codex_session_meta(path: &std::path::Path) -> CodexSessionMeta {
    use std::io::BufRead;

    let Ok(file) = std::fs::File::open(path) else {
        return CodexSessionMeta::default();
    };
    let reader = std::io::BufReader::new(file);
    for line in reader.lines().take(20).flatten() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if value.get("type").and_then(serde_json::Value::as_str) != Some("session_meta") {
            continue;
        }
        let payload = value.get("payload").unwrap_or(&serde_json::Value::Null);
        return CodexSessionMeta {
            id: payload
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .filter(|id| !id.trim().is_empty()),
            timestamp: payload
                .get("timestamp")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .filter(|timestamp| !timestamp.trim().is_empty()),
        };
    }
    CodexSessionMeta::default()
}

fn system_time_to_rfc3339(time: std::time::SystemTime) -> Option<String> {
    let time = time::OffsetDateTime::from(time);
    time.format(&time::format_description::well_known::Rfc3339)
        .ok()
}

fn validate_capture_source(source: &str) -> Result<&'static str, WorkspaceError> {
    let source = source.trim();
    VALID_CAPTURE_SOURCES
        .iter()
        .copied()
        .find(|candidate| *candidate == source)
        .ok_or_else(|| {
            WorkspaceError::new(
                "invalid_capture_source",
                "capture source must be one of codex, cursor, claude-code, or manual",
            )
        })
}

fn validate_import_path(path: &str) -> Result<std::path::PathBuf, WorkspaceError> {
    if path.trim().is_empty() {
        return Err(WorkspaceError::new(
            "invalid_capture_path",
            "capture import path must not be empty",
        ));
    }
    let path = std::path::PathBuf::from(path);
    let metadata = std::fs::metadata(&path).map_err(|error| {
        WorkspaceError::new(
            "invalid_capture_path",
            format!("capture import path is not readable: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(WorkspaceError::new(
            "invalid_capture_path",
            "capture import path must be a file",
        ));
    }
    Ok(path)
}

fn parse_capture(source: &str, contents: &str) -> Result<ParsedCapture, WorkspaceError> {
    match source {
        "codex" => parse_codex_jsonl(contents),
        "cursor" => parse_cursor_json(contents),
        "claude-code" => parse_claude_code_json(contents),
        "manual" => parse_manual(contents),
        _ => unreachable!("source was already validated"),
    }
}

fn parse_codex_jsonl(contents: &str) -> Result<ParsedCapture, WorkspaceError> {
    let values = parse_codex_jsonl_values(contents)?;
    if values
        .iter()
        .all(|value| value.get("role").is_some() && value.get("timestamp").is_some())
    {
        return parse_simple_codex_jsonl(contents);
    }
    parse_real_codex_jsonl(contents, &values)
}

fn parse_codex_jsonl_values(contents: &str) -> Result<Vec<serde_json::Value>, WorkspaceError> {
    let mut values = Vec::new();
    for (index, line) in contents.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(line).map_err(|error| {
            WorkspaceError::new(
                "capture_parse_failed",
                format!("failed to parse Codex JSONL line {}: {error}", index + 1),
            )
        })?;
        values.push(value);
    }
    Ok(values)
}

fn parse_simple_codex_jsonl(contents: &str) -> Result<ParsedCapture, WorkspaceError> {
    let mut messages = Vec::new();
    for (index, line) in contents.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let message: TranscriptMessage = serde_json::from_str(line).map_err(|error| {
            WorkspaceError::new(
                "capture_parse_failed",
                format!("failed to parse Codex JSONL line {}: {error}", index + 1),
            )
        })?;
        messages.push(message);
    }
    let mut parsed = parsed_messages(None, None, messages)?;
    append_raw_codex_jsonl(&mut parsed.body, contents);
    Ok(parsed)
}

fn parse_real_codex_jsonl(
    contents: &str,
    values: &[serde_json::Value],
) -> Result<ParsedCapture, WorkspaceError> {
    let mut session_id = None;
    let mut session_timestamp = None;
    let mut messages = Vec::new();

    for value in values {
        let event_type = value.get("type").and_then(serde_json::Value::as_str);
        let payload = value.get("payload").unwrap_or(&serde_json::Value::Null);

        if event_type == Some("session_meta") {
            session_id = payload
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .filter(|id| !id.trim().is_empty())
                .or(session_id);
            session_timestamp = payload
                .get("timestamp")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .filter(|timestamp| !timestamp.trim().is_empty())
                .or(session_timestamp);
            continue;
        }

        if event_type != Some("response_item")
            || payload.get("type").and_then(serde_json::Value::as_str) != Some("message")
        {
            continue;
        }

        let role = payload
            .get("role")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let timestamp = value
            .get("timestamp")
            .and_then(serde_json::Value::as_str)
            .or_else(|| payload.get("timestamp").and_then(serde_json::Value::as_str))
            .or(session_timestamp.as_deref())
            .unwrap_or("")
            .trim()
            .to_string();
        let content = codex_message_content(payload).trim().to_string();

        messages.push(TranscriptMessage {
            role,
            timestamp,
            content,
        });
    }

    let source_thread_id = session_id.as_ref().map(|id| format!("codex:{}", id.trim()));
    let title = session_id.as_ref().map(|id| {
        let preview: String = id.chars().take(8).collect();
        format!("Codex session {preview}")
    });
    let started_at = session_timestamp.clone();
    let mut parsed = parsed_messages(source_thread_id, title, messages)?;
    if started_at.is_some() {
        parsed.started_at = started_at;
    }
    append_raw_codex_jsonl(&mut parsed.body, contents);
    Ok(parsed)
}

fn codex_message_content(payload: &serde_json::Value) -> String {
    let Some(content) = payload.get("content") else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    let Some(items) = content.as_array() else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|item| item.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

fn append_raw_codex_jsonl(body: &mut String, contents: &str) {
    body.push_str("\n\n## Raw Codex JSONL\n\n```jsonl\n");
    body.push_str(contents.trim_end());
    body.push_str("\n```");
}

fn parse_cursor_json(contents: &str) -> Result<ParsedCapture, WorkspaceError> {
    let transcript: CursorTranscript = serde_json::from_str(contents).map_err(|error| {
        WorkspaceError::new(
            "capture_parse_failed",
            format!("failed to parse Cursor transcript JSON: {error}"),
        )
    })?;
    parsed_messages(
        Some(transcript.id.clone()),
        Some(transcript.id),
        transcript.messages,
    )
}

fn parse_claude_code_json(contents: &str) -> Result<ParsedCapture, WorkspaceError> {
    let transcript: ClaudeCodeTranscript = serde_json::from_str(contents).map_err(|error| {
        WorkspaceError::new(
            "capture_parse_failed",
            format!("failed to parse Claude Code transcript JSON: {error}"),
        )
    })?;
    parsed_messages(
        Some(transcript.session_id.clone()),
        Some(transcript.session_id),
        transcript.messages,
    )
}

fn parse_manual(contents: &str) -> Result<ParsedCapture, WorkspaceError> {
    if contents.trim().is_empty() {
        return Err(WorkspaceError::new(
            "capture_parse_failed",
            "manual import body must not be empty",
        ));
    }
    Ok(ParsedCapture {
        source_thread_id: None,
        title: Some("Manual import".to_string()),
        body: contents.trim().to_string(),
        started_at: None,
        ended_at: None,
        message_count: 0,
    })
}

fn parsed_messages(
    source_thread_id: Option<String>,
    title: Option<String>,
    messages: Vec<TranscriptMessage>,
) -> Result<ParsedCapture, WorkspaceError> {
    if messages.is_empty() {
        return Err(WorkspaceError::new(
            "capture_parse_failed",
            "capture transcript must contain at least one message",
        ));
    }
    for message in &messages {
        if message.role.trim().is_empty()
            || message.timestamp.trim().is_empty()
            || message.content.trim().is_empty()
        {
            return Err(WorkspaceError::new(
                "capture_parse_failed",
                "capture messages must include role, timestamp, and content",
            ));
        }
    }

    let started_at = messages.first().map(|message| message.timestamp.clone());
    let ended_at = messages.last().map(|message| message.timestamp.clone());
    let message_count = messages.len();
    Ok(ParsedCapture {
        source_thread_id,
        title,
        body: render_messages(&messages),
        started_at,
        ended_at,
        message_count,
    })
}

fn render_messages(messages: &[TranscriptMessage]) -> String {
    let mut body = String::new();
    for (index, message) in messages.iter().enumerate() {
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str(&format!(
            "## Message {} — {} — {}\n\n{}\n",
            index + 1,
            message.role.trim(),
            message.timestamp.trim(),
            message.content.trim()
        ));
    }
    body
}
