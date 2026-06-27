import { spawn } from "node:child_process";
import { launchChromium } from "./playwright-launch.mjs";

const HOST = "127.0.0.1";
const PORT = process.env.PORT ?? "3000";
const URL =
    process.env.EDITOR_RUNTIME_URL ??
    `http://${HOST}:${PORT}/tex-canvas-runtime`;
const FRAME_BUDGET_MS = Number(process.env.EDITOR_FRAME_BUDGET_MS ?? "8.3");
const shouldStartServer = process.env.EDITOR_RUNTIME_URL === undefined;

const server = shouldStartServer
    ? spawn(
          "npm",
          ["run", "dev", "--", "--hostname", HOST, "--port", PORT],
          { stdio: ["ignore", "pipe", "pipe"] },
      )
    : null;

let serverOutput = "";
server?.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
});
server?.stderr.on("data", (chunk) => {
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    if (shouldStartServer) {
        await waitForServer(page);
    } else {
        await page.goto(URL, { waitUntil: "networkidle" });
    }
    await page.waitForSelector("[data-tex-dom-text-layer]", { timeout: 10_000 });

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

    const result = await page.evaluate(async () => {
        const host = document.querySelector("[data-hybrid-editor-host]");
        const textLayer = document.querySelector("[data-tex-dom-text-layer]");
        const canvasLayer = document.querySelector("[data-layout-canvas-layer]");
        if (!host || !textLayer) {
            throw new Error("tex canvas editor layers are not ready");
        }

        const frames = [];

        for (let index = 0; index < 120; index += 1) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const started = performance.now();
            host.getBoundingClientRect();
            textLayer.getBoundingClientRect();
            canvasLayer?.getBoundingClientRect();
            frames.push(performance.now() - started);
        }

        frames.sort((left, right) => left - right);
        return {
            max: frames[frames.length - 1],
            p50: frames[Math.floor(frames.length * 0.5)],
            p95: frames[Math.floor(frames.length * 0.95)],
        };
    });

    if (result.p95 > FRAME_BUDGET_MS) {
        throw new Error(
            `editor frame budget exceeded: p95=${result.p95.toFixed(2)}ms budget=${FRAME_BUDGET_MS.toFixed(2)}ms`,
        );
    }

    console.log(
        `tex canvas runtime frames: PASS p50=${result.p50.toFixed(2)} p95=${result.p95.toFixed(2)} max=${result.max.toFixed(2)} budget=${FRAME_BUDGET_MS.toFixed(2)}`,
    );
} finally {
    await browser.close();
    server?.kill("SIGTERM");
}
