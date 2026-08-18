//! The local HTTP surface, and the hook path that uses it.
//!
//! Agent hooks fire on someone else's schedule and must never be the reason a
//! session stalls, so every route here answers rather than fails: a disabled
//! feature, a missing model or an unopenable library all come back as a
//! well-formed response saying so.
//!
//! The route table is the new model's, which makes it much smaller than the one
//! it replaces. Inbox review, working context, index rebuilds and storage
//! migration were routes for concepts that no longer exist; they are gone
//! rather than stubbed, so a caller learns immediately instead of getting an
//! empty success.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::memory::api;
use crate::memory::capture::{record_session, SessionCapture};
use crate::memory::config::read_workspace_config;
use crate::memory::embedder::build_embedder;
use crate::memory::engine::{wing_for, with_library};
use crate::memory::models::retrieval::RecallQuery;
use crate::models::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DaemonResponse {
    pub status: u16,
    pub body: String,
}

/// One agent hook firing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HookEventRequest {
    pub agent_source: String,
    pub event_name: String,
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    /// The transcript to keep, when the hook has one.
    #[serde(default)]
    pub transcript_path: Option<String>,
    /// What the user just asked, used to assemble context for this turn.
    #[serde(default)]
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HookEventResponse {
    pub ok: bool,
    pub captured: bool,
    /// Why nothing was captured, when that was a decision rather than a failure.
    pub disabled_reason: Option<String>,
    /// Context to prepend to this turn. Empty unless the event asks for it.
    pub additional_context: String,
    pub warnings: Vec<String>,
}

