use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use window_sessions::{
    is_supported_document_path, normalize_opened_url_path, WindowSessionRegistry,
};

mod assets;
pub mod cli_protocol;
mod cli_server;
mod document;
mod llm_wiki;
mod llm_wiki_fs;
mod llm_wiki_ingest;
mod llm_wiki_llm;
mod llm_wiki_models;
mod llm_wiki_query;
mod llm_wiki_raw;
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

pub(crate) fn new_workspace_window(app: &AppHandle) -> tauri::Result<String> {
    let label = {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let mut registry = state.lock().unwrap();
        registry.claim_workspace_window()
    };
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        return Ok(label);
    }

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
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
    real_path: std::path::PathBuf,
) -> tauri::Result<String> {
    let requested_label = format!("document-{}", WIN_ID.fetch_add(1, Ordering::SeqCst));
    let label = {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let mut registry = state.lock().unwrap();
        registry.claim_document_window(real_path.clone(), requested_label)
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

fn focus_or_create_workspace_window(app: &AppHandle) {
    if let Err(error) = new_workspace_window(app) {
        log::error!("failed to create workspace window: {error}");
    }
}

fn open_supported_document_urls(app: &AppHandle, urls: &[tauri::Url]) {
    for url in urls {
        let Some(path) = normalize_opened_url_path(url) else {
            continue;
        };
        if !is_supported_document_path(&path) {
            continue;
        }
        let Ok(real_path) = path.canonicalize() else {
            log::warn!(
                "failed to canonicalize opened document path: {}",
                path.display()
            );
            continue;
        };
        if !real_path.is_file() {
            continue;
        }
        if let Err(error) = new_document_window(app, real_path) {
            log::error!("failed to open document window: {error}");
        }
    }
}

fn emit_menu_event(app: &AppHandle, event: &str) {
    let windows = app.webview_windows();
    let window = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next());

    if let Some(window) = window {
        let state = app.state::<Mutex<WindowSessionRegistry>>();
        let registry = state.lock().unwrap();
        if registry.role_for_label(window.label()).is_none() {
            return;
        }
        let _ = window.emit(event, ());
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "open-folder" => emit_menu_event(app, "mdx-menu-open-folder"),
                "new-folder" => emit_menu_event(app, "mdx-menu-new-folder"),
                "new-markdown-file" => emit_menu_event(app, "mdx-menu-new-markdown-file"),
                "rename" => emit_menu_event(app, "mdx-menu-rename"),
                "trash" => emit_menu_event(app, "mdx-menu-trash"),
                "refresh" => emit_menu_event(app, "mdx-menu-refresh"),
                "save" => emit_menu_event(app, "mdx-menu-save"),
                "close-tab" => emit_menu_event(app, "mdx-menu-close-tab"),
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
            assets::load_image_asset,
            document::read_document_file,
            document::save_document_file,
            document::overwrite_document_file,
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
            llm_wiki::llm_wiki_get_config,
            llm_wiki::llm_wiki_update_config,
            llm_wiki::llm_wiki_get_log,
            llm_wiki::llm_config_get,
            llm_wiki::llm_config_set,
            llm_wiki::llm_config_update,
            quit_app,
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
                let has_document_windows = {
                    let state = app.state::<Mutex<WindowSessionRegistry>>();
                    let registry = state.lock().unwrap();
                    registry.has_document_windows()
                };
                if !has_document_windows {
                    focus_or_create_workspace_window(app);
                }
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            RunEvent::Opened { urls } => {
                open_supported_document_urls(app, &urls);
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                focus_or_create_workspace_window(app);
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } => {
                let state = app.state::<Mutex<WindowSessionRegistry>>();
                let mut registry = state.lock().unwrap();
                registry.remove_label(&label);
            }
            _ => {}
        });
}
