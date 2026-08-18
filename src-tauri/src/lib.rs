use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry,
};
use window_sessions::{
    is_supported_document_path, normalize_opened_url_path, DirtyWorkspacePaths,
    StartupOpenRoutingState, WindowRole, WindowSession, WindowSessionRegistry,
};

mod assets;
pub mod cli_protocol;
mod cli_server;
mod document;
mod draft_store;
mod external_url;
mod file_watch;
mod layout_fonts;
mod layout_pdf;
mod llm_wiki;
mod llm_wiki_context;
mod llm_wiki_fs;
mod llm_wiki_ingest;
mod llm_wiki_links;
pub mod llm_wiki_llm;
mod llm_wiki_models;
mod llm_wiki_operation;
mod llm_wiki_query;
mod llm_wiki_raw;
#[cfg(target_os = "macos")]
mod macos_launch;
pub mod memory;
pub mod memory_agent_setup;
pub mod memory_config;
pub mod memory_hooks;
pub mod memory_models;
mod models;
mod path_guard;
mod state_store;
mod user_themes;
mod window_appearance;
mod window_sessions;
mod workspace_fs;
mod workspace_search;

pub use models::WorkspaceError;

/// Runs one blocking memory operation off the UI thread.
///
/// Reading and writing the library is synchronous SQLite work plus embedding;
/// none of it belongs on the thread that has to keep the window responsive.
async fn run_blocking_memory_task<T>(
    task: impl FnOnce() -> Result<T, WorkspaceError> + Send + 'static,
) -> Result<T, WorkspaceError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            WorkspaceError::new(
                "memory_task_failed",
                format!("the memory operation did not finish: {error}"),
            )
        })?
}

// The memory command surface.
//
// Every one of these is a thin shell over `memory::api`: parse the arguments,
// hand them over, hand the answer back. The commands deleted in this migration
// — inbox review, working context, the Markdown index, storage migration — are
// gone rather than aliased, because the concepts behind them are gone.

#[tauri::command]
fn memory_status(root_path: String) -> Result<memory::api::MemoryStatus, WorkspaceError> {
    memory::api::status(std::path::Path::new(&root_path))
}

#[tauri::command]
fn memory_enable(root_path: String, enabled: bool) -> Result<memory::api::MemoryStatus, WorkspaceError> {
    let root = std::path::Path::new(&root_path);
    let mut config = memory::config::read_workspace_config(root)?;
    config.enabled = enabled;
    memory::config::write_workspace_config(root, &config)?;
    if enabled {
        memory::api::bind_project(root)?;
    }
    memory::api::status(root)
}

#[tauri::command]
fn memory_config_get(root_path: String) -> Result<memory::config::WorkspaceMemoryConfig, WorkspaceError> {
    memory::config::read_workspace_config(std::path::Path::new(&root_path))
}

#[tauri::command]
fn memory_config_set(
    root_path: String,
    config: memory::config::WorkspaceMemoryConfig,
) -> Result<memory::config::WorkspaceMemoryConfig, WorkspaceError> {
    let root = std::path::Path::new(&root_path);
    memory::config::write_workspace_config(root, &config)?;
    memory::config::read_workspace_config(root)
}

#[tauri::command]
fn memory_global_config_get() -> Result<memory::config::GlobalMemoryConfig, WorkspaceError> {
    memory::config::read_global_config()
}

#[tauri::command]
fn memory_global_config_set(
    config: memory::config::GlobalMemoryConfig,
) -> Result<memory::config::GlobalMemoryConfig, WorkspaceError> {
    memory::config::write_global_config(&config)?;
    memory::config::read_global_config()
}

#[tauri::command]
fn memory_diagnostics() -> Result<memory::engine::MemoryDiagnostics, WorkspaceError> {
    memory::api::diagnostics()
}

#[tauri::command]
fn memory_projects() -> Result<Vec<mempal_runtime::projects::ProjectSummary>, WorkspaceError> {
    memory::api::projects()
}

#[tauri::command]
fn memory_rebind_project(wing: String, root_path: String) -> Result<(), WorkspaceError> {
    memory::api::rebind_project(&wing, std::path::Path::new(&root_path))
}

#[tauri::command]
fn memory_model_status() -> Result<memory::api::ModelStatus, WorkspaceError> {
    memory::api::model_status()
}

#[tauri::command]
async fn memory_model_download() -> Result<memory::api::ModelStatus, WorkspaceError> {
    run_blocking_memory_task(memory::api::fetch_model).await
}

#[tauri::command]
async fn memory_reindex() -> Result<memory::engine::ReindexReport, WorkspaceError> {
    run_blocking_memory_task(memory::api::rebuild_index).await
}

