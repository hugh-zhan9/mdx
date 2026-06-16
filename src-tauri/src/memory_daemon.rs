use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::memory::{
    InboxAddRequest, InboxReviewRequest, MemoryAddRequest, MemoryCaptureImportRequest,
    MemoryCaptureScanRequest, MemoryDistillRequest, MemoryExportRequest, MemoryHookEventRequest,
    MemoryHookEventResponse, MemoryImportRequest, MemoryIndexSearchRequest, MemoryListFilter,
    MemoryPromoteRequest, MemoryRepairRequest, RecallRequest, ThreadListFilter, ThreadSaveRequest,
};
use crate::WorkspaceError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DaemonResponse {
    pub status: u16,
    pub body: String,
}

pub fn dispatch(
    root: String,
    method: &str,
    path: &str,
    body: &str,
) -> Result<DaemonResponse, WorkspaceError> {
    match (method, path) {
        ("GET", "/health") => health(root),
        ("GET", "/memory/status") => get_json(|| crate::memory::memory_detect_workspace(root)),
        ("POST", "/memory/repair") => post_json(body, |request: MemoryRepairRequest| {
            crate::memory::memory_repair_workspace(root, request)
        }),
        ("POST", "/memory/recall") => post_json(body, |request: RecallRequest| {
            crate::memory::memory_recall(root, request)
        }),
        ("POST", "/memory/add") => post_json(body, |request: MemoryAddRequest| {
            crate::memory::memory_add(root, request)
        }),
        ("POST", "/memory/show") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_get(root, request.target)
        }),
        ("POST", "/memory/list") => post_json(body, |request: MemoryListFilter| {
            crate::memory::memory_list(root, request)
        }),
        ("POST", "/memory/archive") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_archive(root, request.target)
        }),
        ("GET", "/memory/working") => get_json(|| crate::memory::memory_working_get(root)),
        ("POST", "/memory/working/set") => post_json(body, |request: WorkingSetRequest| {
            crate::memory::memory_working_set(root, request.markdown)
        }),
        ("POST", "/memory/working/append") => post_json(body, |request: WorkingAppendRequest| {
            crate::memory::memory_working_append(root, request.section, request.text)
        }),
        ("GET", "/memory/index/status") => get_json(|| crate::memory::memory_index_status(root)),
        ("POST", "/memory/index/rebuild") => get_json(|| crate::memory::memory_index_rebuild(root)),
        ("POST", "/memory/index/search") => post_json(body, |request: MemoryIndexSearchRequest| {
            crate::memory::memory_index_search(root, request)
        }),
        ("POST", "/memory/search") => post_json(body, |request: SearchRequest| {
            crate::memory::memory_search(
                root,
                request.query,
                request.limit,
                request.tag,
                request.since,
            )
        }),
        ("POST", "/memory/thread/save") => post_json(body, |request: ThreadSaveRequest| {
            crate::memory::memory_thread_save(root, request)
        }),
        ("POST", "/memory/thread/show") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_thread_get(root, request.target)
        }),
        ("POST", "/memory/thread/list") => post_json(body, |request: ThreadListFilter| {
            crate::memory::memory_thread_list(root, request)
        }),
        ("POST", "/memory/inbox/add") => post_json(body, |request: InboxAddRequest| {
            crate::memory::memory_inbox_add(root, request)
        }),
        ("POST", "/memory/inbox/show") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_inbox_get(root, request.target)
        }),
        ("POST", "/memory/inbox/list") => post_json(body, |request: InboxListRequest| {
            crate::memory::memory_inbox_list(root, request.include_reviewed)
        }),
        ("POST", "/memory/inbox/accept") => post_json(body, |request: InboxReviewRequest| {
            crate::memory::memory_inbox_accept(root, request)
        }),
        ("POST", "/memory/inbox/reject") => post_json(body, |request: TargetRequest| {
            crate::memory::memory_inbox_reject(root, request.target)
        }),
        ("POST", "/memory/distill") => post_json(body, |request: MemoryDistillRequest| {
            crate::memory::memory_distill(root, request)
        }),
        ("POST", "/memory/promote") => post_json(body, |request: MemoryPromoteRequest| {
            crate::memory::memory_promote(root, request)
        }),
        ("POST", "/memory/capture/import") => {
            post_json(body, |request: MemoryCaptureImportRequest| {
                crate::memory::memory_capture_import(root, request)
            })
        }
        ("POST", "/memory/capture/scan") => post_json(body, |request: MemoryCaptureScanRequest| {
            crate::memory::memory_capture_scan(root, request)
        }),
        ("POST", "/memory/export") => post_json(body, |request: MemoryExportRequest| {
            crate::memory::memory_export_bundle(root, request)
        }),
        ("POST", "/memory/import") => post_json(body, |request: MemoryImportRequest| {
            crate::memory::memory_import_bundle(root, request)
        }),
        ("POST", "/storage/migrate/dry-run") => post_json(
            body,
            |request: crate::memory::MemoryStorageMigrateRequest| {
                crate::memory_storage_migration::dry_run_storage_migration_request(&root, request)
            },
        ),
        ("POST", "/hook/events") => hook_event(root, body),
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

