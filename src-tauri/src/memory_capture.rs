use serde::Deserialize;

use crate::memory_models::{
    MemoryCaptureImportRequest, MemoryCaptureImportResult, MemoryCaptureScanRequest,
    MemoryCaptureScanResult, MemoryDistillRequest, ThreadSaveRequest,
};
use crate::models::WorkspaceError;

const VALID_CAPTURE_SOURCES: &[&str] = &["codex", "cursor", "claude-code", "manual"];

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

    let distill_result = if request.distill {
        Some(crate::memory_distill::memory_distill(
            root,
            MemoryDistillRequest {
                target: save_result.thread_id.clone(),
                accept: false,
                force: false,
            },
        )?)
    } else {
        None
    };

    Ok(MemoryCaptureImportResult {
        source: source.to_string(),
        thread_id: save_result.thread_id,
        path: save_result.path,
        title,
        message_count: parsed.message_count,
        distilled: distill_result.is_some(),
        distill_result,
    })
}

pub(crate) fn memory_capture_scan(
    _root: impl AsRef<std::path::Path>,
    request: MemoryCaptureScanRequest,
) -> Result<MemoryCaptureScanResult, WorkspaceError> {
    let source = validate_capture_source(&request.source)?;
    Ok(MemoryCaptureScanResult {
        source: source.to_string(),
        status: "capture_scan_not_configured".to_string(),
        paths: Vec::new(),
    })
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
    parsed_messages(None, None, messages)
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
