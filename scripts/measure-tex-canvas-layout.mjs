import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

import ts from "typescript";

const DEFAULT_VIEWPORT = {
    width: 1280,
    height: 720,
    devicePixelRatio: 2,
};

const DEFAULT_FIXTURE_ID = "mixed-layout";
const DEFAULT_ITERATIONS = 200;
const DEFAULT_BUDGET_MS = 80;

let cachedModulesPromise = null;

export async function measureTexCanvasLayoutPerformance({
    fixture,
    iterations = DEFAULT_ITERATIONS,
    viewport = DEFAULT_VIEWPORT,
    budgetMs = DEFAULT_BUDGET_MS,
} = {}) {
    if (!fixture) {
        throw new Error("measureTexCanvasLayoutPerformance requires a fixture.");
    }

    if (!Number.isInteger(iterations) || iterations <= 0) {
        throw new Error("iterations must be a positive integer.");
    }

    const { normalizeLayoutDocument } = await loadRuntimeModules();

    let lastDocument = null;
    const startedAt = performance.now();

    for (let index = 0; index < iterations; index += 1) {
        lastDocument = normalizeLayoutDocument(fixture.markdown, viewport);
    }

    const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
    const blockCount = lastDocument?.blocks.length ?? 0;
    const inlineCount =
        lastDocument?.blocks.reduce(
            (total, block) => total + block.inlines.length,
            0,
        ) ?? 0;

    return {
        fixtureId: fixture.id,
        iterations,
        elapsedMs,
        budgetMs,
        averageMs: Number((elapsedMs / iterations).toFixed(4)),
        markdownBytes: Buffer.byteLength(fixture.markdown, "utf8"),
        blockCount,
        inlineCount,
        withinBudget: elapsedMs <= budgetMs,
    };
}

async function loadRuntimeModules() {
    cachedModulesPromise ??= transpileAndImportRuntimeModules();
    return cachedModulesPromise;
}

async function transpileAndImportRuntimeModules() {
    const tempDir = mkdtempSync(
        path.join(os.tmpdir(), "mdx-tex-canvas-layout-"),
    );

    try {
        const normalizerModulePath = transpileTypeScriptModule(
            path.resolve("packages/mdx-editor/layout-ir/normalizer.ts"),
            path.join(tempDir, "normalizer.mjs"),
        );
        const fixturesModulePath = transpileTypeScriptModule(
            path.resolve("packages/mdx-editor/test/tex-canvas-fixtures.ts"),
            path.join(tempDir, "tex-canvas-fixtures.mjs"),
        );

        const [normalizerModule, fixturesModule] = await Promise.all([
            import(pathToFileURL(normalizerModulePath).href),
            import(pathToFileURL(fixturesModulePath).href),
        ]);

        return {
            normalizeLayoutDocument: normalizerModule.normalizeLayoutDocument,
            TEX_CANVAS_FIXTURES: fixturesModule.TEX_CANVAS_FIXTURES,
        };
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function transpileTypeScriptModule(sourcePath, outputPath) {
    const source = readFileSync(sourcePath, "utf8");
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: sourcePath,
    });

    writeFileSync(outputPath, transpiled.outputText, "utf8");
    return outputPath;
}

async function main() {
    const fixtureId = process.argv[2] || DEFAULT_FIXTURE_ID;
    const { TEX_CANVAS_FIXTURES } = await loadRuntimeModules();
    const fixture = TEX_CANVAS_FIXTURES.find(
        (candidate) => candidate.id === fixtureId,
    );

    if (!fixture) {
        const availableIds = TEX_CANVAS_FIXTURES.map(({ id }) => id).join(", ");
        throw new Error(
            `Unknown fixture "${fixtureId}". Available fixtures: ${availableIds}`,
        );
    }

    const measurement = await measureTexCanvasLayoutPerformance({ fixture });

    console.log(
        [
            "TeX canvas layout performance smoke:",
            `fixture: ${measurement.fixtureId}`,
            `iterations: ${measurement.iterations}`,
            `elapsed: ${measurement.elapsedMs} ms`,
            `average: ${measurement.averageMs} ms/iteration`,
            `markdown bytes: ${measurement.markdownBytes}`,
            `normalized blocks: ${measurement.blockCount}`,
            `inline runs: ${measurement.inlineCount}`,
            `budget: <= ${measurement.budgetMs} ms`,
            `result: ${measurement.withinBudget ? "PASS" : "FAIL"}`,
        ].join("\n"),
    );

    if (!measurement.withinBudget) {
        process.exitCode = 1;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
