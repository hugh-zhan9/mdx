import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
        },
    },
    test: {
        // Holds a file's environment open until the readiness timers Milkdown
        // started in it have fired, so their callbacks never run against a
        // torn-down environment. See the file for why this is a wait and not a
        // suppression.
        setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
        /**
         * Most tests here mount a real editor.
         *
         * Building one parses the document and instantiates the whole syntax
         * layer — every plugin, KaTeX, the code tokenizer — which takes on the
         * order of a second on an idle machine and several under the parallel
         * load of a full run. Against Vitest's 5s default that is close enough
         * to the line that whichever files happen to land together decide the
         * result, and a suite that fails on scheduling reports nothing about
         * the code.
         *
         * Raised rather than worked around per test: the cost is the suite's,
         * not any one test's, and pinning it in twenty places would leave the
         * twenty-first to be found the next time the editor grows a plugin. A
         * genuine hang still fails, twenty seconds later.
         */
        testTimeout: 20_000,
        exclude: [
            "**/node_modules/**",
            "**/.git/**",
            "**/dist/**",
            "**/.next/**",
            "**/out/**",
            "**/build/**",
            "ref/**",
            "rust_out/**",
            ".omc/**",
        ],
    },
});
