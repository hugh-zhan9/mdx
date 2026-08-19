use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Window};

use crate::cli_protocol::{
    active_or_requested_tab, cli_wiki_search_results_from_models, list_response_from_snapshot,
    resolve_cli_path, run_memory_request, CliProtocolError, CliRequest, CliResponse,
    SelectionSnapshot, WorkspaceSnapshot,
};
use crate::llm_wiki;
use crate::llm_wiki_fs::detect_llm_wiki_workspace;
use crate::models::{CreateFolderResult, PathChangeResult, WorkspaceError};
use crate::workspace_fs;

#[derive(Default)]
pub struct CliState {
    windows: Mutex<HashMap<String, WindowSnapshot>>,
}

#[derive(Clone, Default)]
struct WindowSnapshot {
    workspace: WorkspaceSnapshot,
    tab_contents: HashMap<String, String>,
    tab_selections: HashMap<String, SelectionSnapshot>,
    frontend_heartbeat: Option<FrontendHeartbeat>,
    last_frontend_recovery: Option<Instant>,
}

#[derive(Clone)]
struct FrontendHeartbeat {
    payload: CliFrontendHeartbeatPayload,
    seen_at: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrontendRecoveryReason {
    MissingHeartbeat,
    MissingRoot,
    StaleHeartbeat(Duration),
}

impl FrontendRecoveryReason {
    pub fn as_log_reason(self) -> &'static str {
        match self {
            Self::MissingHeartbeat => "missing_heartbeat",
            Self::MissingRoot => "missing_root",
            Self::StaleHeartbeat(_) => "stale_heartbeat",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CliWorkspaceSyncPayload {
    pub workspace: WorkspaceSnapshot,
    #[serde(default)]
    #[serde(alias = "tabContents")]
    pub tab_contents: HashMap<String, String>,
    #[serde(default)]
    #[serde(alias = "tabSelections")]
    pub tab_selections: HashMap<String, SelectionSnapshot>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CliFrontendHeartbeatPayload {
    #[serde(default)]
    #[serde(alias = "rootPath")]
    pub root_path: Option<String>,
    #[serde(default)]
    #[serde(alias = "hasWorkspace")]
    pub has_workspace: bool,
    #[serde(default)]
    #[serde(alias = "rootPresent")]
    pub root_present: bool,
    #[serde(default)]
    #[serde(alias = "visibilityState")]
    pub visibility_state: Option<String>,
    #[serde(default)]
    #[serde(alias = "locationHref")]
    pub location_href: Option<String>,
}

pub fn start(app: AppHandle) {
    thread::spawn(move || run_server(app));
}

#[tauri::command]
pub fn cli_update_workspace_snapshot(
    window: Window,
    payload: CliWorkspaceSyncPayload,
    state: State<CliState>,
) -> Result<(), String> {
    state.update_window(
        window.label(),
        payload.workspace,
        payload.tab_contents,
        payload.tab_selections,
    );
    Ok(())
}

#[tauri::command]
pub fn cli_frontend_heartbeat(
    window: Window,
    payload: CliFrontendHeartbeatPayload,
    state: State<CliState>,
) -> Result<(), String> {
    state.update_frontend_heartbeat(window.label(), payload);
    Ok(())
}

#[tauri::command]
pub fn cli_update_tab_state(
    window: Window,
    tab_id: String,
    markdown: Option<String>,
    selection: Option<SelectionSnapshot>,
    state: State<CliState>,
) -> Result<(), String> {
    state.update_tab(window.label(), tab_id, markdown, selection);
    Ok(())
}

impl CliState {
    fn update_window(
        &self,
        label: &str,
        workspace: WorkspaceSnapshot,
        tab_contents: HashMap<String, String>,
        tab_selections: HashMap<String, SelectionSnapshot>,
    ) {
        let mut windows = self.windows.lock().unwrap();
        let previous = windows.get(label).cloned();
        let content_source = if tab_contents.is_empty() {
            previous
                .as_ref()
                .map(|snapshot| snapshot.tab_contents.clone())
                .unwrap_or_default()
        } else {
            tab_contents
        };
        let selection_source = if tab_selections.is_empty() {
            previous
                .as_ref()
                .map(|snapshot| snapshot.tab_selections.clone())
                .unwrap_or_default()
        } else {
            tab_selections
        };
        let known_tab_ids: std::collections::HashSet<String> = workspace
            .tabs
            .iter()
            .map(|tab| tab.tab_id.clone())
            .collect();

        windows.insert(
            label.to_string(),
            WindowSnapshot {
                workspace,
                tab_contents: content_source
                    .into_iter()
                    .filter(|(tab_id, _)| known_tab_ids.contains(tab_id))
                    .collect(),
                tab_selections: selection_source
                    .into_iter()
                    .filter(|(tab_id, _)| known_tab_ids.contains(tab_id))
                    .collect(),
                frontend_heartbeat: previous
                    .as_ref()
                    .and_then(|snapshot| snapshot.frontend_heartbeat.clone()),
                last_frontend_recovery: previous
                    .as_ref()
                    .and_then(|snapshot| snapshot.last_frontend_recovery),
            },
        );
    }

    fn update_tab(
        &self,
        label: &str,
        tab_id: String,
        markdown: Option<String>,
        selection: Option<SelectionSnapshot>,
    ) {
        let mut windows = self.windows.lock().unwrap();
        let snapshot = windows.entry(label.to_string()).or_default();

        if let Some(markdown) = markdown {
            snapshot.tab_contents.insert(tab_id.clone(), markdown);
        }

        if let Some(selection) = selection {
            snapshot.tab_selections.insert(tab_id, selection);
        }

        let known_tab_ids: std::collections::HashSet<String> = snapshot
            .workspace
            .tabs
            .iter()
            .map(|tab| tab.tab_id.clone())
            .collect();
        if !known_tab_ids.is_empty() {
            snapshot
                .tab_contents
                .retain(|tab_id, _| known_tab_ids.contains(tab_id));
            snapshot
                .tab_selections
                .retain(|tab_id, _| known_tab_ids.contains(tab_id));
        }
    }

    fn update_frontend_heartbeat(&self, label: &str, payload: CliFrontendHeartbeatPayload) {
        self.update_frontend_heartbeat_at(label, payload, Instant::now());
    }

    fn update_frontend_heartbeat_at(
        &self,
        label: &str,
        payload: CliFrontendHeartbeatPayload,
        seen_at: Instant,
    ) {
        let mut windows = self.windows.lock().unwrap();
        let snapshot = windows.entry(label.to_string()).or_default();
        snapshot.frontend_heartbeat = Some(FrontendHeartbeat { payload, seen_at });
    }

    pub fn reserve_frontend_recovery(
        &self,
        label: &str,
        max_heartbeat_age: Duration,
        min_recovery_interval: Duration,
    ) -> Option<FrontendRecoveryReason> {
        let mut windows = self.windows.lock().unwrap();
        let snapshot = windows.get_mut(label)?;
        let _root_path = snapshot.workspace.root_path.as_ref()?;
        if snapshot.workspace.tabs.iter().any(|tab| tab.dirty) {
            return None;
        }
        let now = Instant::now();

        if snapshot
            .last_frontend_recovery
            .is_some_and(|last| now.duration_since(last) < min_recovery_interval)
        {
            return None;
        }

        let reason = match snapshot.frontend_heartbeat.as_ref() {
            None => FrontendRecoveryReason::MissingHeartbeat,
            Some(heartbeat) if !heartbeat.payload.root_present => {
                FrontendRecoveryReason::MissingRoot
            }
            Some(heartbeat) => {
                let age = now.duration_since(heartbeat.seen_at);
                if age <= max_heartbeat_age {
                    return None;
                }
                FrontendRecoveryReason::StaleHeartbeat(age)
            }
        };

        snapshot.last_frontend_recovery = Some(now);
        Some(reason)
    }

    fn snapshot_for_label(&self, label: &str) -> Option<WindowSnapshot> {
        self.windows.lock().unwrap().get(label).cloned()
    }
}

fn run_server(app: AppHandle) {
    let Some(path) = socket_path() else {
        eprintln!("[cli] unable to resolve socket path");
        return;
    };

    let _ = fs::remove_file(&path);

    let listener = match UnixListener::bind(&path) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("[cli] failed to bind {}: {error}", path.display());
            return;
        }
    };

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if let Ok(metadata) = fs::metadata(&path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o600);
            let _ = fs::set_permissions(&path, permissions);
        }
    }

