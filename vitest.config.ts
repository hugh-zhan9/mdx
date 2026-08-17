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
