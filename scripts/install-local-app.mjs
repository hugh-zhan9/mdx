#!/usr/bin/env node

import { existsSync, rmSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceApp = resolve(
  root,
  process.env.LOAM_BUILT_APP ??
    "src-tauri/target/release/bundle/macos/Loam.app",
);
const destinationApp = resolve(
  process.env.LOAM_INSTALL_APP ?? "/Applications/Loam.app",
);

if (!existsSync(sourceApp)) {
  throw new Error(
    `Built app not found at ${sourceApp}. Run npm run build:app first.`,
  );
}

spawnSync("osascript", ["-e", 'tell application "Loam" to quit'], {
  stdio: "ignore",
});

rmSync(destinationApp, { recursive: true, force: true });
cpSync(sourceApp, destinationApp, {
  recursive: true,
  preserveTimestamps: true,
});

spawnSync("xattr", ["-dr", "com.apple.quarantine", destinationApp], {
  stdio: "ignore",
});

const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", destinationApp], {
  stdio: "inherit",
});
if (sign.status !== 0) {
  process.exit(sign.status ?? 1);
}

const verify = spawnSync(
  "codesign",
  ["--verify", "--deep", "--strict", destinationApp],
  { stdio: "inherit" },
);
if (verify.status !== 0) {
  process.exit(verify.status ?? 1);
}

console.log(`Installed ${sourceApp} -> ${destinationApp}`);
