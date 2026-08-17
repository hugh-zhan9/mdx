/**
 * Development smoke run of the `D-015` harness.
 *
 * This drives the qualification route in a desktop Chromium so the protocol can
 * be exercised in CI or on a laptop without building the app. It is *not* a
 * qualifying measurement and cannot be turned into one: the artifact it writes
 * carries the disqualifications the page stamps on it — development web assets,
 * a browser instead of the Tauri WebView, and (with `--smoke`) sample counts
 * below every `D-015` minimum. Feeding its output to
 * `scripts/verify-editor-qualification.mjs` is expected to exit non-zero, and
 * that refusal is the check that the gate works.
 *
 * The real measurement is taken by a person, in a release-like Tauri build, at
 * `/mdx-editor-qualification`. See
 * `docs/loopx/design/2026-08-12-milkdown-editor-migration/P-007-performance-measurement-procedure.md`.
 *
 * Usage:
 *   node scripts/measure-editor-qualification.mjs [--smoke] [--out <path>]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchChromium } from "./playwright-launch.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = process.env.PORT ?? "3210";
const argv = process.argv.slice(2);
const smoke = argv.includes("--smoke");
const outIndex = argv.indexOf("--out");
const OUT_PATH =
    outIndex >= 0
        ? resolve(argv[outIndex + 1])
        : join(REPO_ROOT, "artifacts", "editor-perf", "dev-smoke-artifact.json");

const URL = `http://${HOST}:${PORT}/mdx-editor-qualification${smoke ? "?smoke=1" : ""}`;
const TIMEOUT_MS = Number(process.env.QUALIFICATION_TIMEOUT_MS ?? (smoke ? 300_000 : 1_800_000));

const server = spawn("npm", ["run", "dev", "--", "--hostname", HOST, "--port", PORT], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION: "1" },
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
});

async function waitForServer(page) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 2_000 });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
    throw new Error(`dev server did not start on ${URL}\n${serverOutput}`);
}

const browser = await launchChromium();
let exitCode = 0;
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => {
        console.error(`page error: ${error.message}`);
    });
    await waitForServer(page);

    try {
        await page.waitForSelector("[data-mdx-qualification-harness]", {
            timeout: 30_000,
        });
    } catch {
        throw new Error(
            "the qualification route rendered inert; NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION was not seen by the build",
        );
    }

    // The editor has to be built before the protocol starts; the first mount is
    // the 100 KiB fixture and it is not measured by this wait.
    await page.waitForSelector("[data-mdx-markdown-editor]", { timeout: 120_000 });
    await page.waitForFunction(
        () => document.querySelectorAll("[contenteditable='true']").length > 0,
        undefined,
        { timeout: 120_000 },
    );

    await page.evaluate(() => {
        const api = window.__mdxQualification;
        if (api === undefined) throw new Error("harness runner was not exposed");
        void api.run();
    });

    await page.waitForFunction(
        () => {
            const node = document.querySelector("[data-qualification-status]");
            const status = node?.getAttribute("data-qualification-status") ?? "";
            return status === "done" || status.startsWith("failed");
        },
        undefined,
        { timeout: TIMEOUT_MS, polling: 1_000 },
    );

    const artifact = await page.evaluate(() => window.__mdxQualificationArtifact ?? null);
    if (artifact === null) throw new Error("harness produced no artifact");

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    const counts = {};
    for (const sample of artifact.samples) {
        const key =
            `${sample.fixtureId}/${sample.phase}` +
            `${sample.direction ? `/${sample.direction}` : ""}` +
            `${sample.anchor ? ` [${sample.driver}:${sample.anchor}]` : ""}`;
        counts[key] ??= { valid: 0, invalid: 0 };
        if (sample.valid && !sample.warmup) counts[key].valid += 1;
        else if (!sample.valid) counts[key].invalid += 1;
    }
    console.log(`artifact written to ${OUT_PATH}`);
    for (const [key, value] of Object.entries(counts)) {
        console.log(`  ${key.padEnd(48)} valid=${value.valid} invalid=${value.invalid}`);
    }
    console.log("");
    console.log("THIS RUN IS NOT A QUALIFYING MEASUREMENT. Recorded disqualifications:");
    for (const reason of artifact.disqualifications) console.log(`  - ${reason}`);
} catch (error) {
    console.error(String(error));
    console.error(serverOutput.slice(-4000));
    exitCode = 1;
} finally {
    await browser.close();
    server.kill("SIGTERM");
}

process.exit(exitCode);