#[tauri::command]
async fn memory_search(
    request: memory::models::retrieval::SearchRequest,
) -> Result<Vec<memory::models::retrieval::SearchHit>, WorkspaceError> {
    run_blocking_memory_task(move || memory::api::search(request)).await
}

#[tauri::command]
async fn memory_context(
    root_path: String,
    query: memory::models::retrieval::ContextQuery,
) -> Result<memory::models::retrieval::ContextPack, WorkspaceError> {
    run_blocking_memory_task(move || memory::api::context(std::path::Path::new(&root_path), query))
        .await
}

#[tauri::command]
async fn memory_brief(
    root_path: String,
    query: memory::models::retrieval::ContextQuery,
) -> Result<memory::models::retrieval::Brief, WorkspaceError> {
    run_blocking_memory_task(move || memory::api::brief(std::path::Path::new(&root_path), query))
        .await
}

#[tauri::command]
async fn memory_recall(
    root_path: String,
    query: memory::models::retrieval::RecallQuery,
) -> Result<memory::models::retrieval::RecallResult, WorkspaceError> {
    run_blocking_memory_task(move || memory::api::recall(std::path::Path::new(&root_path), query))
        .await
}

#[tauri::command]
async fn memory_add(
    root_path: String,
    request: memory::api::AddMaterialRequest,
) -> Result<memory::models::evidence::WrittenEvidence, WorkspaceError> {
    run_blocking_memory_task(move || {
        memory::api::add_material(std::path::Path::new(&root_path), request)
    })
    .await
}

#[tauri::command]
async fn memory_import_path(
    root_path: String,
    path: String,
) -> Result<memory::models::evidence::IngestOutcome, WorkspaceError> {
    run_blocking_memory_task(move || {
        memory::api::import_path(std::path::Path::new(&root_path), std::path::Path::new(&path))
    })
    .await
}

#[tauri::command]
async fn memory_list(
    root_path: String,
    filter: memory::api::ListFilter,
) -> Result<Vec<memory::api::StoredItem>, WorkspaceError> {
    run_blocking_memory_task(move || memory::api::list(std::path::Path::new(&root_path), filter))
        .await
}

#[tauri::command]
fn memory_show(drawer_id: String) -> Result<memory::api::StoredItem, WorkspaceError> {
    memory::api::show(&drawer_id)
}

#[tauri::command]
fn memory_delete(drawer_id: String) -> Result<bool, WorkspaceError> {
    memory::api::delete(&drawer_id)
}

#[tauri::command]
fn memory_purge(before: Option<String>) -> Result<u64, WorkspaceError> {
    memory::api::purge(before)
}

#[tauri::command]
async fn memory_distill(
    root_path: String,
    request: memory::api::DistillRequestDto,
) -> Result<memory::models::knowledge::DistilledConclusion, WorkspaceError> {
    run_blocking_memory_task(move || {
        memory::api::distill_conclusion(std::path::Path::new(&root_path), request)
    })
    .await
}

#[tauri::command]
fn memory_gate(
    drawer_id: String,
) -> Result<mempal_runtime::knowledge_gate::GateReport, WorkspaceError> {
    memory::api::conclusion_gate(&drawer_id)
}

#[tauri::command]
async fn memory_adopt(
    root_path: String,
    request: memory::api::AdoptRequestDto,
) -> Result<memory::models::knowledge::AdoptedConclusion, WorkspaceError> {
    run_blocking_memory_task(move || {
        memory::api::adopt_conclusion(std::path::Path::new(&root_path), request)
    })
    .await
}

#[tauri::command]
fn memory_demote(
    request: memory::api::RetireRequestDto,
) -> Result<memory::models::knowledge::RetiredConclusion, WorkspaceError> {
    memory::api::retire_conclusion(request)
}

#[tauri::command]
async fn memory_counterexample_add(
    root_path: String,
    request: memory::api::CounterexampleRequestDto,
) -> Result<mempal_runtime::knowledge_gate::GateReport, WorkspaceError> {
    run_blocking_memory_task(move || {
        memory::api::record_counterexample(std::path::Path::new(&root_path), request)
    })
    .await
}

#[tauri::command]
async fn memory_legacy_preflight(
    root_path: String,
) -> Result<memory::models::legacy_import::LegacyImportPreflight, WorkspaceError> {
    run_blocking_memory_task(move || memory::api::legacy_preflight(std::path::Path::new(&root_path)))
        .await
}

#[tauri::command]
async fn memory_legacy_import(
    root_path: String,
) -> Result<memory::models::legacy_import::LegacyImportReport, WorkspaceError> {
    run_blocking_memory_task(move || memory::api::legacy_import(std::path::Path::new(&root_path)))
        .await
}

