/**
 * Collects the machine metadata `D-015` requires a measurement to carry.
 *
 * The harness page can see the WebView and the build profile; it cannot see the
 * machine model, the macOS build, the power source, or whether an unrelated
 * heavy application is competing for the CPU. Those come from here, run on the
 * measuring machine at measurement time, and the verifier refuses an artifact
 * that arrives without them.
 *
 * Usage:
 *   node scripts/editor-perf-environment.mjs > artifacts/editor-perf/environment.json
 *
 * Every field records what the command actually returned. A command that is
 * unavailable yields `null` and an entry in `unavailable`, never a guess: an
 * invented macOS version in a measurement record is worse than a missing one.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const unavailable = [];

function run(command, args) {
    try {
        return execFileSync(command, args, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        unavailable.push(`${command} ${args.join(" ")}`);
        return null;
    }
}

function sysctl(key) {
    return run("sysctl", ["-n", key]);
}

/** `Apple M5 Pro` → `{ family: "M", generation: 5 }`; unknown chips yield null. */
function parseAppleSilicon(brand) {
    if (brand === null) return null;
    const match = /Apple\s+M(\d+)/.exec(brand);
    if (match === null) return null;
    return { chip: brand, generation: Number(match[1]) };
}

/** AC vs battery. `D-015` requires mains power. */
function powerSource() {
    const output = run("pmset", ["-g", "ps"]);
    if (output === null) return null;
    if (output.includes("AC Power")) return "ac";
    if (output.includes("Battery Power")) return "battery";
    return "unknown";
}

/** The heaviest processes at collection time, so "unrelated apps closed" is checkable. */
function topProcesses() {
    const output = run("ps", ["-Ao", "pcpu,rss,comm", "-r"]);
    if (output === null) return null;
    return output
        .split("\n")
        .slice(1, 11)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

/** WebKit's own bundle version, when the framework exposes it. */
function webKitVersion() {
    const candidates = [
        "/System/Library/Frameworks/WebKit.framework/Resources/Info.plist",
        "/System/Library/Frameworks/WebKit.framework/Versions/A/Resources/Info.plist",
    ];
    for (const path of candidates) {
        const value = run("defaults", ["read", path, "CFBundleVersion"]);
        if (value !== null) return { path, version: value };
    }
    return null;
}

function gitValue(args) {
    return run("git", ["-C", REPO_ROOT, ...args]);
}

function tauriVersion() {
    try {
        const config = JSON.parse(
            readFileSync(join(REPO_ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
        );
        return { productName: config.productName, version: config.version };
    } catch {
        unavailable.push("src-tauri/tauri.conf.json");
        return null;
    }
}

const brand = sysctl("machdep.cpu.brand_string");
const memoryBytes = sysctl("hw.memsize");
const status = gitValue(["status", "--porcelain"]);

const environment = {
    schema: "mdx-editor-qualification-environment/1",
    collectedAtIso: new Date().toISOString(),
    machine: {
        model: sysctl("hw.model"),
        chipBrand: brand,
        appleSilicon: parseAppleSilicon(brand),
        logicalCores: sysctl("hw.logicalcpu"),
        physicalCores: sysctl("hw.physicalcpu"),
        memoryBytes: memoryBytes === null ? null : Number(memoryBytes),
        memoryGiB:
            memoryBytes === null
                ? null
                : Math.round((Number(memoryBytes) / 1024 ** 3) * 10) / 10,
    },
    os: {
        productName: run("sw_vers", ["-productName"]),
        productVersion: run("sw_vers", ["-productVersion"]),
        buildVersion: run("sw_vers", ["-buildVersion"]),
        kernel: run("uname", ["-v"]),
    },
    webKit: webKitVersion(),
    power: {
        source: powerSource(),
        thermal: run("pmset", ["-g", "therm"]),
    },
    load: {
        uptime: run("uptime", []),
        topProcesses: topProcesses(),
    },
    app: {
        commit: gitValue(["rev-parse", "HEAD"]),
        branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
        workingTreeClean: status === null ? null : status.length === 0,
        workingTreeChanges: status === null ? null : status.split("\n").filter(Boolean),
        tauri: tauriVersion(),
    },
    /**
     * Facts no command can establish. The operator fills these in before the
     * verifier will accept the run; it refuses on any that is still null.
     */
    attestations: {
        /** DevTools were not open at any point during the run. */
        devToolsClosed: null,
        /** The build under test was produced by `npm run build:app`, not `next dev`. */
        releaseBuild: null,
        /** Unrelated heavy applications were closed before the run. */
        unrelatedAppsClosed: null,
        /**
         * Required only when `machine.appleSilicon.generation` is below 5.
         * `D-015` allows a Mac "no slower than" the M5 baseline; a slower one
         * needs a recorded ruling, and this names it.
         */
        hardwareJustification: null,
        operator: null,
    },
    unavailable,
};

process.stdout.write(`${JSON.stringify(environment, null, 4)}\n`);