    eprintln!("[cli] listening on {}", path.display());

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let app = app.clone();
                thread::spawn(move || {
                    if let Err(error) = handle_client(stream, &app) {
                        eprintln!("[cli] client error: {error}");
                    }
                });
            }
            Err(error) => {
                eprintln!("[cli] accept failed: {error}");
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

fn handle_client(stream: UnixStream, app: &AppHandle) -> std::io::Result<()> {
    let reader = stream.try_clone()?;
    let mut reader = BufReader::new(reader);
    let mut writer = stream;
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            return Ok(());
        }

        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<CliRequest>(line.trim()) {
            Ok(request) => dispatch(app, request),
            Err(error) => CliResponse::error("parse_error", error.to_string()),
        };

        let mut json = serde_json::to_vec(&response).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
        json.push(b'\n');
        writer.write_all(&json)?;
        writer.flush()?;
    }
}

fn dispatch(app: &AppHandle, request: CliRequest) -> CliResponse {
    match request {
        CliRequest::New => handle_new(app),
        CliRequest::Open { path } => handle_open(app, path),
        CliRequest::List => handle_list(app),
        CliRequest::Content { tab_id } => handle_content(app, tab_id),
        CliRequest::Selection { tab_id } => handle_selection(app, tab_id),
        CliRequest::Insert { tab_id, text } => handle_insert(app, tab_id, text),
        CliRequest::Save { tab_id } => handle_save(app, tab_id),
        CliRequest::Focus { tab_id } => handle_focus(app, tab_id),
        CliRequest::Close { tab_id, force } => handle_close(app, tab_id, force.unwrap_or(false)),
        CliRequest::CreateFile { parent_dir, name } => handle_create_file(app, parent_dir, name),
        CliRequest::CreateFolder { parent_dir, name } => {
            handle_create_folder(app, parent_dir, name)
        }
        CliRequest::Rename { path, new_name } => handle_rename(app, path, new_name),
        CliRequest::LlmWikiQuery { question } => handle_llm_wiki_query(app, question),
        CliRequest::LlmWikiSearch { query } => handle_llm_wiki_search(app, query),
        CliRequest::LlmWikiStatus => handle_llm_wiki_status(app),
        CliRequest::LlmWikiIngest { raw_path } => handle_llm_wiki_ingest(app, raw_path),
        CliRequest::LlmWikiDigest { title, prompt } => handle_llm_wiki_digest(app, title, prompt),
        CliRequest::LlmWikiLint => handle_llm_wiki_lint(app),
        // Every memory command runs the same way: find the workspace this
        // window has open, then hand the request to the one executor the
        // headless CLI uses too.
        request @ (CliRequest::MemoryStatus
        | CliRequest::MemoryInit
        | CliRequest::MemoryModel { .. }
        | CliRequest::MemoryReindex
        | CliRequest::MemoryPurge { .. }
        | CliRequest::MemoryAdd { .. }
        | CliRequest::MemoryShow { .. }
        | CliRequest::MemoryList { .. }
        | CliRequest::MemoryDelete { .. }
        | CliRequest::MemorySearch { .. }
        | CliRequest::MemoryContext { .. }
        | CliRequest::MemoryBrief { .. }
        | CliRequest::MemoryRecall { .. }
        | CliRequest::MemoryDistill { .. }
        | CliRequest::MemoryGate { .. }
        | CliRequest::MemoryAdopt { .. }
        | CliRequest::MemoryDemote { .. }
        | CliRequest::MemoryPromote { .. }
        | CliRequest::MemoryCaptureScan { .. }
        | CliRequest::MemoryCaptureImport { .. }
        | CliRequest::MemoryLegacyImport { .. }
        | CliRequest::MemoryExport { .. }
        | CliRequest::MemoryImport { .. }) => handle_memory(app, request),
    }
}

