use std::sync::atomic::{AtomicU32, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

mod assets;
mod models;
mod path_guard;
mod state_store;
mod workspace_fs;

#[cfg(test)]
mod assets_tests;
#[cfg(test)]
mod state_store_tests;
#[cfg(test)]
mod workspace_fs_tests;

static WIN_ID: AtomicU32 = AtomicU32::new(0);

fn new_workspace_window(app: &AppHandle) -> tauri::Result<()> {
    let label = format!("w{}", WIN_ID.fetch_add(1, Ordering::SeqCst));
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
        .title("MDX")
        .inner_size(1100.0, 720.0)
        .resizable(true)
        .build()?;
    let _ = window.set_focus();
    Ok(())
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
            app.handle().plugin(tauri_plugin_process::init())?;

            let new_window_item =
                MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+N"))?;
            let close_window_item = MenuItem::with_id(
                app,
                "close-window",
                "Close Window",
                true,
                Some("CmdOrCtrl+W"),
            )?;
            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &new_window_item,
                    &PredefinedMenuItem::separator(app)?,
                    &close_window_item,
                ],
            )?;

            let edit_menu = Submenu::with_items(
                app,
                "Edit",
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
                "new-window" => {
                    let _ = new_workspace_window(app);
                }
                "close-window" => {
                    if let Some(win) = app
                        .webview_windows()
                        .values()
                        .find(|w| w.is_focused().unwrap_or(false))
                    {
                        let _ = win.close();
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            state_store::load_app_state,
            state_store::save_app_state,
            assets::save_image_asset,
            assets::read_file_bytes,
            workspace_fs::scan_workspace,
            workspace_fs::read_markdown_file,
            workspace_fs::write_markdown_file,
            workspace_fs::create_markdown_file,
            workspace_fs::create_folder,
            workspace_fs::rename_path,
            workspace_fs::move_path,
            workspace_fs::trash_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