#[tauri::command]
async fn memory_export_bundle(
    root_path: String,
    output_path: String,
) -> Result<memory::bundle::BundleExport, WorkspaceError> {
    run_blocking_memory_task(move || {
        memory::api::export_bundle(
            std::path::Path::new(&root_path),
            std::path::Path::new(&output_path),
        )
    })
    .await
}

#[tauri::command]
async fn memory_import_bundle(
    input_path: String,
) -> Result<memory::bundle::BundleImport, WorkspaceError> {
    run_blocking_memory_task(move || {
        memory::api::import_bundle(std::path::Path::new(&input_path))
    })
    .await
}

#[tauri::command]
fn memory_integration_status(
    root_path: String,
) -> Result<Vec<memory_models::MemoryIntegrationStatus>, WorkspaceError> {
    memory_agent_setup::memory_agent_status(root_path, None).map_err(|error| {
        WorkspaceError::new(
            "memory_integration_status_failed",
            error.to_string(),
        )
    })
}

#[tauri::command]
fn memory_integration_repair(
    root_path: String,
    agent: String,
) -> Result<memory_models::MemoryDoctorReport, WorkspaceError> {
    memory_agent_setup::memory_agent_repair(
        root_path.clone(),
        memory_agent_setup::MemoryAgentCommandRequest {
            agent: Some(agent.clone()),
            dry_run: false,
            keep_data: false,
        },
    )
    .map_err(|error| {
        WorkspaceError::new(
            "memory_integration_repair_failed",
            error.to_string(),
        )
    })?;
    memory_agent_setup::memory_agent_doctor(root_path, Some(agent)).map_err(|error| {
        WorkspaceError::new(
            "memory_integration_repair_failed",
            error.to_string(),
        )
    })
}

#[tauri::command]
fn memory_agent_setup(
    root_path: String,
    request: memory_agent_setup::MemoryAgentSetupRequest,
) -> Result<memory_agent_setup::MemoryAgentSetupResult, WorkspaceError> {
    memory_agent_setup::memory_agent_setup(root_path, request).map_err(|error| {
        WorkspaceError::new("memory_agent_setup_failed", error.to_string())
    })
}

#[cfg(test)]
mod assets_tests;
#[cfg(test)]
mod cli_protocol_tests;
#[cfg(test)]
mod document_tests;
#[cfg(test)]
mod draft_store_tests;
#[cfg(test)]
mod file_watch_tests;
#[cfg(test)]
mod layout_fonts_tests;
#[cfg(test)]
mod layout_pdf_tests;
#[cfg(test)]
mod llm_wiki_tests;
#[cfg(test)]
mod state_store_tests;
#[cfg(test)]
mod user_themes_tests;
#[cfg(test)]
mod window_sessions_tests;
#[cfg(test)]
mod workspace_fs_tests;
#[cfg(test)]
mod workspace_search_tests;

#[cfg(test)]
mod memory_tauri_command_tests {
    /// The command surface is a contract, and this is what keeps it one.
    ///
    /// The second list matters as much as the first: these commands were
    /// removed with the concepts behind them, and an alias quietly reappearing
    /// would give agents a way to keep asking for a product that no longer
    /// exists.
    #[test]
    fn registers_the_memory_command_surface() {
        let source = include_str!("lib.rs");
        for command in [
            "memory_status",
            "memory_enable",
            "memory_config_get",
            "memory_config_set",
            "memory_global_config_get",
            "memory_global_config_set",
            "memory_diagnostics",
            "memory_projects",
            "memory_rebind_project",
            "memory_model_status",
            "memory_model_download",
            "memory_reindex",
            "memory_search",
            "memory_context",
            "memory_brief",
            "memory_recall",
            "memory_add",
            "memory_import_path",
            "memory_list",
            "memory_show",
            "memory_delete",
            "memory_purge",
            "memory_distill",
            "memory_gate",
            "memory_adopt",
            "memory_demote",
            "memory_counterexample_add",
            "memory_legacy_preflight",
            "memory_legacy_import",
            "memory_export_bundle",
            "memory_import_bundle",
            "memory_integration_status",
            "memory_integration_repair",
            "memory_agent_setup",
        ] {
            assert!(
                source.contains(&format!("            {command},")),
                "missing Tauri command registration for {command}"
            );
        }
    }

    #[test]
    fn the_abandoned_commands_are_gone_for_good() {
        let source = include_str!("lib.rs");
        for command in [
            "memory_working_get",
            "memory_working_set",
            "memory_working_append",
            "memory_inbox_add",
            "memory_inbox_get",
            "memory_inbox_list",
            "memory_inbox_accept",
            "memory_inbox_reject",
            "memory_index_rebuild",
            "memory_index_status",
            "memory_index_search",
            "memory_storage_migrate",
            "memory_storage_migrate_dry_run",
            "memory_thread_save",
            "memory_thread_list",
            "memory_thread_get",
            "memory_archive",
        ] {
            assert!(
                !source.contains(&format!("            {command},")),
                "{command} was deleted with the concept behind it; it must not come back as an alias"
            );
        }
    }
}