fn handle_new(app: &AppHandle) -> CliResponse {
    if let Some(label) = focused_or_first_window_label(app) {
        focus_window(app, &label);
        return CliResponse {
            ok: true,
            window_id: Some(label),
            ..CliResponse::default()
        };
    }

    match crate::new_workspace_window(app) {
        Ok(label) => CliResponse {
            ok: true,
            window_id: Some(label),
            ..CliResponse::default()
        },
        Err(error) => CliResponse::error("window_failed", error.to_string()),
    }
}

fn handle_list(app: &AppHandle) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::ok();
    };

    let response = list_response_from_snapshot(&snapshot.workspace);
    CliResponse {
        window_id: Some(label),
        ..response
    }
}

fn handle_content(app: &AppHandle, tab_id: Option<String>) -> CliResponse {
    let Some((_, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Ok(tab) = active_or_requested_tab(&snapshot.workspace, tab_id.as_deref()) else {
        return CliResponse::error("tab_not_found", "tab was not found");
    };

    let content = if let Some(content) = snapshot.tab_contents.get(&tab.tab_id).cloned() {
        content
    } else if let Some(root_path) = snapshot.workspace.root_path.clone() {
        match workspace_fs::read_markdown_file(root_path, tab.path.clone()) {
            Ok(content) => content,
            Err(error) => return workspace_error(error),
        }
    } else {
        return CliResponse::error("content_unavailable", "tab content has not been synced yet");
    };

    CliResponse {
        ok: true,
        tab_id: Some(tab.tab_id.clone()),
        content: Some(content),
        ..CliResponse::default()
    }
}

fn handle_selection(app: &AppHandle, tab_id: Option<String>) -> CliResponse {
    let Some((_, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Ok(tab) = active_or_requested_tab(&snapshot.workspace, tab_id.as_deref()) else {
        return CliResponse::error("tab_not_found", "tab was not found");
    };

    let selection = snapshot
        .tab_selections
        .get(&tab.tab_id)
        .cloned()
        .unwrap_or_default();

    CliResponse {
        ok: true,
        tab_id: Some(tab.tab_id.clone()),
        selection: Some(selection),
        ..CliResponse::default()
    }
}

fn handle_insert(app: &AppHandle, tab_id: Option<String>, text: String) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Ok(tab) = active_or_requested_tab(&snapshot.workspace, tab_id.as_deref()) else {
        return CliResponse::error("tab_not_found", "tab was not found");
    };

    if snapshot.workspace.active_tab_id.as_deref() != Some(&tab.tab_id) {
        if emit_to_window(
            app,
            &label,
            "cli-focus-tab",
            &CliTabPayload {
                tab_id: Some(tab.tab_id.clone()),
            },
        )
        .is_err()
        {
            return CliResponse::error("emit_failed", "failed to emit focus command");
        }

        if !wait_for_active_tab(app, &label, &tab.tab_id, Duration::from_secs(2)) {
            return CliResponse::error(
                "tab_not_active",
                "tab did not become active in time for insert",
            );
        }
    }

    if emit_to_window(
        app,
        &label,
        "cli-insert",
        &CliInsertPayload {
            tab_id: Some(tab.tab_id.clone()),
            text,
        },
    )
    .is_err()
    {
        return CliResponse::error("emit_failed", "failed to emit insert command");
    }

    CliResponse {
        ok: true,
        tab_id: Some(tab.tab_id.clone()),
        ..CliResponse::default()
    }
}

fn handle_save(app: &AppHandle, tab_id: Option<String>) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Ok(tab) = active_or_requested_tab(&snapshot.workspace, tab_id.as_deref()) else {
        return CliResponse::error("tab_not_found", "tab was not found");
    };

    if emit_to_window(
        app,
        &label,
        "cli-save-tab",
        &CliTabPayload {
            tab_id: Some(tab.tab_id.clone()),
        },
    )
    .is_err()
    {
        return CliResponse::error("emit_failed", "failed to emit save command");
    }

    CliResponse {
        ok: true,
        tab_id: Some(tab.tab_id.clone()),
        ..CliResponse::default()
    }
}

fn handle_focus(app: &AppHandle, tab_id: Option<String>) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Ok(tab) = active_or_requested_tab(&snapshot.workspace, tab_id.as_deref()) else {
        return CliResponse::error("tab_not_found", "tab was not found");
    };

    if emit_to_window(
        app,
        &label,
        "cli-focus-tab",
        &CliTabPayload {
            tab_id: Some(tab.tab_id.clone()),
        },
    )
    .is_err()
    {
        return CliResponse::error("emit_failed", "failed to emit focus command");
    }

    let _ = wait_for_active_tab(app, &label, &tab.tab_id, Duration::from_secs(2));

    CliResponse {
        ok: true,
        tab_id: Some(tab.tab_id.clone()),
        ..CliResponse::default()
    }
}

fn handle_close(app: &AppHandle, tab_id: Option<String>, force: bool) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Ok(tab) = active_or_requested_tab(&snapshot.workspace, tab_id.as_deref()) else {
        return CliResponse::error("tab_not_found", "tab was not found");
    };

    if !force && tab.dirty {
        return CliResponse::error(
            "dirty_tab",
            "tab has unsaved changes; pass --force to close",
        );
    }

    if emit_to_window(
        app,
        &label,
        "cli-close-tab",
        &CliClosePayload {
            tab_id: Some(tab.tab_id.clone()),
            force,
        },
    )
    .is_err()
    {
        return CliResponse::error("emit_failed", "failed to emit close command");
    }

    CliResponse {
        ok: true,
        tab_id: Some(tab.tab_id.clone()),
        ..CliResponse::default()
    }
}

