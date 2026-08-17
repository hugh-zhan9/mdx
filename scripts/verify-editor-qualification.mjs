/**
 * The `D-015` / `AC-014` gate over a raw measurement artifact.
 *
 * This script decides nothing about performance. It decides whether a
 * measurement is *admissible*, and only then whether the admissible numbers
 * clear `AC-014`. Everything `D-015` says would invalidate a run is a refusal
 * here, not a footnote on a number that looks fine:
 *
 *   - a run that was not a release-like Tauri build with release web assets
 *   - a run whose fixtures are not byte-identical to the committed pin
 *   - fewer than 200 valid input samples, or fewer than 200 valid IME samples,
 *     on either fixture
 *   - fewer than 20 valid mode switches in either direction, after warm-up
 *   - a machine, macOS build, power state, app commit or operator attestation
 *     that is missing
 *   - a WebView with no Long Tasks API, which cannot produce the long-task
 *     measurement `AC-014` names
 *
 * Any of those exits non-zero with the reason. A threshold is only ever
 * reported against a p95 computed by nearest rank over the valid samples; no
 * mean is computed anywhere in this file.
 *
 * Usage:
 *   node scripts/verify-editor-qualification.mjs <artifact.json> --environment <environment.json>
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PIN_PATH = join(
    REPO_ROOT,
    "docs",
    "loopx",
    "design",
    "2026-08-12-milkdown-editor-migration",
    "P-007-fixture-checksums.json",
);

const ARTIFACT_SCHEMA = "mdx-editor-qualification/1";
const ENVIRONMENT_SCHEMA = "mdx-editor-qualification-environment/1";

/** `AC-014`, verbatim. Milliseconds. */
const THRESHOLDS = {
    firstEditable: { "mixed-100kib": 500, "mixed-1mib": 2000 },
    inputP95: 50,
    imeP95: 50,
    modeSwitch: { "mixed-100kib": 1000 },
    longTask: { "mixed-1mib": 100 },
};

const REQUIRED_INPUT_SAMPLES = 200;
const REQUIRED_IME_SAMPLES = 200;
const REQUIRED_MODE_SWITCHES = 20;

/** The `D-015` baseline machine. A slower Apple Silicon Mac needs a ruling. */
const BASELINE_APPLE_SILICON_GENERATION = 5;
const BASELINE_MEMORY_GIB = 16;

const refusals = [];
const failures = [];
const lines = [];

function refuse(reason) {
    refusals.push(reason);
}

function readJson(path, label) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        refuse(`${label} could not be read from ${path}: ${String(error)}`);
        return null;
    }
}

/** Nearest-rank percentile. Never interpolates, and never returns a mean. */
function percentile(values, fraction) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.ceil(fraction * sorted.length);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function maximum(values) {
    return values.length === 0 ? null : values.reduce((a, b) => Math.max(a, b));
}

function validDurations(samples, predicate) {
    return samples
        .filter(
            (sample) =>
                predicate(sample) &&
                sample.valid === true &&
                sample.warmup !== true &&
                typeof sample.ms === "number" &&
                Number.isFinite(sample.ms) &&
                sample.ms >= 0,
        )
        .map((sample) => sample.ms);
}

const argv = process.argv.slice(2);
const positional = argv.filter((value) => !value.startsWith("--"));
const environmentIndex = argv.indexOf("--environment");
const environmentPath = environmentIndex >= 0 ? argv[environmentIndex + 1] : null;

if (positional.length === 0) {
    console.error(
        "usage: node scripts/verify-editor-qualification.mjs <artifact.json> --environment <environment.json>",
    );
    process.exit(2);
}

const artifact = readJson(resolve(positional[0]), "measurement artifact");
const environment =
    environmentPath === null
        ? (refuse("no --environment file was supplied; D-015 requires machine metadata"), null)
        : readJson(resolve(environmentPath), "environment metadata");
const pin = readJson(PIN_PATH, "fixture checksum pin");

// --- Admissibility -------------------------------------------------------