static WIN_ID: AtomicU32 = AtomicU32::new(0);
const WORKSPACE_FRONTEND_HEARTBEAT_MAX_AGE: Duration = Duration::from_secs(45);
const WORKSPACE_FRONTEND_RECOVERY_DELAY: Duration = Duration::from_secs(2);
const WORKSPACE_FRONTEND_RECOVERY_MIN_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct MenuState {
    workspace_only_items: Vec<MenuItem<Wry>>,
}

impl MenuState {
    fn set_workspace_items_enabled(&self, enabled: bool) {
        for item in &self.workspace_only_items {
            if let Err(error) = item.set_enabled(enabled) {
                log::warn!("failed to update menu item state: {error}");
            }
        }
    }
}

pub(crate) fn new_workspace_window(app: &AppHandle) -> tauri::Result<String> {
    new_workspace_window_with_route(app, "/")
}

fn new_workspace_window_with_route(app: &AppHandle, route: &str) -> tauri::Result<String> {
    let label = {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let mut registry = state.lock().unwrap();
        registry.claim_workspace_window()
    };
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        return Ok(label);
    }

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title("MDX")
        .inner_size(1480.0, 860.0)
        .min_inner_size(1100.0, 640.0)
        .resizable(true);
    let window = window_appearance::configure_workspace_window(builder).build()?;
    let _ = window.set_focus();
    Ok(label)
}

pub(crate) fn new_document_window(
    app: &AppHandle,
    display_path: PathBuf,
    real_path: PathBuf,
) -> tauri::Result<String> {
    let requested_label = format!("document-{}", WIN_ID.fetch_add(1, Ordering::SeqCst));
    let label = {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let mut registry = state.lock().unwrap();
        registry.claim_document_window(display_path.clone(), real_path.clone(), requested_label)
    };

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        return Ok(label);
    }

    let route = format!(
        "/?mode=document&realPath={}",
        encode_query_component(&real_path.to_string_lossy())
    );
    let title = real_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("{name} - MDX"))
        .unwrap_or_else(|| "MDX".to_string());

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title(&title)
        .inner_size(1280.0, 820.0)
        .min_inner_size(760.0, 520.0)
        .resizable(true);
    let window = window_appearance::configure_document_window(builder).build()?;
    let _ = window.set_focus();
    Ok(label)
}

fn new_document_error_window(
    app: &AppHandle,
    display_path: Option<PathBuf>,
    message: String,
) -> tauri::Result<String> {
    let label = format!("document-error-{}", WIN_ID.fetch_add(1, Ordering::SeqCst));
    {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let mut registry = state.lock().unwrap();
        registry.claim_document_error_window(label.clone(), message, display_path.clone());
    }

    let mut route = "/?mode=documentError".to_string();
    if let Some(path) = &display_path {
        route.push_str("&path=");
        route.push_str(&encode_query_component(&path.to_string_lossy()));
    }

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title("无法打开文档 - MDX")
        .inner_size(720.0, 420.0)
        .min_inner_size(520.0, 320.0)
        .resizable(true);
    let window = window_appearance::configure_document_error_window(builder).build()?;
    let _ = window.set_focus();
    Ok(label)
}

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn focus_or_create_initial_workspace_window(app: &AppHandle) {
    if let Err(error) = new_workspace_window(app) {
        log::error!("failed to create workspace window: {error}");
    }
}

#[tauri::command]
fn focus_or_create_workspace_window(app: AppHandle) -> Result<(), String> {
    focus_or_create_workspace_window_and_open_folder(&app)
        .map_err(|error| format!("failed to open workspace window: {error}"))
}

fn focus_or_create_workspace_window_and_open_folder(app: &AppHandle) -> tauri::Result<()> {
    let label = {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let mut registry = state.lock().unwrap();
        registry.claim_workspace_window()
    };

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        let _ = window.emit("mdx-menu-open-folder", ());
        return Ok(());
    }

    new_workspace_window_with_route(app, "/?workspaceAction=openFolder").map(|_| ())
}

