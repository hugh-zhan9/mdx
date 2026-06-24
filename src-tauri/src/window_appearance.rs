use tauri::{AppHandle, TitleBarStyle, WebviewWindowBuilder, Wry};

#[cfg(target_os = "macos")]
use tauri::window::{Effect, EffectState, EffectsBuilder};

#[cfg_attr(not(test), allow(dead_code))]
pub fn macos_window_effects_enabled() -> bool {
    cfg!(target_os = "macos")
}

pub fn workspace_title_bar_style() -> TitleBarStyle {
    macos_title_bar_style()
}

pub fn document_title_bar_style() -> TitleBarStyle {
    macos_title_bar_style()
}

pub fn document_error_title_bar_style() -> TitleBarStyle {
    macos_title_bar_style()
}

pub fn workspace_hidden_title() -> bool {
    macos_hidden_title()
}

pub fn document_hidden_title() -> bool {
    macos_hidden_title()
}

pub fn document_error_hidden_title() -> bool {
    macos_hidden_title()
}

pub fn configure_workspace_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    configure_macos_window(
        builder,
        workspace_title_bar_style(),
        workspace_hidden_title(),
    )
}

pub fn configure_document_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    configure_macos_window(builder, document_title_bar_style(), document_hidden_title())
}

pub fn configure_document_error_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    configure_macos_window(
        builder,
        document_error_title_bar_style(),
        document_error_hidden_title(),
    )
}

fn macos_title_bar_style() -> TitleBarStyle {
    #[cfg(target_os = "macos")]
    {
        TitleBarStyle::Overlay
    }
    #[cfg(not(target_os = "macos"))]
    {
        TitleBarStyle::Visible
    }
}

fn macos_hidden_title() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(target_os = "macos")]
fn macos_effects() -> tauri::utils::config::WindowEffectsConfig {
    EffectsBuilder::new()
        .effect(Effect::Sidebar)
        .state(EffectState::FollowsWindowActiveState)
        .build()
}

#[cfg(target_os = "macos")]
fn configure_macos_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
    title_bar_style: TitleBarStyle,
    hidden_title: bool,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    builder
        .title_bar_style(title_bar_style)
        .hidden_title(hidden_title)
        .transparent(true)
        .effects(macos_effects())
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
    _title_bar_style: TitleBarStyle,
    _hidden_title: bool,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    builder
}
