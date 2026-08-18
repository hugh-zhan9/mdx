//! Formatting what a hook hands back to its agent.
//!
//! Each agent reads injected context from a different shape of output, and an
//! event that does not accept context gets nothing rather than something it
//! will print at the user.

use crate::WorkspaceError;

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