if (artifact !== null) {
    if (artifact.schema !== ARTIFACT_SCHEMA) {
        refuse(
            `artifact schema is ${String(artifact.schema)}; this verifier only understands ${ARTIFACT_SCHEMA}`,
        );
    }
    if (artifact.qualifying !== true) {
        for (const reason of artifact.disqualifications ?? ["artifact is not marked qualifying"]) {
            refuse(`run is not qualifying: ${String(reason)}`);
        }
    }
    if (!Array.isArray(artifact.samples) || artifact.samples.length === 0) {
        refuse("artifact carries no samples");
    }
}

if (environment !== null) {
    if (environment.schema !== ENVIRONMENT_SCHEMA) {
        refuse(
            `environment schema is ${String(environment.schema)}; expected ${ENVIRONMENT_SCHEMA}`,
        );
    }
    const machine = environment.machine ?? {};
    const os = environment.os ?? {};
    const app = environment.app ?? {};
    const attestations = environment.attestations ?? {};

    if (typeof os.productVersion !== "string" || os.productVersion.length === 0) {
        refuse("environment does not record the macOS version");
    }
    if (typeof app.commit !== "string" || app.commit.length !== 40) {
        refuse("environment does not record a full app commit sha");
    }
    if (app.workingTreeClean !== true) {
        refuse(
            "the working tree was not clean when the environment was collected; the recorded commit does not describe the build",
        );
    }
    if (environment.power?.source !== "ac") {
        refuse(
            `machine was on ${String(environment.power?.source)} power; D-015 requires mains power`,
        );
    }
    if (machine.appleSilicon === null || machine.appleSilicon === undefined) {
        refuse(
            `machine chip ${String(machine.chipBrand)} is not recognised as Apple Silicon`,
        );
    } else if (machine.appleSilicon.generation < BASELINE_APPLE_SILICON_GENERATION) {
        if (
            typeof attestations.hardwareJustification !== "string" ||
            attestations.hardwareJustification.length === 0
        ) {
            refuse(
                `machine is ${String(machine.chipBrand)}, below the M${String(BASELINE_APPLE_SILICON_GENERATION)} baseline, and no hardwareJustification ruling is recorded`,
            );
        }
    }
    if (typeof machine.memoryGiB === "number" && machine.memoryGiB < BASELINE_MEMORY_GIB) {
        refuse(
            `machine has ${String(machine.memoryGiB)} GiB; the D-015 baseline is ${String(BASELINE_MEMORY_GIB)} GiB`,
        );
    }
    for (const key of ["devToolsClosed", "releaseBuild", "unrelatedAppsClosed"]) {
        if (attestations[key] !== true) {
            refuse(`operator attestation \`${key}\` is not true`);
        }
    }
    if (typeof attestations.operator !== "string" || attestations.operator.length === 0) {
        refuse("no operator is recorded on the environment metadata");
    }
}

// --- Fixtures ------------------------------------------------------------

if (artifact !== null && pin !== null) {
    const pinned = new Map((pin.fixtures ?? []).map((entry) => [entry.id, entry]));
    const measured = new Map((artifact.fixtures ?? []).map((entry) => [entry.id, entry]));
    for (const [id, entry] of pinned) {
        const found = measured.get(id);
        if (found === undefined) {
            refuse(`artifact does not carry fixture ${id}`);
            continue;
        }
        if (found.sha256 !== entry.sha256) {
            refuse(
                `fixture ${id} was measured at sha256 ${String(found.sha256)} but the committed pin is ${String(entry.sha256)}`,
            );
        }
        if (found.bytes !== entry.bytes) {
            refuse(
                `fixture ${id} was measured at ${String(found.bytes)} bytes but the pin is ${String(entry.bytes)}`,
            );
        }
    }
}

// --- Sample sufficiency and thresholds -----------------------------------

const results = [];

