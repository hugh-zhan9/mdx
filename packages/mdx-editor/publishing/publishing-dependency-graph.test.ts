import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The dependency evidence for the publishing boundary.
 *
 * Failure isolation is a claim about what publishing *can* do, not only about
 * what it did during one test. This walks the real import graph out of the
 * publishing entry and shows there is no edge from it to anything that can
 * write: no adapter handle, no session type, no editor framework, no storage
 * and no command channel.
 *
 * Type-only edges are followed separately from value edges. A type-only import
 * is erased before anything runs, so it cannot carry a capability; a value
 * import can, and is held to the stricter rule.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");
const ENTRY = path.join(HERE, "index.ts");

interface ModuleEdge {
    specifier: string;
    typeOnly: boolean;
    clause: string;
}

interface Graph {
    files: Set<string>;
    packages: Set<string>;
    unresolved: Set<string>;
    edges: Map<string, ModuleEdge[]>;
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function edgesOf(file: string): ModuleEdge[] {
    const source = stripComments(readFileSync(file, "utf8"));
    const pattern = /\b(import|export)\b([^;]*?)\bfrom\s*"([^"]+)"/g;
    const edges: ModuleEdge[] = [];
    let match = pattern.exec(source);

    while (match !== null) {
        edges.push({
            specifier: match[3],
            typeOnly: /^\s*type\b/.test(match[2]),
            clause: match[2].trim(),
        });
        match = pattern.exec(source);
    }

    return edges;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
    const base = path.resolve(path.dirname(fromFile), specifier);

    return (
        [
            `${base}.ts`,
            `${base}.tsx`,
            path.join(base, "index.ts"),
            path.join(base, "index.tsx"),
        ].find((candidate) => existsSync(candidate)) ?? null
    );
}

function walk(entry: string, followTypeEdges: boolean): Graph {
    const files = new Set<string>();
    const packages = new Set<string>();
    const unresolved = new Set<string>();
    const edges = new Map<string, ModuleEdge[]>();
    const queue = [entry];

    while (queue.length > 0) {
        const file = queue.pop() as string;

        if (files.has(file)) {
            continue;
        }

        files.add(file);
        const fileEdges = edgesOf(file);
        edges.set(file, fileEdges);

        for (const edge of fileEdges) {
            if (edge.typeOnly && !followTypeEdges) {
                continue;
            }

            if (!edge.specifier.startsWith(".")) {
                packages.add(edge.specifier);
                continue;
            }

            const resolved = resolveRelative(file, edge.specifier);

            if (resolved === null) {
                unresolved.add(`${relative(file)} -> ${edge.specifier}`);
                continue;
            }

            queue.push(resolved);
        }
    }

    return { files, packages, unresolved, edges };
}

function relative(file: string): string {
    return path.relative(PACKAGE_ROOT, file);
}

/**
 * Packages the publishing chain is allowed to run on.
 *
 * All of them are Markdown readers. None of them can render, focus, select or
 * store anything.
 */
const ALLOWED_RUNTIME_PACKAGES = [
    "mdast-util-from-markdown",
    "mdast-util-frontmatter",
    "mdast-util-gfm",
    "mdast-util-math",
    "micromark-extension-frontmatter",
    "micromark-extension-gfm",
    "micromark-extension-math",
];

/** Things a module that could write to an editor session would have to name. */
const MUTATION_CAPABLE_TOKENS = [
    "MarkdownEditorAdapter",
    "MarkdownEditorAdapterHandle",
    "MarkdownEditorAdapterProps",
    "EditorChangeEvent",
    "EditorDocumentSnapshot",
    "PinnedEditorCommand",
    "EditorSessionBinding",
    "onMarkdownChange",
    "onChange",
    "onSelectionChange",
    "onDiagnostic",
    "setSelection",
    "getSelection",
    "setMode",
    "dirty",
    "draft",
    "conflict",
    "localStorage",
    "sessionStorage",
    "execCommand",
    "window.print",
    "requestAnimationFrame",
];

/** Editor frameworks, and anything that can reach a rendered surface. */
const FORBIDDEN_PACKAGE_PREFIXES = [
    "@milkdown/",
    "milkdown/",
    "prosemirror-",
    "@codemirror/",
    "react",
    "next/",
    "@tauri-apps/",
];

describe("publishing cannot reach editor state", () => {
    const runtime = walk(ENTRY, false);
    const complete = walk(ENTRY, true);

    it("walks a graph big enough to be evidence", () => {
        expect(runtime.files.size).toBeGreaterThanOrEqual(6);
        expect([...runtime.files].map(relative)).toContain(
            path.join("publishing", "publishing-export.ts"),
        );
        expect([...runtime.files].map(relative)).toContain(
            path.join("publishing", "publishing-content.ts"),
        );
    });

    it("runs entirely inside the publishing package", () => {
        const outside = [...runtime.files]
            .filter((file) => !file.startsWith(path.join(PACKAGE_ROOT, "publishing")))
            .map(relative);

        expect(outside).toEqual([]);
        expect([...runtime.unresolved]).toEqual([]);
        expect([...complete.unresolved]).toEqual([]);
    });

    it("runs on Markdown readers and nothing that can render or store", () => {
        expect([...runtime.packages].sort()).toEqual(
            [...ALLOWED_RUNTIME_PACKAGES].sort(),
        );

        for (const specifier of complete.packages) {
            for (const prefix of FORBIDDEN_PACKAGE_PREFIXES) {
                expect(specifier.startsWith(prefix)).toBe(false);
            }
        }
    });

    it("names the adapter only to borrow the snapshot type", () => {
        const outside = [...complete.files].filter(
            (file) => !file.startsWith(path.join(PACKAGE_ROOT, "publishing")),
        );

        expect(outside.map(relative)).toEqual([path.join("adapter", "types.ts")]);

        const adapterEdges = [...complete.edges.entries()].flatMap(
            ([file, edges]) =>
                edges
                    .filter((edge) => edge.specifier.includes("adapter"))
                    .map((edge) => ({ file: relative(file), edge })),
        );

        expect(adapterEdges).toHaveLength(1);
        expect(adapterEdges[0].file).toBe(path.join("publishing", "types.ts"));
        expect(adapterEdges[0].edge.typeOnly).toBe(true);
        expect(adapterEdges[0].edge.clause).toBe("type { PublishingSnapshot }");
    });

    it("names nothing that could write to a session", () => {
        for (const file of complete.files) {
            if (!file.startsWith(path.join(PACKAGE_ROOT, "publishing"))) {
                continue;
            }

            const source = stripComments(readFileSync(file, "utf8"));

            for (const token of MUTATION_CAPABLE_TOKENS) {
                expect(
                    source.includes(token),
                    `${relative(file)} names ${token}`,
                ).toBe(false);
            }
        }
    });
});
