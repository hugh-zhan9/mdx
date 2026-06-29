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
    await editableRun.evaluate((run) => {
        run.textContent = `${run.textContent ?? ""}runtime `;
        run.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });

    const expectedMarkdown = [
        "# Runtime Fixture",
        "",
        "Plain text with runtime $x^2$ inline math.",
        "",
        "[Runtime link](https://example.com)",
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
        "$$",
        "\\int_0^1 x^2 dx = \\frac{1}{3}",
        "$$",
        "",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "",
        '<div class="custom-block">',
        "  <p>Runtime HTML</p>",
        "</div>",
    ].join("\n");
    await page.waitForFunction(
        (expected) =>
            document
                .querySelector("[data-tex-runtime-markdown]")
                ?.textContent?.trim() === expected,
        expectedMarkdown,
        { timeout: 10_000 },
    );
    await page.waitForSelector("[data-mdx-node-type='code_block']", {
        timeout: 10_000,
    });
    await page.waitForSelector(".katex", { timeout: 10_000 });
    await page.waitForSelector("[data-mdx-mermaid-preview]", { timeout: 10_000 });
    await page.waitForSelector(
        "[data-mdx-node-type='source_fallback'] .custom-block",
        { timeout: 10_000 },
    );

    const linkStyle = await page
        .locator("[data-hybrid-editor-host] a[data-mdx-node-type='link']")
        .first()
        .evaluate((link) => {
            const style = getComputedStyle(link);
            return {
                color: style.color,
                textDecorationLine: style.textDecorationLine,
            };
        });
    if (!linkStyle.textDecorationLine.includes("underline")) {
        throw new Error(
            `runtime link is not styled as a link: ${JSON.stringify(linkStyle)}`,
        );
    }

    const overlaps = await page.evaluate(() => {
        const rects = (selector) =>
            Array.from(document.querySelectorAll(selector)).map((node) => {
                const rect = node.getBoundingClientRect();
                return {
                    id:
                        node.getAttribute("data-layout-run-id") ??
                        node.getAttribute("data-layout-complex-block-overlay") ??
                        "",
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                };
            });
        const overlays = rects("[data-layout-complex-block-overlay]");
        const runs = rects("[data-layout-dom-text-layer] [data-layout-run-id]");

        return overlays.flatMap((overlay) =>
            runs
                .filter((run) => {
                    const horizontal =
                        Math.min(overlay.right, run.right) -
                        Math.max(overlay.left, run.left);
                    const vertical =
                        Math.min(overlay.bottom, run.bottom) -
                        Math.max(overlay.top, run.top);
                    return horizontal > 1 && vertical > 1;
                })
                .map((run) => ({ overlay: overlay.id, run: run.id })),
        );
    });
    if (overlaps.length > 0) {
        throw new Error(
            `text runs overlap complex block overlays: ${JSON.stringify(overlaps)}`,
        );
    }

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
