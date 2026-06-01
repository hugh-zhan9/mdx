// Centralized lazy access to @tauri-apps/* modules. Each getter returns a
// cached Promise so the dynamic chunk is fetched at most once per module,
// and call sites read like `const { invoke } = await tauriCore()`.

import type * as Core from "@tauri-apps/api/core";
import type * as Dialog from "@tauri-apps/plugin-dialog";
import type * as Process from "@tauri-apps/plugin-process";

let _core: Promise<typeof Core> | null = null;
let _dialog: Promise<typeof Dialog> | null = null;
let _process: Promise<typeof Process> | null = null;

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

export function tauriProcess(): Promise<typeof Process> {
    if (!_process) {
        _process = import(
            /* webpackChunkName: "tauri-process" */ "@tauri-apps/plugin-process"
        );
    }
    return _process;
}
