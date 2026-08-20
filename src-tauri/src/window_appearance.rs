//! How a window is built, and what draws its ground.
//!
//! AppKit draws it. That is worth stating, because it did not use to: the windows
//! were built `transparent(true)` with a `Sidebar` vibrancy material behind them,
//! which on macOS means the private-API path — the webview stops drawing its own
//! background and an `NSVisualEffectView` sits underneath.
//!
//! Two things were wrong with that. The material was never visible, because
//! `body` paints an opaque `bg-base-100` across the whole window and nothing ever
//! showed through. And that compositing path is the leading suspect for the blank
//! window recorded in
//! `.loopx/issues/issue-llm-wiki-background-white-screen-20260624T095432.md`: a
//! window still on screen at alpha 1, a live process and event loop, no WebContent
//! termination in any log, and content painting pure white. That is a layer that
//! stopped being redrawn rather than a page that died — and a window with no
//! ground of its own has nothing to show while it is not being redrawn.
//!
//! So the ground is now AppKit's `windowBackgroundColor`, which follows the light
//! or dark appearance the application already sets through `setTheme`. The reload
//! recovery in `lib.rs` stays where it is: this is the fix being tried, not a
//! proven one, and taking the net down at the same time would be the wrong order.
//!
//! Nothing here needs a test to hold it: `macos-private-api` is off in
//! `Cargo.toml` and `macOSPrivateApi` is gone from `tauri.conf.json`, which means
//! `transparent` is not a method that exists on the builder. Putting it back is
//! three deliberate edits with a compile error in the middle.

use tauri::{AppHandle, TitleBarStyle, WebviewWindowBuilder, Wry};

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
fn configure_macos_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
    title_bar_style: TitleBarStyle,
    hidden_title: bool,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    // Overlay title bar and hidden title are ordinary `NSWindow` properties —
    // `titlebarAppearsTransparent` and `fullSizeContentView` — and want nothing
    // from the private API. The content still runs under the traffic lights.
    builder
        .title_bar_style(title_bar_style)
        .hidden_title(hidden_title)
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_window<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
    _title_bar_style: TitleBarStyle,
    _hidden_title: bool,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    builder
}