pub fn dispatch_for_test(
    root: String,
    method: &str,
    path: &str,
    body: &str,
) -> Result<DaemonResponse, WorkspaceError> {
    dispatch(root, method, path, body)
}

#[derive(Debug, Deserialize)]
struct TargetRequest {
    target: String,
}

#[derive(Debug, Deserialize)]
struct InboxListRequest {
    #[serde(default)]
    include_reviewed: bool,
}

#[derive(Debug, Deserialize)]
struct SearchRequest {
    query: String,
    limit: Option<usize>,
    tag: Option<String>,
    since: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkingSetRequest {
    markdown: String,
}

#[derive(Debug, Deserialize)]
struct WorkingAppendRequest {
    section: String,
    text: String,
}

fn health(root: String) -> Result<DaemonResponse, WorkspaceError> {
    match crate::memory::memory_detect_workspace(root.clone()) {
        Ok(status) => json_response(
            200,
            &json!({
                "ok": true,
                "has_memory": status.has_memory,
                "can_initialize": status.can_initialize,
                "mode": status.mode,
                "missing_paths": status.missing_paths,
                "workspace": root,
                "memory_status": status,
            }),
        ),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

fn hook_event(root: String, body: &str) -> Result<DaemonResponse, WorkspaceError> {
    let request = match serde_json::from_str::<MemoryHookEventRequest>(body) {
        Ok(request) => request,
        Err(error) => {
            return Ok(error_response(
                400,
                "invalid_json",
                format!("request body is not valid JSON: {error}"),
            ));
        }
    };

    let root_path = std::path::Path::new(&root);
    let config = match crate::memory_fs::read_memory_config(root_path) {
        Ok(config) => config,
        Err(error) => return hook_degraded_response(error),
    };
    let capture = crate::memory_config::resolve_memory_feature(
        &config,
        crate::memory_config::MemoryFeature::Capture,
        Some(&request.agent_source),
    );
    if !capture.enabled {
        let warnings = capture.reason.iter().cloned().collect::<Vec<_>>();
        return hook_response(false, capture.reason, String::new(), warnings);
    }

    let event = crate::memory_agent_events::AgentHookEvent {
        agent_source: request.agent_source,
        event_name: request.event_name,
        workspace_root: request.workspace_root,
        cwd: request.cwd,
        session_id: request.session_id,
        turn_id: request.turn_id,
        event_seq: request.event_seq,
        idempotency_key: request.idempotency_key,
        raw_payload: request.raw_payload,
        deadline_ms: request.deadline_ms,
    };

    let mut storage = match crate::memory_storage_sqlite::SqliteMemoryStorage::open_workspace(
        root_path,
    ) {
        Ok(storage) => storage,
        Err(error) => return hook_degraded_response(error),
    };
    if let Err(error) = storage.initialize() {
        return hook_degraded_response(error);
    }
    let capture_result = match crate::memory_agent_events::capture_agent_event(&mut storage, &event)
    {
        Ok(result) => result,
        Err(error) => return hook_degraded_response(error),
    };

    let mut warnings = Vec::new();
    let additional_context = if hook_event_accepts_recall_context(&event.event_name) {
        let recall_injection = crate::memory_config::resolve_memory_feature(
            &config,
            crate::memory_config::MemoryFeature::RecallInjection,
            Some(&event.agent_source),
        );
        if !recall_injection.enabled {
            if let Some(reason) = recall_injection.reason {
                warnings.push(reason);
            }
            String::new()
        } else {
            match recall_context_for_hook(
                root_path,
                &event,
                config.agent_backend.context_byte_budget,
            ) {
                Ok((context, recall_warnings)) => {
                    warnings.extend(recall_warnings);
                    context
                }
                Err(error) => {
                    warnings.push(format!("recall_failed:{}", error.error_code()));
                    String::new()
                }
            }
        }
    } else {
        String::new()
    };

    hook_response(capture_result.inserted, None, additional_context, warnings)
}

fn hook_degraded_response(error: WorkspaceError) -> Result<DaemonResponse, WorkspaceError> {
    hook_response(
        false,
        None,
        String::new(),
        vec![error.error_code().to_string()],
    )
}

fn hook_response(
    captured: bool,
    disabled_reason: Option<String>,
    additional_context: String,
    warnings: Vec<String>,
) -> Result<DaemonResponse, WorkspaceError> {
    json_response(
        200,
        &MemoryHookEventResponse {
            ok: true,
            captured,
            disabled_reason,
            additional_context,
            warnings,
        },
    )
}

fn hook_event_accepts_recall_context(event_name: &str) -> bool {
    matches!(event_name, "SessionStart" | "UserPromptSubmit")
}

fn recall_context_for_hook(
    root: &std::path::Path,
    event: &crate::memory_agent_events::AgentHookEvent,
    byte_budget: usize,
) -> Result<(String, Vec<String>), WorkspaceError> {
    let result = crate::memory_recall::memory_recall(
        root,
        RecallRequest {
            query: hook_recall_query(event),
            limit: None,
            byte_budget: Some(byte_budget),
            include_working: true,
            include_threads: false,
            thread_ids: Vec::new(),
            include_wiki_refs: false,
            include_wiki_snippets: false,
            tag: None,
            since: None,
        },
    )?;
    let context = crate::memory_recall::render_recall_context(&result);
    Ok((context, result.warnings))
}

fn hook_recall_query(event: &crate::memory_agent_events::AgentHookEvent) -> String {
    for key in ["prompt", "input", "text", "message", "content"] {
        if let Some(value) = event.raw_payload.get(key).and_then(|value| value.as_str()) {
            let value = value.trim();
            if !value.is_empty() {
                return compact_hook_query(value);
            }
        }
    }
    event
        .cwd
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| event.workspace_root.clone())
}

fn compact_hook_query(value: &str) -> String {
    let tokens = value
        .split_whitespace()
        .map(|token| {
            token
                .trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|token| !token.is_empty() && !is_hook_query_stop_word(token))
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        value.to_string()
    } else {
        tokens.join(" ")
    }
}

fn is_hook_query_stop_word(token: &str) -> bool {
    matches!(
        token,
        "a" | "an"
            | "and"
            | "are"
            | "can"
            | "could"
            | "for"
            | "please"
            | "should"
            | "the"
            | "this"
            | "to"
            | "would"
    )
}

fn get_json<R>(
    handle: impl FnOnce() -> Result<R, WorkspaceError>,
) -> Result<DaemonResponse, WorkspaceError>
where
    R: Serialize,
{
    match handle() {
        Ok(result) => json_response(200, &json!({ "ok": true, "result": result })),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

fn post_json<T, R>(
    body: &str,
    handle: impl FnOnce(T) -> Result<R, WorkspaceError>,
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

    match handle(request) {
        Ok(result) => json_response(200, &json!({ "ok": true, "result": result })),
        Err(error) => Ok(workspace_error_response(error)),
    }
}

fn known_route(path: &str) -> bool {
    matches!(
        path,
        "/health"
            | "/memory/status"
            | "/memory/repair"
            | "/memory/recall"
            | "/memory/add"
            | "/memory/show"
            | "/memory/list"
            | "/memory/archive"
            | "/memory/working"
            | "/memory/working/set"
            | "/memory/working/append"
            | "/memory/index/status"
            | "/memory/index/rebuild"
            | "/memory/index/search"
            | "/memory/search"
            | "/memory/thread/save"
            | "/memory/thread/show"
            | "/memory/thread/list"
            | "/memory/inbox/add"
            | "/memory/inbox/show"
            | "/memory/inbox/list"
            | "/memory/inbox/accept"
            | "/memory/inbox/reject"
            | "/memory/distill"
            | "/memory/promote"
            | "/memory/capture/import"
            | "/memory/capture/scan"
            | "/memory/export"
            | "/memory/import"
            | "/storage/migrate/dry-run"
            | "/hook/events"
    )
}

fn json_response(status: u16, value: &impl Serialize) -> Result<DaemonResponse, WorkspaceError> {
    serde_json::to_string(value)
        .map(|body| DaemonResponse { status, body })
        .map_err(|error| WorkspaceError::new("json_encode_failed", error.to_string()))
}

fn workspace_error_response(error: WorkspaceError) -> DaemonResponse {
    error_response(500, error.error_code(), error.to_string())
}

fn error_response(
    status: u16,
    error_code: impl AsRef<str>,
    message: impl Into<String>,
) -> DaemonResponse {
    let body = serde_json::to_string(&json!({
        "ok": false,
        "error_code": error_code.as_ref(),
        "message": message.into(),
    }))
    .unwrap_or_else(|_| "{\"ok\":false,\"error_code\":\"json_encode_failed\"}".to_string());

    DaemonResponse { status, body }
}