pub fn dispatch(
    root: String,
    method: &str,
    path: &str,
    body: &str,
) -> Result<DaemonResponse, WorkspaceError> {
    let root_path = Path::new(&root);

    match (method, path) {
        ("GET", "/health") => health(&root),
        ("GET", "/memory/status") => reply(api::status(root_path)),
        ("GET", "/diagnostics") => reply(api::diagnostics()),
        ("POST", "/memory/recall") => with_body(body, |request| api::recall(root_path, request)),
        ("POST", "/memory/context") => with_body(body, |request| api::context(root_path, request)),
        ("POST", "/memory/brief") => with_body(body, |request| api::brief(root_path, request)),
        ("POST", "/memory/search") => with_body(body, api::search),
        ("POST", "/memory/add") => {
            with_body(body, |request| api::add_material(root_path, request))
        }
        ("POST", "/memory/list") => with_body(body, |filter| api::list(root_path, filter)),
        ("POST", "/memory/show") => with_body(body, |request: TargetRequest| {
            api::show(&request.drawer_id)
        }),
        ("POST", "/memory/delete") => with_body(body, |request: TargetRequest| {
            api::delete(&request.drawer_id)
        }),
        ("POST", "/memory/distill") => {
            with_body(body, |request| api::distill_conclusion(root_path, request))
        }
        ("POST", "/memory/gate") => with_body(body, |request: TargetRequest| {
            api::conclusion_gate(&request.drawer_id)
        }),
        ("POST", "/memory/adopt") => {
            with_body(body, |request| api::adopt_conclusion(root_path, request))
        }
        ("POST", "/memory/capture/import") => with_body(body, |request: ImportPathRequest| {
            api::import_path(root_path, Path::new(&request.path))
        }),
        ("POST", "/memory/export") => with_body(body, |request: BundlePathRequest| {
            api::export_bundle(root_path, Path::new(&request.path))
        }),
        ("POST", "/memory/import") => with_body(body, |request: BundlePathRequest| {
            api::import_bundle(Path::new(&request.path))
        }),
        ("POST", "/hook/events") => hook_event(root_path, body),
        _ if known_route(path) => Ok(error_response(
            405,
            "method_not_allowed",
            format!("{method} is not allowed for {path}"),
        )),
        _ => Ok(error_response(
            404,
            "not_found",
            format!("no route for {method} {path}"),
        )),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TargetRequest {
    drawer_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportPathRequest {
    path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundlePathRequest {
    path: String,
}

fn health(root: &str) -> Result<DaemonResponse, WorkspaceError> {
    let status = api::status(Path::new(root));

    match status {
        Ok(status) => json_response(
            200,
            &json!({
                "ok": true,
                "workspace": root,
                "enabled": status.enabled,
                "model_ready": status.model_ready,
                "library_writable": status.library.writable,
                "memory_status": status,
            }),
        ),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

/// Handles one hook event.
///
/// Two things can happen: a transcript is kept as material, and context is
/// handed back for the turn that is starting. Both are optional, and neither
/// failing is allowed to fail the hook — an agent whose session dies because
/// memory was unavailable would be a worse product than one with no memory.
fn hook_event(root: &Path, body: &str) -> Result<DaemonResponse, WorkspaceError> {
    let request = match serde_json::from_str::<HookEventRequest>(body) {
        Ok(request) => request,
        Err(error) => {
            return Ok(error_response(
                400,
                "invalid_json",
                format!("request body is not valid JSON: {error}"),
            ));
        }
    };

    let config = match read_workspace_config(root) {
        Ok(config) => config,
        Err(error) => return degraded(vec![error.to_string()]),
    };

    if !config.enabled {
        return hook_response(false, Some("memory is not enabled here".into()), String::new(), Vec::new());
    }

    let mut warnings = Vec::new();
    let mut captured = false;
    let mut disabled_reason = None;

    if crate::memory::capture::accepts(&config, &request.agent_source) {
        match request.transcript_path.as_deref() {
            Some(path) => match capture_transcript(root, &request, Path::new(path)) {
                Ok(stored) => captured = stored,
                Err(error) => warnings.push(error.to_string()),
            },
            None => disabled_reason = Some("the hook carried no transcript".into()),
        }
    } else {
        disabled_reason = Some(format!(
            "{} is not one of this workspace's capture sources",
            request.agent_source
        ));
    }

    let additional_context = if wants_context(&request.event_name) {
        match context_for_hook(root, &request) {
            Ok(context) => context,
            Err(error) => {
                warnings.push(error.to_string());
                String::new()
            }
        }
    } else {
        String::new()
    };

    hook_response(captured, disabled_reason, additional_context, warnings)
}

fn capture_transcript(
    root: &Path,
    request: &HookEventRequest,
    transcript: &Path,
) -> Result<bool, WorkspaceError> {
    let content = std::fs::read_to_string(transcript).map_err(|error| {
        WorkspaceError::from_io(
            "hook_transcript_unreadable",
            "failed to read the transcript the hook pointed at",
            &error,
        )
    })?;
    let wing = wing_for(root)?;
    let session_id = request
        .session_id
        .clone()
        .unwrap_or_else(|| transcript_identity(transcript));
    let config = read_workspace_config(root)?;
    let global = crate::memory::config::read_global_config()?;
    let embedder = build_embedder(&global)?;

    let written = with_library(|database| {
        record_session(
            database,
            &embedder,
            &config,
            SessionCapture {
                workspace_root: root,
                wing: &wing,
                agent: &request.agent_source,
                session_id: &session_id,
                transcript: content.clone(),
            },
        )
    })?;

    Ok(written.is_some())
}

/// Only the events that begin a turn get context; the rest would be noise.
fn wants_context(event_name: &str) -> bool {
    matches!(event_name, "SessionStart" | "UserPromptSubmit")
}

fn context_for_hook(root: &Path, request: &HookEventRequest) -> Result<String, WorkspaceError> {
    let query = request
        .prompt
        .clone()
        .filter(|prompt| !prompt.trim().is_empty())
        .unwrap_or_else(|| "current task".to_string());
    let recalled = api::recall(
        root,
        RecallQuery {
            query,
            wing: None,
            room: None,
            top_k: None,
            max_items: None,
            dao_tian_limit: None,
        },
    )?;

    if recalled.context.items.is_empty() && recalled.brief.key_facts.is_empty() {
        return Ok(String::new());
    }

    let mut rendered = String::from("## Project memory\n\n");
    for item in &recalled.context.items {
        rendered.push_str(&format!("- {}\n", item.text));
    }
    for fact in &recalled.brief.key_facts {
        rendered.push_str(&format!("- {} ({})\n", fact.text, fact.source_file));
    }

    Ok(rendered)
}

fn transcript_identity(transcript: &Path) -> String {
    transcript
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "session".to_string())
}

fn hook_response(
    captured: bool,
    disabled_reason: Option<String>,
    additional_context: String,
    warnings: Vec<String>,
) -> Result<DaemonResponse, WorkspaceError> {
    json_response(
        200,
        &HookEventResponse {
            ok: true,
            captured,
            disabled_reason,
            additional_context,
            warnings,
        },
    )
}

/// Memory is unavailable, but the hook still succeeds.
fn degraded(warnings: Vec<String>) -> Result<DaemonResponse, WorkspaceError> {
    hook_response(
        false,
        Some("memory is unavailable".into()),
        String::new(),
        warnings,
    )
}

fn reply<T: Serialize>(result: Result<T, WorkspaceError>) -> Result<DaemonResponse, WorkspaceError> {
    match result {
        Ok(value) => json_response(200, &value),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

fn with_body<T, R>(
    body: &str,
    handler: impl FnOnce(T) -> Result<R, WorkspaceError>,
) -> Result<DaemonResponse, WorkspaceError>
where
    T: serde::de::DeserializeOwned,
    R: Serialize,
{
    let request = match serde_json::from_str::<T>(body) {
        Ok(request) => request,
        Err(error) => {
            return Ok(error_response(
                400,
                "invalid_json",
                format!("request body is not valid JSON: {error}"),
            ));
        }
    };

    reply(handler(request))
}

fn known_route(path: &str) -> bool {
    matches!(
        path,
        "/health"
            | "/diagnostics"
            | "/memory/status"
            | "/memory/recall"
            | "/memory/context"
            | "/memory/brief"
            | "/memory/search"
            | "/memory/add"
            | "/memory/list"
            | "/memory/show"
            | "/memory/delete"
            | "/memory/distill"
            | "/memory/gate"
            | "/memory/adopt"
            | "/memory/capture/import"
            | "/memory/export"
            | "/memory/import"
            | "/hook/events"
    )
}

fn json_response<T: Serialize>(
    status: u16,
    value: &T,
) -> Result<DaemonResponse, WorkspaceError> {
    let body = serde_json::to_string(value).map_err(|error| {
        WorkspaceError::new(
            "serialize_failed",
            format!("failed to encode the response: {error}"),
        )
    })?;

    Ok(DaemonResponse { status, body })
}

fn workspace_error_response(error: WorkspaceError) -> DaemonResponse {
    let status = match error.error_code() {
        "memory_unavailable" | "schema_incompatible" => 503,
        "embedding_model_missing" | "embedding_dim_mismatch" => 409,
        "invalid_evidence_ref" | "invalid_evidence" | "invalid_conclusion" => 400,
        "gate_failed" => 422,
        _ => 500,
    };

    error_response(status, error.error_code(), error.to_string())
}

fn error_response(
    status: u16,
    code: &str,
    message: impl Into<String>,
) -> DaemonResponse {
    DaemonResponse {
        status,
        body: json!({ "error_code": code, "message": message.into() }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::config::testing::with_scoped_home;
    use crate::memory::config::{write_workspace_config, WorkspaceMemoryConfig};

    #[test]
    fn a_route_of_the_abandoned_model_is_not_found() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let root = workspace.path().to_string_lossy().into_owned();

            for gone in [
                "/memory/working",
                "/memory/working/set",
                "/memory/inbox/add",
                "/memory/inbox/accept",
                "/memory/index/rebuild",
                "/storage/migrate",
                "/memory/thread/save",
            ] {
                let response = dispatch(root.clone(), "POST", gone, "{}").expect("answers");
                assert_eq!(response.status, 404, "{gone} is still routed");
            }
        });
    }

    #[test]
    fn a_hook_on_a_workspace_without_memory_succeeds_and_captures_nothing() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let root = workspace.path().to_string_lossy().into_owned();

            let response = dispatch(
                root,
                "POST",
                "/hook/events",
                r#"{"agent_source":"claude","event_name":"SessionStart"}"#,
            )
            .expect("answers");

            assert_eq!(response.status, 200, "a hook must never fail a session");
            let parsed: serde_json::Value =
                serde_json::from_str(&response.body).expect("json body");
            assert_eq!(parsed["ok"], true);
            assert_eq!(parsed["captured"], false);
            assert_eq!(parsed["additional_context"], "");
        });
    }

    #[test]
    fn a_hook_from_an_unlisted_agent_says_why_it_kept_nothing() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");
            let mut config = WorkspaceMemoryConfig {
                enabled: true,
                ..WorkspaceMemoryConfig::default()
            };
            config.capture.enabled = true;
            config.capture.sources = vec!["claude".to_string()];
            write_workspace_config(workspace.path(), &config).expect("write config");
            let transcript = workspace.path().join("transcript.jsonl");
            std::fs::write(&transcript, "{\"type\":\"user\"}\n").expect("write transcript");

            let response = dispatch(
                workspace.path().to_string_lossy().into_owned(),
                "POST",
                "/hook/events",
                &format!(
                    r#"{{"agent_source":"codex","event_name":"PreCompact","transcript_path":{}}}"#,
                    serde_json::to_string(&transcript.to_string_lossy().into_owned())
                        .expect("json path")
                ),
            )
            .expect("answers");

            let parsed: serde_json::Value =
                serde_json::from_str(&response.body).expect("json body");
            assert_eq!(parsed["captured"], false);
            assert!(
                parsed["disabled_reason"]
                    .as_str()
                    .is_some_and(|reason| reason.contains("codex")),
                "{parsed}"
            );
        });
    }

    #[test]
    fn health_answers_even_when_memory_is_off() {
        with_scoped_home(|_home| {
            let workspace = tempfile::tempdir().expect("workspace");

            let response = dispatch(
                workspace.path().to_string_lossy().into_owned(),
                "GET",
                "/health",
                "",
            )
            .expect("answers");

            assert_eq!(response.status, 200);
            let parsed: serde_json::Value =
                serde_json::from_str(&response.body).expect("json body");
            assert_eq!(parsed["ok"], true);
            assert_eq!(parsed["enabled"], false);
        });
    }
}
