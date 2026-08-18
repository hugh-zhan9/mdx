/**
 * Dependency, import and forbidden-path audit for the Markdown editor
 * migration. Exits non-zero on any violation.
 *
 * The checks, and what each one is protecting:
 *
 *   DEP-1  No Electron in the dependency tree. The behaviour reference is an
 *          Electron app; this product is Tauri and must not have inherited its
 *          runtime. `electron-to-chromium` is a browserslist data table with no
 *          Electron code in it and is explicitly not a hit.
 *   DEP-2  No `@milkdown/plugin-math`. Math is owned by this repo's own syntax
 *          family; the upstream plugin would take the node, the parser and the
 *          serializer with it.
 *   DEP-3  Every `@milkdown/*` package in the installed tree is on one version,
 *          and the direct dependency is pinned to an exact version. Two
 *          Milkdown versions in one process means two ProseMirror schemas.
 *   IMP-1  `features/**` and `app/**` import nothing from Milkdown,
 *          ProseMirror or CodeMirror. The adapter contract is the boundary; a
 *          product file that imports a ProseMirror type has crossed it.
 *   IMP-2  `features/**` and `app/**` do not query implementation-private DOM —
 *          the class names and data attributes the editor package owns.
 *   IMP-3  `features/**` and `app/**` reach `packages/mdx-editor` only through
 *          its public entries. A deep import into `react/`, `layout-ir/` or
 *          `syntax/` is the same boundary violation, spelled differently.
 *   PATH-1 No user-visible old/new editor switch: nothing in navigation or
 *          settings reaches the qualification surface or the harness route.
 *
 * IMP-2 and IMP-3 carry an explicit, file-by-file baseline of what the legacy
 * hybrid surface still does. The baseline fails on anything new *and* on any
 * pin that has gone stale, so it can only ever shrink; it had to be empty
 * before the product entry switch landed, and both baselines are now empty.
 *
 * Usage:
 *   node scripts/audit-editor-boundaries.mjs [--verbose]
 *
 * Every check reports what it scanned, so a check that silently matched
 * nothing is visible rather than reassuring.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");

const violations = [];
const report = [];

function fail(check, message) {
    violations.push(`${check}: ${message}`);
}

function pass(check, message) {
    report.push(`  ok   ${check.padEnd(7)} ${message}`);
}

function listFiles(directory, extensions) {
    const out = [];
    const walk = (current) => {
        let entries;
        try {
            entries = readdirSync(current);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry === "node_modules" || entry.startsWith(".")) continue;
            const full = join(current, entry);
            const stat = statSync(full);
            if (stat.isDirectory()) {
                walk(full);
            } else if (extensions.some((extension) => entry.endsWith(extension))) {
                out.push(full);
            }
        }
    };
    walk(directory);
    return out;
}

// --- Dependency tree -----------------------------------------------------

const lockfile = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const packages = Object.entries(lockfile.packages ?? {});

/** The installed package name for a lockfile path, or null for the root. */
function packageNameOf(path, entry) {
    if (path === "") return null;
    if (typeof entry.name === "string") return entry.name;
    const marker = path.lastIndexOf("node_modules/");
    return marker < 0 ? null : path.slice(marker + "node_modules/".length);
}

const installed = [];
for (const [path, entry] of packages) {
    const name = packageNameOf(path, entry);
    if (name !== null) installed.push({ name, version: entry.version, path });
}

// DEP-1: Electron.
//
// `electron-to-chromium` is a browserslist data table — a mapping from Electron
// releases to Chromium versions — and carries no Electron runtime. Matching on
// it would be a false positive, so the match is on the exact package name and
// on the `electron-*` build tooling, never on a substring.
const ELECTRON_EXACT = new Set([
    "electron",
    "electron-builder",
    "electron-vite",
    "electron-prebuilt",
    "electron-prebuilt-compile",
    "electron-packager",
    "@electron/rebuild",
    "@electron/remote",
    "@electron-forge/cli",
]);
const electronHits = installed.filter((entry) => ELECTRON_EXACT.has(entry.name));
const electronDataTables = installed.filter(
    (entry) => entry.name === "electron-to-chromium",
);
if (electronHits.length > 0) {
    fail(
        "DEP-1",
        `Electron is in the dependency tree: ${electronHits
            .map((entry) => `${entry.name}@${String(entry.version)}`)
            .join(", ")}`,
    );
} else {
    pass(
        "DEP-1",
        `no Electron runtime or build tooling in ${String(installed.length)} installed packages` +
            (electronDataTables.length > 0
                ? ` (electron-to-chromium@${String(electronDataTables[0].version)} present and correctly not counted: browserslist data, no Electron code)`
                : ""),
    );
}

