#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetTriple =
  process.env.TAURI_TARGET_TRIPLE ||
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
const profile =
  process.env.TAURI_SIDECAR_PROFILE ||
  (process.env.NODE_ENV === "development" ? "debug" : "release");

const explicitTarget = Boolean(
  process.env.TAURI_TARGET_TRIPLE ||
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    process.env.CARGO_BUILD_TARGET,
);
const sourceDir = explicitTarget
  ? join(root, "src-tauri", "target", targetTriple, profile)
  : join(root, "src-tauri", "target", profile);
const outputDir = join(root, "src-tauri", "binaries");

for (const name of ["loam-cli", "loam-mcp"]) {
  const result = spawnSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--bin",
      name,
      ...(explicitTarget ? ["--target", targetTriple] : []),
      ...(profile === "release" ? ["--release"] : []),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
      },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

mkdirSync(outputDir, { recursive: true });

for (const name of ["loam-cli", "loam-mcp"]) {
  const source = join(sourceDir, name);
  if (!existsSync(source)) {
    throw new Error(
      `Missing ${source}. Build it first with: cargo build --manifest-path src-tauri/Cargo.toml --bin ${name}${profile === "release" ? " --release" : ""}`,
    );
  }

  const destination = join(outputDir, `${name}-${targetTriple}`);
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
  console.log(`${destination}`);
}
