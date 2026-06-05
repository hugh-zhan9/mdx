use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

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
mod llm_wiki;
mod llm_wiki_context;
mod llm_wiki_fs;
mod llm_wiki_ingest;
mod llm_wiki_links;
mod llm_wiki_llm;
mod llm_wiki_models;
mod llm_wiki_operation;
mod llm_wiki_query;
mod llm_wiki_raw;
#[cfg(target_os = "macos")]
mod macos_launch;
mod models;
mod path_guard;
mod state_store;
mod window_sessions;
mod workspace_fs;

#[cfg(test)]
mod assets_tests;
#[cfg(test)]
mod cli_protocol_tests;
#[cfg(test)]
mod document_tests;
#[cfg(test)]
mod llm_wiki_tests;
#[cfg(test)]
mod state_store_tests;
#[cfg(test)]
mod window_sessions_tests;
#[cfg(test)]
mod workspace_fs_tests;

static WIN_ID: AtomicU32 = AtomicU32::new(0);

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

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title("MDX")
        .inner_size(1280.0, 820.0)
        .min_inner_size(1100.0, 640.0)
        .resizable(true)
        .build()?;
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

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title(&title)
        .inner_size(1280.0, 820.0)
        .min_inner_size(760.0, 520.0)
        .resizable(true)
        .build()?;
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

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title("无法打开文档 - MDX")
        .inner_size(720.0, 420.0)
        .min_inner_size(520.0, 320.0)
        .resizable(true)
        .build()?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    macos_launch::install_launch_observer();

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.handle().plugin(tauri_plugin_dialog::init())?;
            app.manage(cli_server::CliState::default());
            app.manage(Mutex::new(WindowSessionRegistry::default()));
            app.manage(Mutex::new(DirtyWorkspacePaths::default()));
            let mut startup_routing = StartupOpenRoutingState::default();
            #[cfg(target_os = "macos")]
            if let Some(default_launch) = macos_launch::observed_launch_reason() {
                startup_routing.observe_default_launch(default_launch);
            }
            app.manage(Mutex::new(startup_routing));
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
            cli_server::cli_update_tab_state,
            state_store::load_app_state,
            state_store::save_app_state,
            assets::save_image_asset,
            assets::save_document_image_asset,
            assets::load_image_asset,
            document::read_document_file,
            document::save_document_file,
            document::overwrite_document_file,
            focus_or_create_workspace_window,
            get_window_session,
            update_workspace_dirty_paths,
            is_workspace_path_dirty,
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
            workspace_fs::scan_workspace,
            workspace_fs::read_markdown_file,
            workspace_fs::read_preview_text_file,
            workspace_fs::read_preview_binary_file,
            workspace_fs::open_path_with_default_application,
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
                let opened_supported_document = open_supported_document_urls(app, &urls);
                #[cfg(target_os = "macos")]
                if opened_supported_document {
                    remember_supported_startup_document_opened(app);
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                focus_or_create_initial_workspace_window(app);
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Focused(true),
                ..
            } => {
                update_menu_state_for_role(app, window_role_for_label(app, &label));
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } => {
                let state = app.state::<Mutex<WindowSessionRegistry>>();
                let mut registry = state.lock().unwrap();
                let was_workspace = registry.role_for_label(&label) == Some(WindowRole::Workspace);
                registry.remove_label(&label);
                if was_workspace {
                    let dirty_paths = app.state::<Mutex<DirtyWorkspacePaths>>();
                    let mut dirty_paths = dirty_paths.lock().unwrap();
                    dirty_paths.clear();
                }
                update_menu_state_for_focused_window(app);
            }
            _ => {}
        });
}