fn open_supported_document_urls(app: &AppHandle, urls: &[tauri::Url]) -> bool {
    let mut opened_supported_document = false;
    for url in urls {
        let Some(path) = normalize_opened_url_path(url) else {
            continue;
        };
        if !is_supported_document_path(&path) {
            continue;
        }
        let real_path = match path.canonicalize() {
            Ok(real_path) => real_path,
            Err(error) => {
                log::warn!(
                    "failed to canonicalize opened document path {}: {error}",
                    path.display()
                );
                if let Err(error) = new_document_error_window(
                    app,
                    Some(path),
                    "无法解析这个 Markdown 文档路径。".to_string(),
                ) {
                    log::error!("failed to open document error window: {error}");
                } else {
                    opened_supported_document = true;
                }
                continue;
            }
        };
        if !real_path.is_file() {
            if let Err(error) = new_document_error_window(
                app,
                Some(path),
                "这个 Markdown 路径不是一个普通文件。".to_string(),
            ) {
                log::error!("failed to open document error window: {error}");
            } else {
                opened_supported_document = true;
            }
            continue;
        }
        if let Err(error) = new_document_window(app, path, real_path) {
            log::error!("failed to open document window: {error}");
        } else {
            opened_supported_document = true;
        }
    }
    opened_supported_document
}

#[cfg(target_os = "macos")]
fn remember_supported_startup_document_opened(app: &AppHandle) {
    let state = app.state::<Mutex<StartupOpenRoutingState>>();
    let mut startup = state.lock().unwrap();
    startup.observe_supported_document_opened_during_startup();
}

#[cfg(target_os = "macos")]
fn remember_ready_for_startup_routing(app: &AppHandle) {
    let state = app.state::<Mutex<StartupOpenRoutingState>>();
    let mut startup = state.lock().unwrap();
    startup.observe_ready();
}

#[cfg(target_os = "macos")]
fn create_initial_workspace_after_startup_events(app: &AppHandle) {
    let has_document_windows = {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let registry = state.lock().unwrap();
        registry.has_document_windows()
    };
    let should_create_workspace = {
        let state = app.state::<Mutex<StartupOpenRoutingState>>();
        let mut startup = state.lock().unwrap();
        startup.should_create_workspace_on_initial_main_events_cleared(has_document_windows)
    };
    if should_create_workspace {
        focus_or_create_initial_workspace_window(app);
    }
}

fn focused_window_with_role(app: &AppHandle) -> Option<(tauri::WebviewWindow, WindowRole)> {
    let windows = app.webview_windows();
    let window = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next())?;

    let state = app.state::<Mutex<WindowSessionRegistry>>();
    let registry = state.lock().unwrap();
    let role = registry.role_for_label(window.label())?;

    Some((window.clone(), role))
}

fn window_role_for_label(app: &AppHandle, label: &str) -> Option<WindowRole> {
    let state = app.state::<Mutex<WindowSessionRegistry>>();
    let registry = state.lock().unwrap();
    registry.role_for_label(label)
}

fn update_menu_state_for_role(app: &AppHandle, role: Option<WindowRole>) {
    let state = app.state::<MenuState>();
    state.set_workspace_items_enabled(role == Some(WindowRole::Workspace));
}

fn update_menu_state_for_focused_window(app: &AppHandle) {
    update_menu_state_for_role(app, focused_window_with_role(app).map(|(_, role)| role));
}

fn schedule_workspace_frontend_recovery_check(
    app: &AppHandle,
    label: String,
    trigger: &'static str,
) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(WORKSPACE_FRONTEND_RECOVERY_DELAY);
        let app_for_recovery = app.clone();
        let label_for_recovery = label.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            recover_stale_workspace_frontend(&app_for_recovery, &label_for_recovery, trigger);
        }) {
            log::warn!(
                target: "mdx::webview_recovery",
                "failed to schedule recovery check label={} trigger={} error={}",
                label,
                trigger,
                error,
            );
        }
    });
}

fn schedule_all_workspace_frontend_recovery_checks(app: &AppHandle, trigger: &'static str) {
    for label in app.webview_windows().keys() {
        if window_role_for_label(app, label) == Some(WindowRole::Workspace) {
            schedule_workspace_frontend_recovery_check(app, label.clone(), trigger);
        }
    }
}

fn recover_stale_workspace_frontend(app: &AppHandle, label: &str, trigger: &str) {
    if window_role_for_label(app, label) != Some(WindowRole::Workspace) {
        return;
    }

    let reason = {
        let state = app.state::<cli_server::CliState>();
        state.reserve_frontend_recovery(
            label,
            WORKSPACE_FRONTEND_HEARTBEAT_MAX_AGE,
            WORKSPACE_FRONTEND_RECOVERY_MIN_INTERVAL,
        )
    };

    let Some(reason) = reason else {
        return;
    };

    let Some(window) = app.get_webview_window(label) else {
        return;
    };

    log::warn!(
        target: "mdx::webview_recovery",
        "reloading stale workspace webview label={} trigger={} reason={}",
        label,
        trigger,
        reason.as_log_reason(),
    );

    if let Err(error) = window.reload() {
        log::error!(
            target: "mdx::webview_recovery",
            "failed to reload stale workspace webview label={} trigger={} reason={} error={}",
            label,
            trigger,
            reason.as_log_reason(),
            error,
        );
    }
}

