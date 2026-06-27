import { existsSync } from "node:fs";

import { chromium } from "@playwright/test";

const LOCAL_CHROMIUM_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export async function launchChromium(options = {}) {
    try {
        return await chromium.launch(options);
    } catch (error) {
        const executablePath =
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
            LOCAL_CHROMIUM_PATHS.find((candidate) => existsSync(candidate));

        if (!executablePath) {
            throw error;
        }

        return chromium.launch({
            ...options,
            executablePath,
        });
    }
}