if (artifact !== null && Array.isArray(artifact.samples)) {
    const samples = artifact.samples;
    const fixtureIds = Object.keys(THRESHOLDS.firstEditable);

    for (const fixtureId of fixtureIds) {
        const onFixture = (phase) => (sample) =>
            sample.phase === phase && sample.fixtureId === fixtureId;

        // First editable: mount mark to the first frame after `onReady`. The
        // slowest cold mount is what is measured against the threshold; a run
        // that reported its best mount would be choosing its own number.
        const firstEditable = validDurations(samples, onFixture("first-editable"));
        if (firstEditable.length === 0) {
            refuse(`no valid first-editable sample for ${fixtureId}`);
        } else {
            results.push({
                metric: `first-editable (slowest of ${String(firstEditable.length)})`,
                fixtureId,
                value: maximum(firstEditable),
                threshold: THRESHOLDS.firstEditable[fixtureId],
                median: percentile(firstEditable, 0.5),
            });
        }

        // Only real key events count. `D-015` anchors input latency on
        // `beforeinput`, and a script cannot make an engine dispatch one:
        // Chromium's `document.execCommand("insertText")` inserts the character
        // and fires only `input`, which starts the clock after the DOM has
        // already changed. Those scripted samples are in the artifact as a
        // regression signal and are reported below, but they are never the gate.
        const input = validDurations(
            samples,
            (sample) =>
                onFixture("input-latency")(sample) &&
                sample.driver === "user" &&
                sample.anchor === "beforeinput",
        );
        const scripted = validDurations(
            samples,
            (sample) =>
                onFixture("input-latency")(sample) && sample.driver === "execCommand",
        );
        if (scripted.length > 0) {
            results.push({
                metric: `[not counted] scripted insert p95 (n=${String(scripted.length)})`,
                fixtureId,
                value: percentile(scripted, 0.95),
                threshold: null,
                median: percentile(scripted, 0.5),
            });
        }
        if (input.length < REQUIRED_INPUT_SAMPLES) {
            refuse(
                `only ${String(input.length)} valid \`beforeinput\`-anchored input samples on ${fixtureId}; ` +
                    `D-015 requires ${String(REQUIRED_INPUT_SAMPLES)}. Scripted insertions do not count: ` +
                    "only a real key event produces the `beforeinput` the contract measures from.",
            );
        } else {
            results.push({
                metric: `input latency p95 (n=${String(input.length)})`,
                fixtureId,
                value: percentile(input, 0.95),
                threshold: THRESHOLDS.inputP95,
                median: percentile(input, 0.5),
            });
        }

        const ime = validDurations(
            samples,
            (sample) =>
                onFixture("ime-latency")(sample) &&
                sample.driver === "user" &&
                sample.anchor === "compositionend",
        );
        if (ime.length < REQUIRED_IME_SAMPLES) {
            refuse(
                `only ${String(ime.length)} valid IME composition samples on ${fixtureId}; D-015 requires ${String(REQUIRED_IME_SAMPLES)}. ` +
                    "These cannot be produced by script: a real input method has to be driven by a person.",
            );
        } else {
            results.push({
                metric: `IME commit latency p95 (n=${String(ime.length)})`,
                fixtureId,
                value: percentile(ime, 0.95),
                threshold: THRESHOLDS.imeP95,
                median: percentile(ime, 0.5),
            });
        }

        for (const direction of ["wysiwyg->source", "source->wysiwyg"]) {
            const switches = validDurations(
                samples,
                (sample) =>
                    sample.phase === "mode-switch" &&
                    sample.fixtureId === fixtureId &&
                    sample.direction === direction,
            );
            if (switches.length < REQUIRED_MODE_SWITCHES) {
                refuse(
                    `only ${String(switches.length)} valid ${direction} mode switches on ${fixtureId}; D-015 requires ${String(REQUIRED_MODE_SWITCHES)} after warm-up`,
                );
                continue;
            }
            const threshold = THRESHOLDS.modeSwitch[fixtureId];
            results.push({
                metric: `mode switch ${direction} slowest (n=${String(switches.length)})`,
                fixtureId,
                value: maximum(switches),
                threshold: threshold ?? null,
                median: percentile(switches, 0.5),
            });
        }
    }

    // Long tasks. `AC-014` names the 1 MiB fixture, and the measurement is
    // `PerformanceObserver` over 30 seconds of scrolling. A WebView without
    // that entry type cannot produce it, and a frame-gap substitute is a
    // different measurement, which is a `spec` decision rather than this
    // script's to make.
    if (artifact.environment?.longTaskObserverSupported !== true) {
        refuse(
            "the WebView does not support the `longtask` PerformanceObserver entry type, so the AC-014 long-task measurement was not taken. " +
                "Substituting the recorded frame-gap figure would change the measurement definition, which D-015 reserves for a spec ruling.",
        );
    } else {
        for (const [fixtureId, threshold] of Object.entries(THRESHOLDS.longTask)) {
            const scrolled = (artifact.samples ?? []).some(
                (sample) =>
                    sample.phase === "long-task-scroll" &&
                    sample.fixtureId === fixtureId &&
                    sample.valid === true,
            );
            if (!scrolled) {
                refuse(`no valid 30-second scroll observation on ${fixtureId}`);
                continue;
            }
            const durations = (artifact.longTasks ?? [])
                .filter((entry) => entry.fixtureId === fixtureId)
                .map((entry) => entry.duration);

            // Cross-check the observation against the frame gaps recorded over
            // the same 30 seconds. Any task of 50 ms or more must produce a
            // long-task entry, so a frame gap at or above the threshold with no
            // entry at all means the observer did not see what happened — a
            // disconnect that dropped queued entries, or an entry type that
            // reports nothing. Reporting "0 ms, pass" from that would be a
            // number that looks fine and measures nothing.
            const gap = (artifact.scrollFrameGaps ?? []).find(
                (entry) => entry.fixtureId === fixtureId,
            );
            if (
                durations.length === 0 &&
                typeof gap?.maxGapMs === "number" &&
                gap.maxGapMs >= threshold
            ) {
                refuse(
                    `no long-task entry was recorded on ${fixtureId}, but the scroll phase saw a ` +
                        `${gap.maxGapMs.toFixed(0)} ms gap between animation frames. A task that long must ` +
                        "emit a long-task entry, so the observation is not trustworthy.",
                );
                continue;
            }

            results.push({
                metric: `longest main-thread long task (n=${String(durations.length)})`,
                fixtureId,
                value: durations.length === 0 ? 0 : maximum(durations),
                threshold,
                median: durations.length === 0 ? 0 : percentile(durations, 0.5),
            });
        }
    }
}