fn handle_open(app: &AppHandle, path: String) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Some(root_path) = snapshot.workspace.root_path.clone() else {
        return CliResponse::error("no_workspace", "no workspace root is available");
    };

    let path = match resolve_cli_path(&snapshot.workspace, &path) {
        Ok(path) => path,
        Err(error) => return error_response(error),
    };

    if let Err(error) = workspace_fs::read_markdown_file(root_path, path.clone()) {
        return workspace_error(error);
    }

    if emit_to_window(
        app,
        &label,
        "cli-open-file",
        &CliOpenPayload { path: path.clone() },
    )
    .is_err()
    {
        return CliResponse::error("emit_failed", "failed to emit open command");
    }

    CliResponse {
        ok: true,
        path: Some(path),
        ..CliResponse::default()
    }
}

fn handle_create_file(
    app: &AppHandle,
    parent_dir: Option<String>,
    name: Option<String>,
) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Some(root_path) = snapshot.workspace.root_path.clone() else {
        return CliResponse::error("no_workspace", "no workspace root is available");
    };

    let parent_dir = parent_dir.unwrap_or_else(|| root_path.clone());
    let parent_dir = match resolve_cli_path(&snapshot.workspace, &parent_dir) {
        Ok(path) => path,
        Err(error) => return error_response(error),
    };
    let temporary_untitled = name
        .as_deref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    let create_result = match workspace_fs::create_markdown_file(
        root_path,
        parent_dir,
        name,
        Some(temporary_untitled),
    ) {
        Ok(result) => result,
        Err(error) => return workspace_error(error),
    };

    if emit_to_window(app, &label, "cli-file-created", &create_result).is_err() {
        return CliResponse::error("emit_failed", "failed to emit create-file command");
    }

    CliResponse {
        ok: true,
        path: Some(create_result.path),
        name: Some(create_result.name),
        needs_rename_on_first_save: Some(create_result.needs_rename_on_first_save),
        ..CliResponse::default()
    }
}

fn handle_create_folder(
    app: &AppHandle,
    parent_dir: Option<String>,
    name: Option<String>,
) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Some(root_path) = snapshot.workspace.root_path.clone() else {
        return CliResponse::error("no_workspace", "no workspace root is available");
    };

    let parent_dir = parent_dir.unwrap_or_else(|| root_path.clone());
    let parent_dir = match resolve_cli_path(&snapshot.workspace, &parent_dir) {
        Ok(path) => path,
        Err(error) => return error_response(error),
    };
    let Some(name) = name else {
        return CliResponse::error("invalid_name", "folder name is required");
    };

    let create_result: CreateFolderResult =
        match workspace_fs::create_folder(root_path, parent_dir, name) {
            Ok(result) => result,
            Err(error) => return workspace_error(error),
        };

    if emit_to_window(app, &label, "cli-folder-created", &create_result).is_err() {
        return CliResponse::error("emit_failed", "failed to emit create-folder command");
    }

    CliResponse {
        ok: true,
        path: Some(create_result.path),
        name: Some(create_result.name),
        ..CliResponse::default()
    }
}

