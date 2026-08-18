"use client";

import { useCallback, useEffect, useState } from "react";

import {
    applyThemePreference,
    readThemePreference,
} from "./theme-preference";
import { setUserThemes } from "./themes";
import {
    applyUserThemesCss,
    cachedUserThemes,
    loadUserThemes,
    type UserThemeEntry,
} from "./user-themes";

/**
 * Keeps the user's own themes loaded.
 *
 * The registry is seeded synchronously from the last run's cache so the first
 * render already agrees with the pre-hydration script, then replaced by a real
 * read of `~/.loam/themes/`. Re-applying the stored preference afterwards is what
 * makes a chosen theme survive the moment its file is confirmed to exist — or
 * fall back, on its own, when it turns out not to.
 */
export function useUserThemes() {
    const [entries, setEntries] = useState<UserThemeEntry[]>([]);
    const [directoryError, setDirectoryError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const loaded = await loadUserThemes();
            setUserThemes(
                loaded.themes.map((theme) => ({
                    id: theme.id,
                    name: theme.name,
                    description: "",
                    appearance: theme.appearance,
                })),
            );
            applyUserThemesCss(loaded.themes);
            setEntries(loaded.entries);
            setDirectoryError(loaded.directoryError);
            // The registry just changed, so the stored preference may resolve
            // differently than it did a moment ago: a theme that now exists
            // should take effect, and one that no longer does should give way to
            // following the system.
            applyThemePreference(readThemePreference());
        } finally {
            setLoading(false);
        }
    }, []);

    // Seeded before the first paint rather than in an effect, because an effect
    // runs after the render whose palette it was supposed to inform.
    useState(() => {
        setUserThemes(cachedUserThemes());
    });

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { entries, directoryError, loading, refresh };
}