// --- Report --------------------------------------------------------------

for (const result of results) {
    const value = result.value;
    const over =
        result.threshold !== null &&
        typeof value === "number" &&
        value >= result.threshold;
    if (over) {
        failures.push(
            `${result.fixtureId} ${result.metric}: ${value.toFixed(2)} ms exceeds the ${String(result.threshold)} ms AC-014 threshold`,
        );
    }
    lines.push(
        `  ${over ? "FAIL" : result.threshold === null ? "----" : "ok  "} ` +
            `${result.fixtureId.padEnd(13)} ${result.metric.padEnd(46)} ` +
            `${typeof value === "number" ? `${value.toFixed(2)} ms` : "n/a"}` +
            `${result.threshold === null ? "" : ` (< ${String(result.threshold)} ms)`}` +
            `${typeof result.median === "number" ? `  [median ${result.median.toFixed(2)} ms]` : ""}`,
    );
}

if (lines.length > 0) {
    console.log("AC-014 measurements:");
    for (const line of lines) console.log(line);
}

if (refusals.length > 0) {
    console.error("\neditor qualification: REFUSED — this run cannot be reported as a pass");
    for (const reason of refusals) console.error(`  - ${reason}`);
}
if (failures.length > 0) {
    console.error("\neditor qualification: THRESHOLD FAILURES");
    for (const failure of failures) console.error(`  - ${failure}`);
}

if (refusals.length > 0 || failures.length > 0) {
    process.exit(1);
}

console.log("\neditor qualification: PASS (every AC-014 threshold met on an admissible run)");