// DEP-2: the upstream math plugin.
const mathPlugin = installed.filter((entry) => entry.name === "@milkdown/plugin-math");
if (mathPlugin.length > 0) {
    fail(
        "DEP-2",
        `@milkdown/plugin-math is installed at ${mathPlugin
            .map((entry) => String(entry.version))
            .join(", ")}; math is owned by packages/mdx-editor/syntax/milkdown/math`,
    );
} else {
    pass("DEP-2", "@milkdown/plugin-math is absent from the installed tree");
}

// DEP-3: one Milkdown version, pinned.
const milkdown = installed.filter((entry) => entry.name.startsWith("@milkdown/"));
const milkdownVersions = new Map();
for (const entry of milkdown) {
    const seen = milkdownVersions.get(entry.version) ?? [];
    seen.push(entry.name);
    milkdownVersions.set(entry.version, seen);
}
if (milkdown.length === 0) {
    fail("DEP-3", "no @milkdown/* package is installed at all");
} else if (milkdownVersions.size > 1) {
    fail(
        "DEP-3",
        `@milkdown/* is installed at ${String(milkdownVersions.size)} versions: ` +
            [...milkdownVersions.entries()]
                .map(([version, names]) => `${version} (${names.join(", ")})`)
                .join("; "),
    );
} else {
    pass(
        "DEP-3",
        `all ${String(milkdown.length)} @milkdown/* packages on ${[...milkdownVersions.keys()][0]}`,
    );
}

const declaredMilkdown = Object.entries({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
}).filter(([name]) => name.startsWith("@milkdown/"));
const unpinned = declaredMilkdown.filter(([, range]) => !/^\d+\.\d+\.\d+$/.test(range));
if (declaredMilkdown.length === 0) {
    fail("DEP-3", "package.json declares no @milkdown/* dependency");
} else if (unpinned.length > 0) {
    fail(
        "DEP-3",
        `@milkdown/* declared with a range rather than an exact version: ${unpinned
            .map(([name, range]) => `${name}@${range}`)
            .join(", ")}`,
    );
} else {
    pass(
        "DEP-3",
        `package.json pins ${declaredMilkdown
            .map(([name, range]) => `${name}@${range}`)
            .join(", ")}`,
    );
}

// --- Product-source imports ---------------------------------------------

const PRODUCT_DIRECTORIES = ["features", "app"];
const productFiles = PRODUCT_DIRECTORIES.flatMap((directory) =>
    listFiles(join(REPO_ROOT, directory), [".ts", ".tsx", ".mts"]),
);

/**
 * Editor implementation packages the adapter contract exists to hide.
 *
 * `@codemirror/*` is included: the source surface is CodeMirror, and it lives
 * behind the same boundary as the visual one.
 */
const FORBIDDEN_IMPORT = /from\s+["'](@milkdown\/|@codemirror\/|prosemirror-|@types\/prosemirror)/;
const importHits = [];
for (const file of productFiles) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, index) => {
        if (FORBIDDEN_IMPORT.test(line)) {
            importHits.push(`${relative(REPO_ROOT, file)}:${String(index + 1)}: ${line.trim()}`);
        }
    });
}
if (importHits.length > 0) {
    fail(
        "IMP-1",
        `product source imports editor implementation packages:\n      ${importHits.join("\n      ")}`,
    );
} else {
    pass(
        "IMP-1",
        `no @milkdown/*, @codemirror/* or prosemirror-* import in ${String(productFiles.length)} files under ${PRODUCT_DIRECTORIES.join(", ")}`,
    );
}

