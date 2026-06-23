import { Plugin, PluginKey } from "prosemirror-state";

export const sourceFallbackPluginKey = new PluginKey("sourceFallback");

export function sourceFallbackPlugin() {
    return new Plugin({
        key: sourceFallbackPluginKey,
    });
}
