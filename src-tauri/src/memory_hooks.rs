use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

use crate::memory_agent_events::AgentHookEvent;
use crate::WorkspaceError;

pub fn normalize_hook_payload(
    agent_source: &str,
    event_name: &str,
    workspace_root: &str,
    payload: &serde_json::Value,
    deadline_ms: Option<u64>,
) -> Result<AgentHookEvent, WorkspaceError> {
    let session_id = first_string_field(
        payload,
        &[
            "session_id",
            "sessionId",
            "conversation_id",
            "conversationId",
            "content_session_id",
            "contentSessionId",
        ],
    )
    .unwrap_or_else(|| "unknown-session".to_string());
    let turn_id = first_string_field(payload, &["turn_id", "turnId"]);
    let cwd = first_string_field(payload, &["cwd", "workspace_root", "workspaceRoot"])
        .or_else(|| first_array_string_field(payload, "workspace_roots"))
        .or_else(|| first_array_string_field(payload, "workspaceRoots"));
    let canonical_payload = canonical_json(payload);
    let raw = serde_json::to_vec(&canonical_payload).map_err(|error| {
        WorkspaceError::new(
            "hook_payload_encode_failed",
            format!("failed to encode hook payload: {error}"),
        )
    })?;
    let digest = Sha256::digest(&raw);
    let idempotency_key = format!("{agent_source}:{session_id}:{event_name}:{digest:x}");

    Ok(AgentHookEvent {
        agent_source: agent_source.to_string(),
        event_name: event_name.to_string(),
        workspace_root: workspace_root.to_string(),
        cwd,
        session_id,
        turn_id,
        event_seq: payload
            .get("event_seq")
            .or_else(|| payload.get("eventSeq"))
            .and_then(|value| value.as_i64()),
        idempotency_key,
        raw_payload: payload.clone(),
        deadline_ms,
    })
}

pub fn format_hook_output(
    agent_source: &str,
    event_name: &str,
    additional_context: Option<&str>,
) -> Result<String, WorkspaceError> {
    let Some(context) = additional_context.filter(|value| !value.trim().is_empty()) else {
        return Ok(String::new());
    };
    if !accepts_additional_context(event_name) {
        return Ok(String::new());
    }

    match agent_source {
        "codex" => serde_json::to_string(&serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": event_name,
                "additionalContext": context,
            }
        }))
        .map_err(|error| {
            WorkspaceError::new(
                "hook_output_encode_failed",
                format!("failed to encode hook output: {error}"),
            )
        }),
        "claude" | "cursor" => Ok(context.to_string()),
        _ => Ok(String::new()),
    }
}

fn accepts_additional_context(event_name: &str) -> bool {
    matches!(
        event_name,
        "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse"
    )
}

fn first_string_field(payload: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_field(payload, key))
}

fn first_array_string_field(payload: &serde_json::Value, key: &str) -> Option<String> {
    payload
        .get(key)?
        .as_array()?
        .first()?
        .as_str()
        .and_then(clean_string)
}

fn string_field(payload: &serde_json::Value, key: &str) -> Option<String> {
    payload.get(key)?.as_str().and_then(clean_string)
}

fn clean_string(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn canonical_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonical_json).collect())
        }
        serde_json::Value::Object(object) => {
            let sorted = object
                .iter()
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect::<BTreeMap<_, _>>();
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        _ => value.clone(),
    }
}
