//! What a File menu item means to each kind of window.
//!
//! The table is small and it is the whole routing decision, so it is worth
//! stating outright: a document window has no folder tree and no tab strip, and
//! the items that act on those must not reach it wearing a workspace meaning.

use crate::menu_event_name;
use crate::window_sessions::WindowRole;

#[test]
fn a_workspace_window_gets_every_file_menu_item() {
    for (menu_id, event) in [
        ("open-folder", "mdx-menu-open-folder"),
        ("new-folder", "mdx-menu-new-folder"),
        ("new-markdown-file", "mdx-menu-new-markdown-file"),
        ("rename", "mdx-menu-rename"),
        ("trash", "mdx-menu-trash"),
        ("refresh", "mdx-menu-refresh"),
        ("save", "mdx-menu-save"),
        ("close-tab", "mdx-menu-close-tab"),
    ] {
        assert_eq!(
            menu_event_name(WindowRole::Workspace, menu_id),
            Some(event),
            "workspace window, menu item {menu_id}",
        );
    }
}

#[test]
fn a_document_window_saves_opens_folders_and_closes_itself() {
    assert_eq!(
        menu_event_name(WindowRole::Document, "save"),
        Some("mdx-menu-save"),
    );
    assert_eq!(
        menu_event_name(WindowRole::Document, "open-folder"),
        Some("mdx-menu-open-folder"),
    );
    // The same item, a different meaning: there is no tab to close here, so
    // 关闭标签页 closes the document window itself.
    assert_eq!(
        menu_event_name(WindowRole::Document, "close-tab"),
        Some("mdx-menu-close-document"),
    );
}

#[test]
fn a_document_window_ignores_the_items_that_act_on_a_folder_tree() {
    for menu_id in ["new-folder", "new-markdown-file", "rename", "trash", "refresh"] {
        assert_eq!(
            menu_event_name(WindowRole::Document, menu_id),
            None,
            "document window, menu item {menu_id}",
        );
    }
}

#[test]
fn an_unknown_menu_id_reaches_nothing() {
    assert_eq!(menu_event_name(WindowRole::Workspace, "quit"), None);
    assert_eq!(menu_event_name(WindowRole::Document, "quit"), None);
}