fn handle_rename(app: &AppHandle, path: Option<String>, new_name: String) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    let Some(root_path) = snapshot.workspace.root_path.clone() else {
        return CliResponse::error("no_workspace", "no workspace root is available");
    };

    let path = match path {
        Some(path) => match resolve_cli_path(&snapshot.workspace, &path) {
            Ok(path) => path,
            Err(error) => return error_response(error),
        },
        None => return CliResponse::error("invalid_path", "path is required"),
    };

    let rename_result: PathChangeResult =
        match workspace_fs::rename_path(root_path, path.clone(), new_name.clone()) {
            Ok(result) => result,
            Err(error) => return workspace_error(error),
        };

    if emit_to_window(app, &label, "cli-path-renamed", &rename_result).is_err() {
        return CliResponse::error("emit_failed", "failed to emit rename command");
    }

    CliResponse {
        ok: true,
        old_path: Some(rename_result.old_path),
        new_path: Some(rename_result.new_path),
        ..CliResponse::default()
    }
}

fn handle_llm_wiki_query(app: &AppHandle, question: String) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };
    let response = llm_wiki_query_response_for_root(root_path.clone(), question);
    if response.ok {
        emit_log_file_updated(app, &label, &root_path);
    }
    response
}

fn handle_llm_wiki_search(app: &AppHandle, query: String) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };
    let response = llm_wiki_search_response_for_root(root_path.clone(), query);
    if response.ok {
        emit_log_file_updated(app, &label, &root_path);
    }
    response
}

fn handle_llm_wiki_status(app: &AppHandle) -> CliResponse {
    let Some((_, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };

    llm_wiki_status_response_for_root(root_path)
}

fn handle_llm_wiki_ingest(app: &AppHandle, raw_path: String) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };
    let response = llm_wiki_ingest_response_for_root(root_path.clone(), raw_path);
    if response.ok {
        emit_log_file_updated(app, &label, &root_path);
    }
    response
}

fn handle_llm_wiki_digest(app: &AppHandle, title: String, prompt: String) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };
    let response = llm_wiki_digest_response_for_root(root_path.clone(), title, prompt);
    if response.ok {
        emit_log_file_updated(app, &label, &root_path);
    }
    response
}