fn dispatch_menu_event(app: &AppHandle, menu_id: &str) {
    let Some((window, role)) = focused_window_with_role(app) else {
        return;
    };

    match (role, menu_id) {
        (WindowRole::Workspace, "open-folder") => {
            let _ = window.emit("mdx-menu-open-folder", ());
        }
        (WindowRole::Workspace, "new-folder") => {
            let _ = window.emit("mdx-menu-new-folder", ());
        }
        (WindowRole::Workspace, "new-markdown-file") => {
            let _ = window.emit("mdx-menu-new-markdown-file", ());
        }
        (WindowRole::Workspace, "rename") => {
            let _ = window.emit("mdx-menu-rename", ());
        }
        (WindowRole::Workspace, "trash") => {
            let _ = window.emit("mdx-menu-trash", ());
        }
        (WindowRole::Workspace, "refresh") => {
            let _ = window.emit("mdx-menu-refresh", ());
        }
        (WindowRole::Workspace, "save") => {
            let _ = window.emit("mdx-menu-save", ());
        }
        (WindowRole::Workspace, "close-tab") => {
            let _ = window.emit("mdx-menu-close-tab", ());
        }
        (WindowRole::Workspace, _) => {}
        (WindowRole::Document, "open-folder") => {
            let _ = window.emit("mdx-menu-open-folder", ());
        }
        (WindowRole::Document, "save") => {
            let _ = window.emit("mdx-menu-save", ());
        }
        (WindowRole::Document, "close-tab") => {
            let _ = window.emit("mdx-menu-close-document", ());
        }
        (WindowRole::Document, _) => {}
    }
}

#[tauri::command]
fn get_window_session(
    window: tauri::Window,
    state: tauri::State<'_, Mutex<WindowSessionRegistry>>,
    dirty_paths: tauri::State<'_, Mutex<DirtyWorkspacePaths>>,
) -> serde_json::Value {
    let registry = state.lock().expect("window session registry poisoned");
    let dirty_paths = dirty_paths
        .lock()
        .expect("dirty workspace paths registry poisoned");

    match registry.session_for_label(window.label()) {
        Some(WindowSession::Document {
            file_name,
            display_path,
            real_path,
        }) => serde_json::json!({
            "kind": "document",
            "fileName": file_name,
            "displayPath": display_path,
            "realPath": real_path,
            "workspaceDirty": dirty_paths.contains(std::path::Path::new(&real_path)),
        }),
        Some(WindowSession::DocumentError { message, path }) => serde_json::json!({
            "kind": "documentError",
            "message": message,
            "path": path,
        }),
        Some(WindowSession::Workspace) | None => serde_json::json!({
            "kind": "workspace",
        }),
    }
}

#[tauri::command]
fn update_workspace_dirty_paths(
    paths: Vec<String>,
    dirty_paths: tauri::State<'_, Mutex<DirtyWorkspacePaths>>,
) {
    let mut dirty_paths = dirty_paths
        .lock()
        .expect("dirty workspace paths registry poisoned");
    dirty_paths.update(paths);
}

#[tauri::command]
fn is_workspace_path_dirty(
    real_path: String,
    dirty_paths: tauri::State<'_, Mutex<DirtyWorkspacePaths>>,
) -> bool {
    let dirty_paths = dirty_paths
        .lock()
        .expect("dirty workspace paths registry poisoned");
    dirty_paths.contains(std::path::Path::new(&real_path))
}

#[tauri::command]
fn workspace_close_diagnostic(window: tauri::Window, stage: String, details: serde_json::Value) {
    log::info!(
        target: "mdx::workspace_close",
        "frontend stage={} label={} details={}",
        stage,
        window.label(),
        details,
    );
}