/**
 * Implementation-private DOM.
 *
 * These are the selectors the editor package owns. A product file that queries
 * one has reached past the adapter contract into the view's internals, and will
 * break silently the next time the view changes. The adapter's own root,
 * `data-mdx-markdown-editor`, is public; everything below it is not.
 */
const PRIVATE_DOM = [
    /\.ProseMirror\b/,
    /querySelector\w*\(\s*["'`][^"'`]*\bcm-(editor|content|line)\b/,
    /["'`]\[data-mdx-node-type/,
    /["'`]\[data-mdx-source-kind/,
    /["'`]\[data-layout-(run-id|dom-text-layer|complex-block-overlay|canvas-layer)/,
    /["'`]\[data-tex-dom-text-layer/,
    /["'`]\[data-mdx-editor-root/,
];

/**
 * The legacy hybrid surface's remaining reach into private editor DOM, pinned
 * file by file.
 *
 * Empty is the end state, and it is reached: the surface those pins described
 * has been removed, so no product file queries implementation-private editor
 * DOM at all. The check stays because it is honest in both directions — a *new*
 * violation anywhere fails, and a pin that no longer matches its file also
 * fails — so this object cannot be re-populated without someone deciding to.
 */
const LEGACY_PRIVATE_DOM_BASELINE = {};

/**
 * Public entry points of the editor package. Everything else under
 * `packages/mdx-editor/` is private: a deep import is the same boundary
 * violation as importing ProseMirror directly, just spelled differently.
 */
const PUBLIC_EDITOR_ENTRIES = new Set(["packages/mdx-editor"]);

/** The legacy surface's remaining deep imports, pinned on the same terms. */
const LEGACY_DEEP_IMPORT_BASELINE = {};

function countPerFile(files, matches) {
    const counts = {};
    for (const file of files) {
        if (/\.test\.tsx?$/.test(file)) continue;
        const relativePath = relative(REPO_ROOT, file);
        if (relativePath.startsWith("app/mdx-editor-qualification/")) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        let count = 0;
        const samples = [];
        lines.forEach((line, index) => {
            if (matches(line)) {
                count += 1;
                if (samples.length < 3) {
                    samples.push(`${relativePath}:${String(index + 1)}: ${line.trim()}`);
                }
            }
        });
        if (count > 0) counts[relativePath] = { count, samples };
    }
    return counts;
}

/**
 * Compares live counts against a pinned baseline, failing on anything new *and*
 * on any pin that has gone stale.
 */
function auditAgainstBaseline(check, label, counts, baseline) {
    let clean = true;
    for (const [path, { count, samples }] of Object.entries(counts)) {
        const pinned = baseline[path];
        if (pinned === undefined) {
            clean = false;
            fail(
                check,
                `${label} in ${path}, which is not in the legacy baseline:\n      ${samples.join("\n      ")}`,
            );
        } else if (count > pinned) {
            clean = false;
            fail(
                check,
                `${path} has ${String(count)} ${label} occurrences, above its pinned ${String(pinned)}:\n      ${samples.join("\n      ")}`,
            );
        }
    }
    for (const [path, pinned] of Object.entries(baseline)) {
        const found = counts[path]?.count ?? 0;
        if (found < pinned) {
            clean = false;
            fail(
                check,
                `the legacy baseline pins ${String(pinned)} ${label} occurrences in ${path} but only ${String(found)} remain; lower the pin`,
            );
        }
    }
    if (clean) {
        const remaining = Object.values(baseline).reduce((sum, value) => sum + value, 0);
        pass(
            check,
            `no new ${label}; ${String(remaining)} legacy occurrences remain pinned in ${String(Object.keys(baseline).length)} file(s), all of which must be gone before the entry switch`,
        );
    }
}

auditAgainstBaseline(
    "IMP-2",
    "implementation-private editor DOM query",
    countPerFile(productFiles, (line) => PRIVATE_DOM.some((pattern) => pattern.test(line))),
    LEGACY_PRIVATE_DOM_BASELINE,
);

const DEEP_IMPORT = /from\s+["'](?:[./]*|@\/)(packages\/mdx-editor(?:\/[^"']*)?)["']/;
auditAgainstBaseline(
    "IMP-3",
    "deep import into the editor package",
    countPerFile(productFiles, (line) => {
        const match = DEEP_IMPORT.exec(line);
        if (match === null) return false;
        return !PUBLIC_EDITOR_ENTRIES.has(match[1]);
    }),
    LEGACY_DEEP_IMPORT_BASELINE,
);

// --- No user-visible editor switch ---------------------------------------

/**
 * The qualification surface is reachable only through the build-time flag, and
 * the harness route only through a URL nothing links to. A switch becomes
 * user-visible the moment a menu item, a settings row, a keyboard shortcut or a
 * `<Link>` reaches either one — so the audit looks for exactly that.
 */
const QUALIFICATION_FLAG = "NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION";
const HARNESS_ROUTE = "/mdx-editor-qualification";
const NAVIGATION_MARKERS = [
    /<Link\b/,
    /\brouter\.(push|replace)\s*\(/,
    /\blocation\.(href|assign|replace)\s*=/,
    /window\.open\s*\(/,
    /role=["']menuitem["']/,
];

const switchHits = [];
for (const file of productFiles) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const relativePath = relative(REPO_ROOT, file);
    // The harness route is allowed to name itself and the flag.
    if (relativePath.startsWith("app/mdx-editor-qualification/")) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
        if (line.includes(HARNESS_ROUTE)) {
            switchHits.push(
                `${relativePath}:${String(index + 1)}: names the harness route: ${line.trim()}`,
            );
        }
    });
    // A file that both reads the qualification flag and navigates is the shape
    // a user-visible switch would take.
    const readsFlag =
        text.includes(QUALIFICATION_FLAG) ||
        text.includes("usesMilkdownQualificationSurface");
    if (!readsFlag) continue;
    // The gating helper itself, and the surfaces that branch on it, are the
    // intended use; a navigation affordance in the same file is not.
    lines.forEach((line, index) => {
        for (const marker of NAVIGATION_MARKERS) {
            if (marker.test(line)) {
                switchHits.push(
                    `${relativePath}:${String(index + 1)}: navigation affordance in a file that reads the qualification flag: ${line.trim()}`,
                );
                break;
            }
        }
    });
}

/**
 * Settings surfaces must not offer the choice either. This looks for the word
 * "editor" next to a preference-shaped control in any settings component.
 */
const settingsFiles = productFiles.filter((file) =>
    /settings|preferences/i.test(relative(REPO_ROOT, file)),
);
for (const file of settingsFiles) {
    const text = readFileSync(file, "utf8");
    if (/milkdown|legacy\s*editor|new\s*editor|editor\s*surface/i.test(text)) {
        switchHits.push(
            `${relative(REPO_ROOT, file)}: a settings surface mentions an editor choice`,
        );
    }
}

if (switchHits.length > 0) {
    fail(
        "PATH-1",
        `a user-visible old/new editor switch is reachable:\n      ${switchHits.join("\n      ")}`,
    );
} else {
    pass(
        "PATH-1",
        `no navigation or settings path reaches the qualification surface or ${HARNESS_ROUTE} ` +
            `(${String(productFiles.length)} product files, ${String(settingsFiles.length)} settings files)`,
    );
}

// --- Result ---------------------------------------------------------------

if (VERBOSE) {
    console.log(
        `scanned ${String(installed.length)} installed packages and ${String(productFiles.length)} product source files`,
    );
    try {
        console.log(
            execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "--short", "HEAD"], {
                encoding: "utf8",
            }).trim(),
        );
    } catch {
        /* not a git checkout; the audit does not need one */
    }
}

console.log("editor boundary audit:");
for (const line of report) console.log(line);

if (violations.length > 0) {
    console.error("\nFAIL");
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}

console.log("\nPASS (no dependency, import or forbidden-path violation)");
