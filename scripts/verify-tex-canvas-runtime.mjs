import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

import { launchChromium } from "./playwright-launch.mjs";

const HOST = "127.0.0.1";
const PORT = process.env.PORT ?? "3000";
const URL = `http://${HOST}:${PORT}/tex-canvas-runtime`;

const server = spawn(
    "npm",
    ["run", "dev", "--", "--hostname", HOST, "--port", PORT],
    {
        stdio: ["ignore", "pipe", "pipe"],
    },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
});

async function waitForServer(page) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
            await page.goto(URL, {
                waitUntil: "domcontentloaded",
                timeout: 1_000,
            });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    throw new Error(`dev server did not start on ${URL}\n${serverOutput}`);
}

const browser = await launchChromium();
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await waitForServer(page);

    await page.waitForSelector("[data-tex-dom-text-layer]", { timeout: 10_000 });

    const hiddenRootCount = await page.locator("[data-mdx-editor-root]").count();
    if (hiddenRootCount !== 0) {
        throw new Error(`hidden ProseMirror product root found: ${hiddenRootCount}`);
    }

    const editableRun = page
        .locator("[data-tex-dom-text-layer] [contenteditable='true']")
        .nth(1);
    await editableRun.waitFor({ timeout: 10_000 });
    const runBox = await editableRun.boundingBox();
    if (!runBox) {
        throw new Error("editable text run is not visible");
    }
    await editableRun.click({
        position: {
            x: Math.max(runBox.width - 1, 1),
            y: Math.max(runBox.height / 2, 1),
        },
    });
    await page.keyboard.type("runtime ");

    const expectedMarkdown =
        "# Runtime Fixture\n\nPlain text with runtime $x^2$ inline math.\n\n```mermaid\ngraph TD\n  A --> B\n```";
    await page.waitForFunction(
        (expected) =>
            document
                .querySelector("[data-tex-runtime-markdown]")
                ?.textContent?.trim() === expected,
        expectedMarkdown,
        { timeout: 10_000 },
    );

    mkdirSync("artifacts", { recursive: true });
    await page.screenshot({
        path: "artifacts/tex-canvas-runtime.png",
        fullPage: true,
    });

    console.log("tex canvas runtime: PASS");
} finally {
    await browser.close();
    server.kill("SIGTERM");
}