fn startup_open_routing_state() -> StartupOpenRoutingState {
    let mut startup_routing = StartupOpenRoutingState::default();
    #[cfg(target_os = "macos")]
    if let Some(default_launch) = macos_launch::observed_launch_reason() {
        startup_routing.observe_default_launch(default_launch);
    }
    startup_routing
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    macos_launch::install_launch_observer();

    tauri::Builder::default()
        .manage(cli_server::CliState::default())
        .manage(Mutex::new(file_watch::FileWatchState::default()))
        .manage(Mutex::new(workspace_search::WorkspaceSearchState::default()))
        .manage(Mutex::new(WindowSessionRegistry::default()))
        .manage(Mutex::new(DirtyWorkspacePaths::default()))
        .manage(Mutex::new(startup_open_routing_state()))
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .max_file_size(1_000_000)
                    .build(),
            )?;
            log::info!(
                target: "mdx::lifecycle",
                "logger initialized app_log_dir={}",
                app.path()
                    .app_log_dir()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|error| format!("unavailable: {error}")),
            );
            app.handle().plugin(tauri_plugin_dialog::init())?;
            cli_server::start(app.handle().clone());

            let open_folder_item = MenuItem::with_id(
                app,
                "open-folder",
                "打开文件夹...",
                true,
                Some("CmdOrCtrl+O"),
            )?;
            let new_markdown_item = MenuItem::with_id(
                app,
                "new-markdown-file",
                "新建 Markdown 文档",
                true,
                Some("CmdOrCtrl+N"),
            )?;
            let new_folder_item = MenuItem::with_id(
                app,
                "new-folder",
                "新建文件夹",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?;
            let rename_item = MenuItem::with_id(app, "rename", "重命名", true, None::<&str>)?;
            let trash_item = MenuItem::with_id(app, "trash", "移到废纸篓", true, None::<&str>)?;
            let refresh_item = MenuItem::with_id(app, "refresh", "刷新", true, None::<&str>)?;
            let save_item = MenuItem::with_id(app, "save", "保存", true, Some("CmdOrCtrl+S"))?;
            let close_tab_item =
                MenuItem::with_id(app, "close-tab", "关闭标签页", true, Some("CmdOrCtrl+W"))?;
            app.manage(MenuState {
                workspace_only_items: vec![
                    new_markdown_item.clone(),
                    new_folder_item.clone(),
                    rename_item.clone(),
                    trash_item.clone(),
                    refresh_item.clone(),
                ],
            });
            let file_menu = Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &open_folder_item,
                    &PredefinedMenuItem::separator(app)?,
                    &new_markdown_item,
                    &new_folder_item,
                    &PredefinedMenuItem::separator(app)?,
                    &rename_item,
                    &trash_item,
                    &refresh_item,
                    &PredefinedMenuItem::separator(app)?,
                    &save_item,
                    &close_tab_item,
                ],
            )?;

            let edit_menu = Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            app.set_menu(Menu::with_items(app, &[&file_menu, &edit_menu])?)?;
            update_menu_state_for_focused_window(app.handle());
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "open-folder" | "new-folder" | "new-markdown-file" | "rename" | "trash"
                | "refresh" | "save" | "close-tab" => dispatch_menu_event(app, event.id().as_ref()),
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cli_server::cli_update_workspace_snapshot,
            cli_server::cli_frontend_heartbeat,
            cli_server::cli_update_tab_state,
            state_store::load_app_state,
            state_store::save_app_state,
            user_themes::list_user_themes,
            user_themes::save_user_theme,
            user_themes::reveal_user_themes_dir,
            assets::save_image_asset,
            assets::save_document_image_asset,
            assets::load_image_asset,
            document::read_document_file,
            document::save_document_file,
            document::overwrite_document_file,
            draft_store::draft_save,
            draft_store::draft_get,
            draft_store::draft_list_for_workspace,
            draft_store::draft_delete,
            draft_store::draft_cleanup_expired,
            file_watch::watch_start_workspace,
            file_watch::watch_start_document,
            file_watch::watch_stop,
            focus_or_create_workspace_window,
            get_window_session,
            update_workspace_dirty_paths,
            is_workspace_path_dirty,
            workspace_close_diagnostic,
            llm_wiki::llm_wiki_detect_workspace,
            llm_wiki::llm_wiki_initialize_workspace,
            llm_wiki::llm_wiki_rescan_raw,
            llm_wiki::llm_wiki_refresh_graph,
            llm_wiki::llm_wiki_ingest_mock_output,
            llm_wiki::llm_wiki_ingest_raw_file,
            llm_wiki::llm_wiki_search,
            llm_wiki::llm_wiki_query,
            llm_wiki::llm_wiki_digest,
            llm_wiki::llm_wiki_digest_mock,
            llm_wiki::llm_wiki_lint,
            llm_wiki::llm_wiki_operation_cancel,
            llm_wiki::llm_wiki_operation_state,
            llm_wiki::llm_wiki_get_config,
            llm_wiki::llm_wiki_update_config,
            llm_wiki::llm_wiki_get_log,
            llm_wiki::llm_config_get,
            llm_wiki::llm_config_set,
            llm_wiki::llm_config_update,
            layout_fonts::font_init_subsystem,
            layout_fonts::font_get_glyph_metrics,
            layout_fonts::font_get_math_constants,
            layout_pdf::layout_export_pdf,
            memory_status,
            memory_enable,
            memory_config_get,
            memory_config_set,
            memory_global_config_get,
            memory_global_config_set,
            memory_diagnostics,
            memory_projects,
            memory_rebind_project,
            memory_model_status,
            memory_model_download,
            memory_reindex,
            memory_search,
            memory_context,
            memory_brief,
            memory_recall,
            memory_add,
            memory_import_path,
            memory_list,
            memory_show,
            memory_delete,
            memory_purge,
            memory_distill,
            memory_gate,
            memory_adopt,
            memory_demote,
            memory_counterexample_add,
            memory_legacy_preflight,
            memory_legacy_import,
            memory_export_bundle,
            memory_import_bundle,
            memory_integration_status,
            memory_integration_repair,
            memory_agent_setup,
            workspace_search::workspace_search,
            workspace_search::workspace_search_cancel,
            workspace_fs::scan_workspace,
            workspace_fs::workspace_note_page,
            workspace_fs::read_markdown_file,
            workspace_fs::read_preview_text_file,
            workspace_fs::read_preview_binary_file,
            workspace_fs::open_path_with_default_application,
            external_url::open_external_url,
            workspace_fs::reveal_path_in_file_manager,
            workspace_fs::write_markdown_file,
            workspace_fs::create_markdown_file,
            workspace_fs::create_folder,
            workspace_fs::rename_path,
            workspace_fs::move_path,
            workspace_fs::trash_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::Ready => {
                log::info!(target: "mdx::lifecycle", "run event ready");
                #[cfg(target_os = "macos")]
                {
                    remember_ready_for_startup_routing(app);
                }
                #[cfg(not(target_os = "macos"))]
                {
                    focus_or_create_initial_workspace_window(app);
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::MainEventsCleared => {
                // Tauri's Ready event does not include AppKit's launch reason.
                // The macOS launch observer records that reason separately, so
                // this first main-event drain can create Workspace only for a
                // default app launch, never for a file-open launch.
                create_initial_workspace_after_startup_events(app);
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            RunEvent::Opened { urls } => {
                log::info!(
                    target: "mdx::lifecycle",
                    "run event opened url_count={}",
                    urls.len(),
                );
                let opened_supported_document = open_supported_document_urls(app, &urls);
                #[cfg(target_os = "macos")]
                if opened_supported_document {
                    remember_supported_startup_document_opened(app);
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                log::info!(
                    target: "mdx::lifecycle",
                    "run event reopen window_count={}",
                    app.webview_windows().len(),
                );
                focus_or_create_initial_workspace_window(app);
                schedule_all_workspace_frontend_recovery_checks(app, "reopen");
            }
            RunEvent::ExitRequested { code, .. } => {
                log::info!(
                    target: "mdx::lifecycle",
                    "run event exit-requested code={code:?} window_count={}",
                    app.webview_windows().len(),
                );
            }
            RunEvent::Exit => {
                log::info!(target: "mdx::lifecycle", "run event exit");
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { .. },
                ..
            } => {
                log::info!(
                    target: "mdx::window",
                    "window close-requested label={} role={:?} window_count={}",
                    label,
                    window_role_for_label(app, &label),
                    app.webview_windows().len(),
                );
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Focused(true),
                ..
            } => {
                update_menu_state_for_role(app, window_role_for_label(app, &label));
                if window_role_for_label(app, &label) == Some(WindowRole::Workspace) {
                    schedule_workspace_frontend_recovery_check(app, label, "focused");
                }
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } => {
                let role = window_role_for_label(app, &label);
                log::info!(
                    target: "mdx::window",
                    "window destroyed label={} role={:?} window_count_before_cleanup={}",
                    label,
                    role,
                    app.webview_windows().len(),
                );
                let was_workspace = {
                    let state = app.state::<Mutex<WindowSessionRegistry>>();
                    let mut registry = state.lock().unwrap();
                    let was_workspace = role == Some(WindowRole::Workspace);
                    registry.remove_label(&label);
                    was_workspace
                };
                if was_workspace {
                    let dirty_paths = app.state::<Mutex<DirtyWorkspacePaths>>();
                    let mut dirty_paths = dirty_paths.lock().unwrap();
                    dirty_paths.clear();
                }
                {
                    let file_watch_state = app.state::<Mutex<file_watch::FileWatchState>>();
                    let mut file_watch_state = file_watch_state.lock().unwrap();
                    file_watch::stop_watches_for_window_label(&mut file_watch_state, &label);
                }
                update_menu_state_for_focused_window(app);
                log::info!(
                    target: "mdx::window",
                    "window destroyed cleanup-complete label={} window_count={}",
                    label,
                    app.webview_windows().len(),
                );
            }
            _ => {}
        });
}
