import { tauriCore } from "@/common/lib/tauri";
import { tauriWindow } from "@/common/lib/tauri";
import type { WatchStartResult, WatchStopResult } from "./types";

export async function startWorkspaceWatch(rootPath: string) {
    const { invoke } = await tauriCore();
    const { getCurrentWindow } = await tauriWindow();

    return invoke<WatchStartResult>("watch_start_workspace", {
        rootPath,
        windowLabel: getCurrentWindow().label,
    });
}

export async function startDocumentWatch(realPath: string) {
    const { invoke } = await tauriCore();
    const { getCurrentWindow } = await tauriWindow();

    return invoke<WatchStartResult>("watch_start_document", {
        realPath,
        windowLabel: getCurrentWindow().label,
    });
}

export async function stopWatch(watchId: string) {
    const { invoke } = await tauriCore();

    return invoke<WatchStopResult>("watch_stop", { watchId });
}
