# Testing And Verification

## Reference Directories

`ref/` is reserved for external reference implementations used during product and architecture analysis. It is not part of the MDX application source tree.

Repo-level verification commands must exclude `ref/`, `rust_out/`, and `.omc/` unless a task explicitly asks to test those directories as separate projects. This includes lint, TypeScript, Vitest, and build inputs.

