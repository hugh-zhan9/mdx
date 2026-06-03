# Reference Directories Are Excluded From Verification

The `ref/` directory contains external LLM Wiki implementations pulled for analysis. It is not source code for this app.

Project verification must exclude `ref/` and generated/reference output directories such as `rust_out/` and `.omc/`. This applies to linting, TypeScript, Vitest, and similar repo-level checks. Running unscoped Vitest without these excludes will attempt to execute reference-project tests with missing dependencies and aliases.

