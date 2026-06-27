import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve("packages/mdx-editor/react/wasm/layout-core");
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
    "npx",
    [
        "wasm-pack",
        "build",
        "src-tauri/crates/layout-core",
        "--target",
        "web",
        "--release",
        "--out-dir",
        "../../../packages/mdx-editor/react/wasm/layout-core",
    ],
    { stdio: "inherit" },
);

if (result.status !== 0) {
    throw new Error("layout wasm build failed");
}

rmSync(resolve(outDir, ".gitignore"), { force: true });
