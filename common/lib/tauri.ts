// Centralized lazy access to @tauri-apps/* modules. Each getter returns a
// cached Promise so the dynamic chunk is fetched at most once per module,
// and call sites read like `const { invoke } = await tauriCore()`.

import type * as Core from "@tauri-apps/api/core";
import type * as Dialog from "@tauri-apps/plugin-dialog";
import type * as Window from "@tauri-apps/api/window";

let _core: Promise<typeof Core> | null = null;
let _dialog: Promise<typeof Dialog> | null = null;
let _window: Promise<typeof Window> | null = null;

export function tauriCore(): Promise<typeof Core> {
    if (!_core) {
        _core = import(
            /* webpackChunkName: "tauri-core" */ "@tauri-apps/api/core"
        );
    }
    return _core;
}

export function tauriDialog(): Promise<typeof Dialog> {
    if (!_dialog) {
        _dialog = import(
            /* webpackChunkName: "tauri-dialog" */ "@tauri-apps/plugin-dialog"
        );
    }
    return _dialog;
}

export function tauriWindow(): Promise<typeof Window> {
    if (!_window) {
        _window = import(
            /* webpackChunkName: "tauri-window" */ "@tauri-apps/api/window"
        );
    }
    return _window;
}
