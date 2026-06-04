# MDX Document Window Session Invariants

MDX has two app modes. Document Mode is intentionally narrow and should not trigger Workspace Mode behavior.

- Document Mode accepts only `.md` and `.markdown` files.
- Invalid supported-file opens, such as missing paths, unreadable paths, and non-regular files, should create a visible Document error window instead of silently skipping.
- Document sessions preserve both `displayPath` and `realPath`; `displayPath` is the path the user opened, while `realPath` is canonical and used for deduplication/saving.
- When a Document window is focused, workspace-only menu items such as new file, new folder, rename, trash, and refresh should be disabled or hidden.