fn handle_llm_wiki_lint(app: &AppHandle) -> CliResponse {
    let Some((label, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };
    let root_path = match llm_wiki_active_root(&snapshot) {
        Ok(root_path) => root_path,
        Err(response) => return response,
    };
    let result = llm_wiki_lint_response_for_root_with_log_status(root_path.clone());
    if result.log_updated {
        emit_log_file_updated(app, &label, &root_path);
    }
    result.response
}

fn handle_memory(app: &AppHandle, request: CliRequest) -> CliResponse {
    let Some((_, snapshot)) = current_snapshot(app) else {
        return CliResponse::error("no_workspace", "no workspace snapshot is available");
    };

    match memory_active_root(&snapshot) {
        Ok(root_path) => run_memory_request(Path::new(&root_path), request),
        Err(response) => response,
    }
}

fn memory_active_root(snapshot: &WindowSnapshot) -> Result<String, CliResponse> {
    snapshot
        .workspace
        .root_path
        .clone()
        .ok_or_else(|| CliResponse::error("no_workspace", "no workspace root is available"))
}

fn llm_wiki_active_root(snapshot: &WindowSnapshot) -> Result<String, CliResponse> {
    snapshot
        .workspace
        .root_path
        .clone()
        .ok_or_else(|| CliResponse::error("no_workspace", "no workspace root is available"))
}

fn ensure_llm_wiki_ready(root_path: &str) -> Result<(), CliResponse> {
    match detect_llm_wiki_workspace(root_path) {
        Ok(status) if status.has_llm_wiki => Ok(()),
        Ok(_) => Err(CliResponse::error(
            "llm_wiki_not_ready",
            "current workspace is not an LLM Wiki workspace",
        )),
        Err(error) => Err(workspace_error(error)),
    }
}

fn llm_wiki_status_response_for_root(root_path: String) -> CliResponse {
    match detect_llm_wiki_workspace(&root_path) {
        Ok(status) => CliResponse {
            ok: true,
            root_path: Some(root_path),
            llm_wiki_mode: Some(status.mode),
            has_llm_wiki: Some(status.has_llm_wiki),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}

fn llm_wiki_ingest_response_for_root(root_path: String, raw_path: String) -> CliResponse {
    if let Err(response) = ensure_llm_wiki_ready(&root_path) {
        return response;
    }

    match llm_wiki::llm_wiki_ingest_raw_file_sync(root_path, raw_path) {
        Ok(()) => CliResponse::ok(),
        Err(error) => workspace_error(error),
    }
}

fn llm_wiki_digest_response_for_root(
    root_path: String,
    title: String,
    prompt: String,
) -> CliResponse {
    if let Err(response) = ensure_llm_wiki_ready(&root_path) {
        return response;
    }
    let title = match required_cli_text(title, "title", "invalid_title") {
        Ok(title) => title,
        Err(response) => return response,
    };
    let prompt = match required_cli_text(prompt, "prompt", "invalid_prompt") {
        Ok(prompt) => prompt,
        Err(response) => return response,
    };

    match llm_wiki::llm_wiki_digest_sync(root_path, title, prompt) {
        Ok(digest_path) => CliResponse {
            ok: true,
            digest_path: Some(digest_path),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}

fn required_cli_text(
    value: String,
    noun: &str,
    error_code: &'static str,
) -> Result<String, CliResponse> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(CliResponse::error(
            error_code,
            format!("{noun} must not be empty"),
        ));
    }
    Ok(value)
}

#[cfg(test)]
fn llm_wiki_lint_response_for_root(root_path: String) -> CliResponse {
    llm_wiki_lint_response_for_root_with_log_status(root_path).response
}

struct LlmWikiLintCliResult {
    response: CliResponse,
    log_updated: bool,
}

fn llm_wiki_lint_response_for_root_with_log_status(root_path: String) -> LlmWikiLintCliResult {
    if let Err(response) = ensure_llm_wiki_ready(&root_path) {
        return LlmWikiLintCliResult {
            response,
            log_updated: false,
        };
    }

    let before = log_file_fingerprint(&root_path);
    // The command is async now, so the socket handler calls the synchronous body it
    // wraps: this side is already on its own thread and has no window to block.
    match llm_wiki::llm_wiki_lint_with_operation(root_path.clone(), None) {
        Ok(lint_report) => LlmWikiLintCliResult {
            response: CliResponse {
                ok: true,
                lint_report: Some(lint_report),
                ..CliResponse::default()
            },
            log_updated: before != log_file_fingerprint(&root_path),
        },
        Err(error) => LlmWikiLintCliResult {
            response: workspace_error(error),
            log_updated: false,
        },
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LogFileFingerprint {
    bytes: Vec<u8>,
}

fn log_file_fingerprint(root_path: &str) -> Option<LogFileFingerprint> {
    let bytes = fs::read(PathBuf::from(root_path).join("log.md")).ok()?;
    Some(LogFileFingerprint { bytes })
}

fn llm_wiki_search_response_for_root(root_path: String, query: String) -> CliResponse {
    if query.trim().is_empty() {
        return CliResponse::error("invalid_query", "query must not be empty");
    }

    if let Err(response) = ensure_llm_wiki_ready(&root_path) {
        return response;
    }

    match llm_wiki::llm_wiki_search(root_path, query) {
        Ok(results) => CliResponse {
            ok: true,
            results: Some(cli_wiki_search_results_from_models(results)),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}

fn llm_wiki_query_response_for_root(root_path: String, question: String) -> CliResponse {
    if question.trim().is_empty() {
        return CliResponse::error("invalid_question", "question must not be empty");
    }

    if let Err(response) = ensure_llm_wiki_ready(&root_path) {
        return response;
    }

    match llm_wiki::llm_wiki_query_sync(root_path, question) {
        Ok(result) => CliResponse {
            ok: true,
            answer: Some(result.answer),
            references: Some(cli_wiki_search_results_from_models(result.references)),
            insufficient_context: Some(result.insufficient_context),
            ..CliResponse::default()
        },
        Err(error) => workspace_error(error),
    }
}

fn current_snapshot(app: &AppHandle) -> Option<(String, WindowSnapshot)> {
    let state = app.state::<CliState>();

    let focused_label = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label);

    if let Some(label) = focused_label {
        if let Some(snapshot) = state.snapshot_for_label(&label) {
            return Some((label, snapshot));
        }
    }

    app.webview_windows().into_iter().find_map(|(label, _)| {
        state
            .snapshot_for_label(&label)
            .map(|snapshot| (label, snapshot))
    })
}

fn wait_for_active_tab(app: &AppHandle, label: &str, tab_id: &str, timeout: Duration) -> bool {
    let start = Instant::now();

    while start.elapsed() < timeout {
        if let Some(snapshot) = app.state::<CliState>().snapshot_for_label(label) {
            if snapshot.workspace.active_tab_id.as_deref() == Some(tab_id) {
                return true;
            }
        }

        thread::sleep(Duration::from_millis(20));
    }

    app.state::<CliState>()
        .snapshot_for_label(label)
        .map(|snapshot| snapshot.workspace.active_tab_id.as_deref() == Some(tab_id))
        .unwrap_or(false)
}

fn emit_to_window<T: Serialize>(
    app: &AppHandle,
    label: &str,
    event: &str,
    payload: &T,
) -> Result<(), String> {
    app.emit_to(label, event, payload)
        .map_err(|error| error.to_string())
}

fn emit_log_file_updated(app: &AppHandle, label: &str, root_path: &str) {
    let payload = CliFileUpdatedPayload {
        path: PathBuf::from(root_path)
            .join("log.md")
            .to_string_lossy()
            .into_owned(),
    };
    let _ = emit_to_window(app, label, "cli-file-updated", &payload);
}

fn error_response(error: CliProtocolError) -> CliResponse {
    CliResponse::error(error.error_code(), error.to_string())
}

fn socket_path() -> Option<PathBuf> {
    let home = env::var_os("HOME")?;
    let dir = PathBuf::from(home).join(".loam");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("cli.sock"))
}

fn workspace_error(error: WorkspaceError) -> CliResponse {
    CliResponse::error(error.error_code(), error.to_string())
}

fn focused_or_first_window_label(app: &AppHandle) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
        .or_else(|| {
            app.webview_windows()
                .into_iter()
                .next()
                .map(|(label, _)| label)
        })
}

fn focus_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliTabPayload {
    tab_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliInsertPayload {
    tab_id: Option<String>,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliClosePayload {
    tab_id: Option<String>,
    force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliOpenPayload {
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliFileUpdatedPayload {
    path: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli_protocol::WorkspaceSnapshot;
    use crate::llm_wiki_fs::initialize_llm_wiki_workspace;
    use std::ffi::OsString;
    use std::sync::MutexGuard;
    use tempfile::TempDir;

    struct LlmConfigEnvGuard {
        _lock: MutexGuard<'static, ()>,
        home: Option<OsString>,
        userprofile: Option<OsString>,
    }

    impl LlmConfigEnvGuard {
        fn use_home(path: impl AsRef<std::path::Path>) -> Self {
            let lock = crate::llm_wiki_llm::test_llm_config_env_lock()
                .lock()
                .unwrap();
            let home = std::env::var_os("HOME");
            let userprofile = std::env::var_os("USERPROFILE");
            std::env::set_var("HOME", path.as_ref());
            std::env::remove_var("USERPROFILE");
            Self {
                _lock: lock,
                home,
                userprofile,
            }
        }
    }

    impl Drop for LlmConfigEnvGuard {
        fn drop(&mut self) {
            if let Some(value) = self.home.as_ref() {
                std::env::set_var("HOME", value);
            } else {
                std::env::remove_var("HOME");
            }
            if let Some(value) = self.userprofile.as_ref() {
                std::env::set_var("USERPROFILE", value);
            } else {
                std::env::remove_var("USERPROFILE");
            }
        }
    }

    #[test]
    fn llm_wiki_search_response_rejects_ordinary_workspace() {
        let root = TempDir::new().unwrap();

        let response = llm_wiki_search_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "raw".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("llm_wiki_not_ready"));
    }

    #[test]
    fn llm_wiki_search_response_rejects_blank_query() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_search_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "   ".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("invalid_query"));
        assert_eq!(response.error.as_deref(), Some("query must not be empty"));
    }

    #[test]
    fn llm_wiki_search_response_returns_empty_results() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_search_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "missing".to_string(),
        );

        assert!(response.ok);
        assert_eq!(response.results, Some(Vec::new()));
    }

    #[test]
    fn llm_wiki_status_response_reports_workspace_mode() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();
        let root_path = root.path().to_string_lossy().into_owned();

        let response = llm_wiki_status_response_for_root(root_path.clone());

        assert!(response.ok);
        assert_eq!(response.root_path.as_deref(), Some(root_path.as_str()));
        assert_eq!(response.llm_wiki_mode.as_deref(), Some("llmWiki"));
        assert_eq!(response.has_llm_wiki, Some(true));
    }

    #[test]
    fn llm_wiki_status_response_reports_ordinary_workspace() {
        let root = TempDir::new().unwrap();
        let root_path = root.path().to_string_lossy().into_owned();

        let response = llm_wiki_status_response_for_root(root_path.clone());

        assert!(response.ok);
        assert_eq!(response.root_path.as_deref(), Some(root_path.as_str()));
        assert_eq!(response.llm_wiki_mode.as_deref(), Some("ordinary"));
        assert_eq!(response.has_llm_wiki, Some(false));
    }

    /// A memory command over the socket runs against whichever workspace the
    /// window has open, so a window without one is refused before the library
    /// is touched.
    #[test]
    fn memory_commands_require_an_open_workspace() {
        let snapshot = WindowSnapshot::default();

        let response = memory_active_root(&snapshot).unwrap_err();

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("no_workspace"));
    }

    #[test]
    fn memory_commands_run_against_the_open_workspace() {
        let snapshot = WindowSnapshot {
            workspace: workspace_snapshot("/tmp/ws"),
            ..WindowSnapshot::default()
        };

        assert_eq!(memory_active_root(&snapshot).unwrap(), "/tmp/ws");
    }

    #[test]
    fn llm_wiki_ingest_response_rejects_ordinary_workspace() {
        let root = TempDir::new().unwrap();

        let response = llm_wiki_ingest_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "raw/notes/a.md".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("llm_wiki_not_ready"));
    }

    #[test]
    fn llm_wiki_digest_response_rejects_ordinary_workspace() {
        let root = TempDir::new().unwrap();

        let response = llm_wiki_digest_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "karpathy-llm-wiki".to_string(),
            "Summarize".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("llm_wiki_not_ready"));
    }

    #[test]
    fn llm_wiki_digest_response_rejects_blank_title() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_digest_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "   ".to_string(),
            "Summarize".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("invalid_title"));
        assert_eq!(response.error.as_deref(), Some("title must not be empty"));
    }

    #[test]
    fn llm_wiki_digest_response_rejects_blank_prompt() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_digest_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "karpathy-llm-wiki".to_string(),
            "   ".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("invalid_prompt"));
        assert_eq!(response.error.as_deref(), Some("prompt must not be empty"));
    }

    #[test]
    fn llm_wiki_lint_response_rejects_ordinary_workspace() {
        let root = TempDir::new().unwrap();

        let response = llm_wiki_lint_response_for_root(root.path().to_string_lossy().into_owned());

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("llm_wiki_not_ready"));
    }

    #[test]
    fn lint_no_config_response_reports_log_update_from_file_state() {
        let root = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        let _env_guard = LlmConfigEnvGuard::use_home(home.path().canonicalize().unwrap());
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let result = llm_wiki_lint_response_for_root_with_log_status(
            root.path().to_string_lossy().into_owned(),
        );

        assert!(result.response.ok);
        assert!(result.log_updated);
    }

    #[test]
    fn llm_wiki_query_response_rejects_blank_question() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_query_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "   ".to_string(),
        );

        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("invalid_question"));
        assert_eq!(
            response.error.as_deref(),
            Some("question must not be empty")
        );
    }

    #[test]
    fn llm_wiki_query_response_returns_insufficient_context_without_llm_config() {
        let root = TempDir::new().unwrap();
        initialize_llm_wiki_workspace(root.path()).unwrap();

        let response = llm_wiki_query_response_for_root(
            root.path().to_string_lossy().into_owned(),
            "missing".to_string(),
        );

        assert!(response.ok);
        assert_eq!(
            response.answer.as_deref(),
            Some("当前知识库中没有足够上下文回答这个问题。")
        );
        assert_eq!(response.insufficient_context, Some(true));
    }

    #[test]
    fn llm_wiki_active_root_requires_workspace_root() {
        let snapshot = WindowSnapshot {
            workspace: WorkspaceSnapshot::default(),
            tab_contents: HashMap::new(),
            tab_selections: HashMap::new(),
            frontend_heartbeat: None,
            last_frontend_recovery: None,
        };

        let response = llm_wiki_active_root(&snapshot).unwrap_err();
        assert!(!response.ok);
        assert_eq!(response.error_code.as_deref(), Some("no_workspace"));
    }

    #[test]
    fn frontend_recovery_is_reserved_when_workspace_heartbeat_is_missing() {
        let state = CliState::default();
        state.update_window(
            "workspace",
            workspace_snapshot("/tmp/wiki"),
            HashMap::new(),
            HashMap::new(),
        );

        assert_eq!(
            state.reserve_frontend_recovery(
                "workspace",
                Duration::from_secs(20),
                Duration::from_secs(60),
            ),
            Some(FrontendRecoveryReason::MissingHeartbeat),
        );
        assert_eq!(
            state.reserve_frontend_recovery(
                "workspace",
                Duration::from_secs(20),
                Duration::from_secs(60),
            ),
            None,
        );
    }

    #[test]
    fn frontend_recovery_is_reserved_when_heartbeat_is_stale() {
        let state = CliState::default();
        state.update_window(
            "workspace",
            workspace_snapshot("/tmp/wiki"),
            HashMap::new(),
            HashMap::new(),
        );
        state.update_frontend_heartbeat_at(
            "workspace",
            CliFrontendHeartbeatPayload {
                root_path: Some("/tmp/wiki".to_string()),
                has_workspace: true,
                root_present: true,
                visibility_state: Some("visible".to_string()),
                location_href: Some("tauri://localhost".to_string()),
            },
            Instant::now() - Duration::from_secs(45),
        );

        let reason = state
            .reserve_frontend_recovery(
                "workspace",
                Duration::from_secs(20),
                Duration::from_secs(60),
            )
            .unwrap();

        assert!(matches!(
            reason,
            FrontendRecoveryReason::StaleHeartbeat(age) if age >= Duration::from_secs(45)
        ));
    }

    #[test]
    fn frontend_recovery_is_not_reserved_for_fresh_heartbeat_or_empty_workspace() {
        let state = CliState::default();
        state.update_window(
            "workspace",
            workspace_snapshot("/tmp/wiki"),
            HashMap::new(),
            HashMap::new(),
        );
        state.update_frontend_heartbeat_at(
            "workspace",
            CliFrontendHeartbeatPayload {
                root_path: Some("/tmp/wiki".to_string()),
                has_workspace: true,
                root_present: true,
                visibility_state: Some("visible".to_string()),
                location_href: Some("tauri://localhost".to_string()),
            },
            Instant::now(),
        );
        state.update_window(
            "empty",
            WorkspaceSnapshot::default(),
            HashMap::new(),
            HashMap::new(),
        );

        assert_eq!(
            state.reserve_frontend_recovery(
                "workspace",
                Duration::from_secs(20),
                Duration::from_secs(60),
            ),
            None,
        );
        assert_eq!(
            state.reserve_frontend_recovery(
                "empty",
                Duration::from_secs(20),
                Duration::from_secs(60),
            ),
            None,
        );
    }

    #[test]
    fn frontend_recovery_is_not_reserved_when_workspace_has_dirty_tabs() {
        let state = CliState::default();
        state.update_window(
            "workspace",
            dirty_workspace_snapshot("/tmp/wiki"),
            HashMap::new(),
            HashMap::new(),
        );

        assert_eq!(
            state.reserve_frontend_recovery(
                "workspace",
                Duration::from_secs(20),
                Duration::from_secs(60),
            ),
            None,
        );
    }

    fn workspace_snapshot(root_path: &str) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            root_path: Some(root_path.to_string()),
            ..WorkspaceSnapshot::default()
        }
    }

    fn dirty_workspace_snapshot(root_path: &str) -> WorkspaceSnapshot {
        let mut snapshot = workspace_snapshot(root_path);
        snapshot.tabs.push(crate::cli_protocol::TabSnapshot {
            tab_id: "dirty-tab".to_string(),
            path: format!("{root_path}/draft.md"),
            title: "draft.md".to_string(),
            dirty: true,
        });
        snapshot
    }
}
