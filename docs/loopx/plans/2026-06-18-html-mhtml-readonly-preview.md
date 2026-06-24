# HTML MHTML Readonly Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use loopx:subagent-exec (recommended) or loopx:exec to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** `docs/loopx/design/HTML与MHTML只读渲染预览需求设计文档.md`

**Goal:** Restore Workspace Mode read-only rendered previews for `.html`, `.htm`, and `.mhtml` files while keeping scripts, forms, external network loads, iframe navigation, and Tauri API access blocked.

**Architecture:** Reuse the existing guarded `read_preview_text_file` Tauri command. Route renderable HTML extensions to a new `HtmlPreview` component, parse MHTML in front-end memory, rewrite archive resources to data URLs, sanitize the document, inject a restrictive CSP, and render the result in a sandboxed iframe without `allow-scripts`, `allow-forms`, or `allow-same-origin`.

**Tech Stack:** TypeScript, React 19, Next.js 16 client components, DOMParser/jsdom, Vitest, existing Tauri workspace read commands, Rust tests for preview read guards.

---

## Strict Current Surface Vs Historical Context

Strict current product surface:

- `features/workspace/**`
- `common/**`
- `app/**`
- `src-tauri/src/**`
- `package.json`
- `vitest.config.ts`
- `docs/loopx/specs/**`
- `docs/loopx/design/HTML与MHTML只读渲染预览需求设计文档.md`

Historical context, allowed to keep old behavior mentions:

- older `docs/loopx/plans/**`
- older `docs/loopx/design/**` except the current source design above
- `.loopx/**`
- `ref/**`
- `rust_out/**`

## Surface Inventory

- Public commands/API/routes/events/config:
  - Keep `read_preview_text_file(rootPath, path)` as the only read API for `.html/.htm/.mhtml`.
  - Do not add a write, save, edit, CLI insert, or Document Mode API for HTML/MHTML.
- Exported functions/types/modules:
  - Add `isMhtmlFilePath(path)` and `isRenderableHtmlFilePath(path)` in `features/workspace/lib/path.ts`.
  - Keep `isHtmlFilePath(path)` meaning `.html/.htm` only, so existing callers are not silently widened.
  - Add parser/security helpers under `features/workspace/lib/`.
- Runtime/generated artifacts and templates:
  - Create iframe blob URLs only for the preview document.
  - Use MHTML resource data URLs inside generated preview HTML.
  - Revoke iframe blob URLs on reload/unmount.
- Installer/package/deployment surface:
  - No dependency is planned. Implement a focused MHTML parser for the approved subset because `read_preview_text_file` already returns text and the required MIME features are narrow.
  - No package or lockfile update is expected.
- Hooks/background jobs/automation:
  - No hooks, background jobs, timers, or persisted cache.
- Current product docs:
  - No README update is required because this restores an in-app preview behavior and the design doc is the source of truth.
- Tests/governance checks:
  - Add unit tests for path classification, security rewriting, MHTML parsing/resource rewriting, and `HtmlPreview` lifecycle.
  - Keep existing Rust guard tests for `read_preview_text_file`; add a focused assertion only if current tests no longer prove `.html/.htm/.mhtml` are allowed.
- Compatibility/migration paths:
  - `.html/.htm/.mhtml` stay previewable in-app.
  - Normal rendering changes from source text to rendered iframe by design.
  - Source text is still available only in the error fallback for diagnostics.

## Caller Proof Commands And Decision Rules

Run before Task 5 and paste the output into task notes:

```bash
rg -n "isHtmlFilePath|isPlainTextFilePath|isPreviewableFilePath|TextPreview|read_preview_text_file|archive\\.mhtml|\\.mhtml" features src-tauri/src package.json README.md docs/loopx/specs 'docs/loopx/design/HTML与MHTML只读渲染预览需求设计文档.md'
```

Decision rule: current source/runtime callers must be updated so `.html/.htm/.mhtml` route to `HtmlPreview`; backend `read_preview_text_file` must keep allowing those extensions; historical docs and old plans are not retained callers.

Run before Task 7:

```bash
rg -n "allow-scripts|allow-forms|allow-same-origin|javascript:|on[a-z]+=" features/workspace
```

Decision rule: tests may contain unsafe strings as fixture input. Production code must not add iframe sandbox permissions or emit executable inline handlers.

## Negative Assertions For Final Verification

Run in Task 7. Expected result: every command exits successfully.

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('features/workspace/components/editor-stage.tsx','utf8'); if (/activeTabKind === \"html\"[\\s\\S]{0,160}<TextPreview/.test(s)) process.exit(1);"
node -e "const fs=require('fs'); const s=fs.readFileSync('features/workspace/lib/path.ts','utf8'); if (/PLAIN_TEXT_EXTENSIONS[\\s\\S]*\"\\.mhtml\"/.test(s)) process.exit(1);"
! rg -n "sandbox=\\{[^}]*allow-scripts|sandbox=\\{[^}]*allow-forms|sandbox=\\{[^}]*allow-same-origin|sandbox=\"[^\"]*allow-scripts|sandbox=\"[^\"]*allow-forms|sandbox=\"[^\"]*allow-same-origin" features/workspace
npm run test -- features/workspace/lib/path.test.ts features/workspace/lib/html-preview-security.test.ts features/workspace/lib/mhtml-archive.test.ts features/workspace/components/html-preview.test.tsx features/workspace/components/editor-stage.test.tsx
cd src-tauri && cargo test workspace_fs_tests::read_preview_text_file_allows_text_like_sources
npm run lint
```

## File Structure

- Modify `features/workspace/lib/path.ts`: remove `.mhtml` from plain text extensions; add `isMhtmlFilePath` and `isRenderableHtmlFilePath`; keep `.html/.htm/.mhtml` previewable.
- Modify `features/workspace/lib/path.test.ts`: prove `.mhtml` is renderable HTML, not plain text.
- Create `features/workspace/lib/html-preview-security.ts`: DOMParser-based sanitizer, resource URL rewriter, CSS URL rewriter, CSP injection, and sandbox constant.
- Create `features/workspace/lib/html-preview-security.test.ts`: jsdom tests for scripts, event handlers, `javascript:` URLs, forms, external resources, archive resource replacements, and CSP.
- Create `features/workspace/lib/mhtml-archive.ts`: MIME boundary split, header parsing, base64 and quoted-printable decoding, main HTML selection, alias mapping from Content-ID/Content-Location, CSS `url(...)` rewriting, resource data URLs, diagnostics.
- Create `features/workspace/lib/mhtml-archive.test.ts`: fixture tests for HTML selection, base64 image, quoted-printable CSS, `cid:` and `Content-Location`, missing main HTML, and external resource blocking through the security layer.
- Create `features/workspace/components/html-preview.tsx`: read text through Tauri, choose HTML vs MHTML handling, create/revoke iframe blob URL, render sandboxed iframe, show parse/load errors and source fallback.
- Create `features/workspace/components/html-preview.test.tsx`: jsdom component tests for read command, iframe sandbox, source fallback, stale load protection, and URL revocation.
- Modify `features/workspace/components/editor-stage.tsx`: import and render `HtmlPreview`; route renderable HTML before plain text.
- Create `features/workspace/components/editor-stage.test.tsx`: prove `.mhtml` renders `HtmlPreview` and `.txt` still renders `TextPreview`.
- Inspect `src-tauri/src/workspace_fs_tests.rs`; modify it only if the existing `read_preview_text_file_allows_text_like_sources` no longer includes `.html/.htm/.mhtml`.

## Task 1: Path Classification

**Files:**

- Modify: `features/workspace/lib/path.ts`
- Modify: `features/workspace/lib/path.test.ts`

- [ ] **Step 1: Update the failing path tests**

Edit `features/workspace/lib/path.test.ts` imports to include the new helpers:

```ts
import {
    isHtmlFilePath,
    isImageFilePath,
    isMarkdownFilePath,
    isMhtmlFilePath,
    isPdfFilePath,
    isPathInsideRoot,
    isPlainTextFilePath,
    isPreviewableFilePath,
    isRenderableHtmlFilePath,
    shouldOpenWithDefaultApplication,
    normalizeWorkspacePath,
} from "./path";
```

Replace the `archive.mhtml` expectation in `isPlainTextFilePath`:

```ts
        expect(isPlainTextFilePath("/tmp/ws/archive.mhtml")).toBe(false);
```

Replace the `isHtmlFilePath` block with:

```ts
describe("isHtmlFilePath", () => {
    it("allows html and htm files only", () => {
        expect(isHtmlFilePath("/tmp/ws/page.html")).toBe(true);
        expect(isHtmlFilePath("/tmp/ws/page.htm")).toBe(true);
        expect(isHtmlFilePath("/tmp/ws/page.HTML")).toBe(true);
        expect(isHtmlFilePath("/tmp/ws/archive.mhtml")).toBe(false);
        expect(isHtmlFilePath("/tmp/ws/page.md")).toBe(false);
    });
});

describe("isMhtmlFilePath", () => {
    it("allows mhtml files only", () => {
        expect(isMhtmlFilePath("/tmp/ws/archive.mhtml")).toBe(true);
        expect(isMhtmlFilePath("/tmp/ws/archive.MHTML")).toBe(true);
        expect(isMhtmlFilePath("/tmp/ws/page.html")).toBe(false);
        expect(isMhtmlFilePath("/tmp/ws/page.md")).toBe(false);
    });
});

describe("isRenderableHtmlFilePath", () => {
    it("allows html, htm, and mhtml files", () => {
        expect(isRenderableHtmlFilePath("/tmp/ws/page.html")).toBe(true);
        expect(isRenderableHtmlFilePath("/tmp/ws/page.htm")).toBe(true);
        expect(isRenderableHtmlFilePath("/tmp/ws/archive.mhtml")).toBe(true);
        expect(isRenderableHtmlFilePath("/tmp/ws/notes.txt")).toBe(false);
    });
});
```

- [ ] **Step 2: Run path tests and verify failure**

Run:

```bash
npx vitest run features/workspace/lib/path.test.ts
```

Expected: FAIL because `isMhtmlFilePath` and `isRenderableHtmlFilePath` are not exported and `.mhtml` still returns plain text.

- [ ] **Step 3: Implement path classification**

In `features/workspace/lib/path.ts`, remove `".mhtml"` from `PLAIN_TEXT_EXTENSIONS` and add:

```ts
export function isHtmlFilePath(path: string) {
    const normalized = normalizeWorkspacePath(path).toLowerCase();

    return normalized.endsWith(".html") || normalized.endsWith(".htm");
}

export function isMhtmlFilePath(path: string) {
    return normalizeWorkspacePath(path).toLowerCase().endsWith(".mhtml");
}

export function isRenderableHtmlFilePath(path: string) {
    return isHtmlFilePath(path) || isMhtmlFilePath(path);
}
```

Update `isPreviewableFilePath`:

```ts
export function isPreviewableFilePath(path: string) {
    return (
        isMarkdownFilePath(path) ||
        isPdfFilePath(path) ||
        isPlainTextFilePath(path) ||
        isRenderableHtmlFilePath(path) ||
        isImageFilePath(path)
    );
}
```

- [ ] **Step 4: Run path tests and verify pass**

Run:

```bash
npx vitest run features/workspace/lib/path.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit path classification**

Run:

```bash
git add features/workspace/lib/path.ts features/workspace/lib/path.test.ts
git commit -m "fix: classify mhtml as renderable html preview"
```

Expected: commit succeeds.

## Task 2: HTML Preview Security Rewriter

**Files:**

- Create: `features/workspace/lib/html-preview-security.ts`
- Create: `features/workspace/lib/html-preview-security.test.ts`

- [ ] **Step 1: Write failing security tests**

Create `features/workspace/lib/html-preview-security.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
    HTML_PREVIEW_IFRAME_SANDBOX,
    createSafePreviewHtml,
    rewriteCssUrls,
} from "./html-preview-security";

describe("html preview security", () => {
    it("uses an iframe sandbox without script, form, or same-origin privileges", () => {
        expect(HTML_PREVIEW_IFRAME_SANDBOX).toBe("");
        expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain("allow-scripts");
        expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain("allow-forms");
        expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain("allow-same-origin");
    });

    it("removes executable HTML and injects a restrictive CSP", () => {
        const safe = createSafePreviewHtml(`
            <!doctype html>
            <html>
              <head><title>X</title></head>
              <body onload="steal()">
                <script>window.__ran = true</script>
                <style>body{background:url(https://tracker.example/bg.png)}</style>
                <a href="javascript:steal()" onclick="steal()">Run</a>
                <form action="https://example.test/post"><button formaction="https://example.test/post">Send</button></form>
              </body>
            </html>
        `);

        expect(safe).toContain("default-src 'none'");
        expect(safe).not.toContain("<script");
        expect(safe).not.toContain("onload=");
        expect(safe).not.toContain("onclick=");
        expect(safe).not.toContain("javascript:steal");
        expect(safe).not.toContain("https://tracker.example/bg.png");
        expect(safe).toContain("body{background:none}");
        expect(safe).not.toContain("action=\"https://example.test/post\"");
        expect(safe).not.toContain("formaction=");
    });

    it("rewrites archive resources and blocks external automatic resources", () => {
        const safe = createSafePreviewHtml(
            `
            <html><body>
              <img src="cid:image-1">
              <img src="https://tracker.example/pixel.png">
              <link rel="stylesheet" href="https://tracker.example/app.css">
              <link rel="stylesheet" href="style.css">
              <a href="https://example.test/page">external link</a>
            </body></html>
            `,
            {
                resourceUrls: new Map([
                    ["cid:image-1", "data:image/png;base64,AAAA"],
                    ["style.css", "data:text/css;charset=utf-8,body%7Bcolor%3Ared%7D"],
                ]),
            },
        );

        expect(safe).toContain('src="data:image/png;base64,AAAA"');
        expect(safe).toContain('href="data:text/css;charset=utf-8,body%7Bcolor%3Ared%7D"');
        expect(safe).not.toContain("https://tracker.example");
        expect(safe).not.toContain('href="https://example.test/page"');
        expect(safe).toContain('data-mdx-original-href="https://example.test/page"');
    });

    it("rewrites CSS url references through the same resource map", () => {
        expect(
            rewriteCssUrls(
                "body{background:url('cid:bg-1')} .x{background:url(https://tracker.example/a.png)}",
                new Map([["cid:bg-1", "data:image/png;base64,BBBB"]]),
            ),
        ).toBe("body{background:url('data:image/png;base64,BBBB')} .x{background:none}");
    });
});
```

- [ ] **Step 2: Run security tests and verify failure**

Run:

```bash
npx vitest run features/workspace/lib/html-preview-security.test.ts
```

Expected: FAIL because `html-preview-security.ts` does not exist.

- [ ] **Step 3: Implement security helpers**

Create `features/workspace/lib/html-preview-security.ts`:

```ts
export const HTML_PREVIEW_IFRAME_SANDBOX = "";

const CSP_CONTENT = [
    "default-src 'none'",
    "img-src data: blob:",
    "style-src 'unsafe-inline' data: blob:",
    "font-src data: blob:",
    "media-src data: blob:",
    "frame-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
].join("; ");

const AUTOMATIC_URL_ATTRIBUTES = new Set([
    "src",
    "srcset",
    "poster",
    "data",
    "xlink:href",
]);

const FORM_URL_ATTRIBUTES = new Set(["action", "formaction"]);

export interface SafePreviewOptions {
    resourceUrls?: Map<string, string>;
}

export function createSafePreviewHtml(
    html: string,
    options: SafePreviewOptions = {},
): string {
    const parser = new DOMParser();
    const document = parser.parseFromString(html, "text/html");
    const resources = options.resourceUrls ?? new Map<string, string>();

    document.querySelectorAll("script, iframe, object, embed").forEach((node) => {
        node.remove();
    });

    for (const element of Array.from(document.querySelectorAll("*"))) {
        sanitizeElement(element, resources);
    }

    injectCsp(document);

    return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function rewriteCssUrls(
    css: string,
    resourceUrls: Map<string, string>,
): string {
    return css.replace(/url\(([^)]*)\)/gi, (_match, rawValue: string) => {
        const quote = rawValue.trim().startsWith("'")
            ? "'"
            : rawValue.trim().startsWith("\"")
              ? "\""
              : "";
        const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
        const replacement = lookupResource(value, resourceUrls);

        if (replacement) {
            return quote
                ? `url(${quote}${replacement}${quote})`
                : `url(${replacement})`;
        }

        if (isExternalUrl(value) || isUnsafeJavascriptUrl(value)) {
            return "none";
        }

        return `url(${rawValue.trim()})`;
    });
}

function sanitizeElement(
    element: Element,
    resourceUrls: Map<string, string>,
): void {
    const tagName = element.tagName.toLowerCase();

    if (tagName === "style" && element.textContent) {
        element.textContent = rewriteCssUrls(element.textContent, resourceUrls);
    }

    for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();

        if (name.startsWith("on")) {
            element.removeAttribute(attribute.name);
            continue;
        }

        if (name === "style") {
            element.setAttribute(attribute.name, rewriteCssUrls(attribute.value, resourceUrls));
            continue;
        }

        if (FORM_URL_ATTRIBUTES.has(name)) {
            element.removeAttribute(attribute.name);
            continue;
        }

        if (tagName === "a" && name === "href") {
            element.setAttribute("data-mdx-original-href", value);
            element.removeAttribute(attribute.name);
            continue;
        }

        if (tagName === "link" && name === "href") {
            const replacement = lookupResource(value, resourceUrls);
            if (replacement) {
                element.setAttribute(attribute.name, replacement);
            } else {
                element.removeAttribute(attribute.name);
            }
            continue;
        }

        if (AUTOMATIC_URL_ATTRIBUTES.has(name)) {
            const replacement = lookupResource(value, resourceUrls);
            if (replacement) {
                element.setAttribute(attribute.name, replacement);
            } else if (isExternalUrl(value) || isUnsafeJavascriptUrl(value)) {
                element.removeAttribute(attribute.name);
            }
            continue;
        }

        if (isUnsafeJavascriptUrl(value)) {
            element.removeAttribute(attribute.name);
        }
    }
}

function injectCsp(document: Document): void {
    let head = document.head;
    if (!head) {
        head = document.createElement("head");
        document.documentElement.prepend(head);
    }

    document
        .querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')
        .forEach((node) => node.remove());

    const meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", CSP_CONTENT);
    head.prepend(meta);
}

function lookupResource(value: string, resourceUrls: Map<string, string>): string | null {
    const aliases = [
        value,
        value.replace(/^cid:/i, "cid:"),
        value.replace(/^\.\//, ""),
        decodeURIComponentSafe(value),
    ];

    for (const alias of aliases) {
        const replacement = resourceUrls.get(alias);
        if (replacement) {
            return replacement;
        }
    }

    return null;
}

function isExternalUrl(value: string): boolean {
    return /^(https?:|wss?:|ftp:|file:|tauri:)/i.test(value);
}

function isUnsafeJavascriptUrl(value: string): boolean {
    return /^javascript:/i.test(value);
}

function decodeURIComponentSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
```

- [ ] **Step 4: Run security tests and verify pass**

Run:

```bash
npx vitest run features/workspace/lib/html-preview-security.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit security rewriter**

Run:

```bash
git add features/workspace/lib/html-preview-security.ts features/workspace/lib/html-preview-security.test.ts
git commit -m "feat: add secure html preview rewriting"
```

Expected: commit succeeds.

## Task 3: MHTML Archive Parser

**Files:**

- Create: `features/workspace/lib/mhtml-archive.ts`
- Create: `features/workspace/lib/mhtml-archive.test.ts`

- [ ] **Step 1: Write failing MHTML tests**

Create `features/workspace/lib/mhtml-archive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSafePreviewHtml } from "./html-preview-security";
import { parseMhtmlArchive } from "./mhtml-archive";

describe("mhtml archive parser", () => {
    it("selects the html part and rewrites cid image and stylesheet resources", () => {
        const archive = [
            "MIME-Version: 1.0",
            'Content-Type: multipart/related; boundary="----=_NextPart_000_0000"',
            "",
            "------=_NextPart_000_0000",
            "Content-Type: text/html; charset=utf-8",
            "Content-Location: https://example.test/page.html",
            "",
            '<html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello</h1><img src="cid:image-1"></body></html>',
            "------=_NextPart_000_0000",
            "Content-Type: text/css; charset=utf-8",
            "Content-Location: style.css",
            "",
            "body{background:url('cid:bg-1');color:red}",
            "------=_NextPart_000_0000",
            "Content-Type: image/png",
            "Content-Transfer-Encoding: base64",
            "Content-ID: <image-1>",
            "",
            "iVBORw0KGgo=",
            "------=_NextPart_000_0000",
            "Content-Type: image/png",
            "Content-Transfer-Encoding: base64",
            "Content-ID: <bg-1>",
            "",
            "AAAA",
            "------=_NextPart_000_0000--",
        ].join("\r\n");

        const parsed = parseMhtmlArchive(archive);
        const safe = createSafePreviewHtml(parsed.html, {
            resourceUrls: parsed.resourceUrls,
        });

        expect(parsed.diagnostics).toEqual([]);
        expect(safe).toContain("<h1>Hello</h1>");
        expect(safe).toContain('src="data:image/png;base64,iVBORw0KGgo="');
        expect(safe).toContain("data:text/css;charset=utf-8,");
        expect(decodeURIComponent(safe)).toContain("data:image/png;base64,AAAA");
    });

    it("decodes quoted-printable html bodies", () => {
        const archive = [
            "Content-Type: multipart/related; boundary=abc",
            "",
            "--abc",
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: quoted-printable",
            "",
            "<html><body><h1>Hello=20World</h1></body></html>",
            "--abc--",
        ].join("\n");

        expect(parseMhtmlArchive(archive).html).toContain("Hello World");
    });

    it("throws when the archive has no html part", () => {
        const archive = [
            "Content-Type: multipart/related; boundary=abc",
            "",
            "--abc",
            "Content-Type: image/png",
            "Content-Transfer-Encoding: base64",
            "Content-Location: image.png",
            "",
            "AAAA",
            "--abc--",
        ].join("\n");

        expect(() => parseMhtmlArchive(archive)).toThrow("MHTML archive does not contain a text/html part.");
    });
});
```

- [ ] **Step 2: Run MHTML tests and verify failure**

Run:

```bash
npx vitest run features/workspace/lib/mhtml-archive.test.ts
```

Expected: FAIL because `mhtml-archive.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `features/workspace/lib/mhtml-archive.ts`:

```ts
import { rewriteCssUrls } from "./html-preview-security";

export interface ParsedMhtmlArchive {
    html: string;
    resourceUrls: Map<string, string>;
    diagnostics: string[];
}

interface MimePart {
    headers: Map<string, string>;
    body: string;
}

export function parseMhtmlArchive(raw: string): ParsedMhtmlArchive {
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const [topHeaderText] = splitHeaderAndBody(normalized);
    const topHeaders = parseHeaders(topHeaderText);
    const boundary = findBoundary(topHeaders.get("content-type") ?? "");

    if (!boundary) {
        throw new Error("MHTML archive is missing a multipart boundary.");
    }

    const parts = splitMimeParts(normalized, boundary);
    const decoded = parts.map((part) => ({
        ...part,
        contentType: parseContentType(part.headers.get("content-type") ?? "text/plain"),
        bodyText: decodePartBody(part),
    }));
    const htmlPart = decoded.find((part) => part.contentType.mimeType === "text/html");

    if (!htmlPart) {
        throw new Error("MHTML archive does not contain a text/html part.");
    }

    const diagnostics: string[] = [];
    const resourceUrls = new Map<string, string>();
    const binaryResources = decoded.filter(
        (part) =>
            part !== htmlPart &&
            !part.contentType.mimeType.startsWith("text/css") &&
            hasResourceAlias(part.headers),
    );

    for (const part of binaryResources) {
        const dataUrl = createDataUrl(part.contentType.mimeType, part.bodyText, part.headers);
        for (const alias of aliasesForPart(part.headers)) {
            resourceUrls.set(alias, dataUrl);
        }
    }

    for (const part of decoded) {
        if (part === htmlPart || part.contentType.mimeType !== "text/css") {
            continue;
        }

        const css = rewriteCssUrls(part.bodyText, resourceUrls);
        const dataUrl = `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;
        for (const alias of aliasesForPart(part.headers)) {
            resourceUrls.set(alias, dataUrl);
        }
    }

    for (const part of decoded) {
        if (part !== htmlPart && !hasResourceAlias(part.headers)) {
            diagnostics.push(`Skipped ${part.contentType.mimeType} part without Content-ID or Content-Location.`);
        }
    }

    return {
        html: htmlPart.bodyText,
        resourceUrls,
        diagnostics,
    };
}

function splitHeaderAndBody(text: string): [string, string] {
    const index = text.indexOf("\n\n");
    if (index < 0) {
        return [text, ""];
    }
    return [text.slice(0, index), text.slice(index + 2)];
}

function parseHeaders(text: string): Map<string, string> {
    const headers = new Map<string, string>();
    let currentName: string | null = null;

    for (const line of text.split("\n")) {
        if (/^[ \t]/.test(line) && currentName) {
            headers.set(currentName, `${headers.get(currentName) ?? ""} ${line.trim()}`);
            continue;
        }

        const index = line.indexOf(":");
        if (index <= 0) {
            continue;
        }

        currentName = line.slice(0, index).trim().toLowerCase();
        headers.set(currentName, line.slice(index + 1).trim());
    }

    return headers;
}

function findBoundary(contentType: string): string | null {
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    return (match?.[1] ?? match?.[2] ?? "").trim() || null;
}

function splitMimeParts(text: string, boundary: string): MimePart[] {
    const marker = `--${boundary}`;
    const sections = text.split(marker).slice(1);
    const parts: MimePart[] = [];

    for (const section of sections) {
        const trimmed = section.replace(/^\n/, "");
        if (trimmed.startsWith("--")) {
            break;
        }

        const [headerText, body] = splitHeaderAndBody(trimmed.replace(/\n$/, ""));
        parts.push({
            headers: parseHeaders(headerText),
            body,
        });
    }

    return parts;
}

function parseContentType(value: string): { mimeType: string; charset: string } {
    const [mimeType, ...parameters] = value.split(";");
    const charsetParameter = parameters.find((parameter) =>
        parameter.trim().toLowerCase().startsWith("charset="),
    );

    return {
        mimeType: mimeType.trim().toLowerCase(),
        charset: charsetParameter
            ? charsetParameter.split("=").slice(1).join("=").replace(/^"|"$/g, "").trim()
            : "utf-8",
    };
}

function decodePartBody(part: MimePart): string {
    const transferEncoding = (part.headers.get("content-transfer-encoding") ?? "7bit").toLowerCase();
    const contentType = parseContentType(part.headers.get("content-type") ?? "text/plain");

    if (transferEncoding === "quoted-printable") {
        return decodeQuotedPrintable(part.body, contentType.charset);
    }

    if (transferEncoding === "base64" && contentType.mimeType.startsWith("text/")) {
        return decodeBytes(base64ToBytes(part.body), contentType.charset);
    }

    return part.body.replace(/\n$/, "");
}

function createDataUrl(
    mimeType: string,
    bodyText: string,
    headers: Map<string, string>,
): string {
    const transferEncoding = (headers.get("content-transfer-encoding") ?? "").toLowerCase();

    if (transferEncoding === "base64") {
        return `data:${mimeType};base64,${bodyText.replace(/\s+/g, "")}`;
    }

    if (mimeType.startsWith("text/")) {
        return `data:${mimeType};charset=utf-8,${encodeURIComponent(bodyText)}`;
    }

    return `data:${mimeType};base64,${bytesToBase64(new TextEncoder().encode(bodyText))}`;
}

function decodeQuotedPrintable(input: string, charset: string): string {
    const softLinesRemoved = input.replace(/=\n/g, "");
    const bytes: number[] = [];

    for (let index = 0; index < softLinesRemoved.length; index += 1) {
        const char = softLinesRemoved[index];
        if (char === "=" && /^[0-9a-f]{2}$/i.test(softLinesRemoved.slice(index + 1, index + 3))) {
            bytes.push(Number.parseInt(softLinesRemoved.slice(index + 1, index + 3), 16));
            index += 2;
        } else {
            bytes.push(char.charCodeAt(0));
        }
    }

    return decodeBytes(new Uint8Array(bytes), charset);
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
    try {
        return new TextDecoder(charset).decode(bytes);
    } catch {
        return new TextDecoder("utf-8").decode(bytes);
    }
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value.replace(/\s+/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function aliasesForPart(headers: Map<string, string>): string[] {
    const aliases = new Set<string>();
    const contentLocation = headers.get("content-location")?.trim();
    const contentId = headers.get("content-id")?.trim().replace(/^<|>$/g, "");

    if (contentLocation) {
        aliases.add(contentLocation);
        aliases.add(contentLocation.replace(/^\.\//, ""));
        try {
            const url = new URL(contentLocation);
            aliases.add(url.pathname.replace(/^\//, ""));
            aliases.add(url.pathname.split("/").pop() ?? url.pathname);
        } catch {
            // Relative content locations are already useful as-is.
        }
    }

    if (contentId) {
        aliases.add(`cid:${contentId}`);
        aliases.add(contentId);
    }

    return Array.from(aliases);
}

function hasResourceAlias(headers: Map<string, string>): boolean {
    return aliasesForPart(headers).length > 0;
}
```

- [ ] **Step 4: Run MHTML tests and verify pass**

Run:

```bash
npx vitest run features/workspace/lib/mhtml-archive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit MHTML parser**

Run:

```bash
git add features/workspace/lib/mhtml-archive.ts features/workspace/lib/mhtml-archive.test.ts
git commit -m "feat: parse mhtml preview archives"
```

Expected: commit succeeds.

## Task 4: HtmlPreview Component

**Files:**

- Create: `features/workspace/components/html-preview.tsx`
- Create: `features/workspace/components/html-preview.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `features/workspace/components/html-preview.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlPreview } from "./html-preview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();
const createObjectURL = vi.fn(() => "blob:preview-html");
const revokeObjectURL = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
}));

describe("HtmlPreview", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    invoke.mockResolvedValue("<html><body><h1>Rendered</h1></body></html>");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("loads html through the preview text command and renders a locked-down iframe", async () => {
    await renderPreview("/tmp/ws/page.html");

    expect(invoke).toHaveBeenCalledWith("read_preview_text_file", {
      rootPath: "/tmp/ws",
      path: "/tmp/ws/page.html",
    });
    const iframe = host.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.getAttribute("src")).toBe("blob:preview-html");
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text/html" }),
    );
  });

  it("shows an mhtml parse error with source fallback", async () => {
    invoke.mockResolvedValueOnce("Content-Type: multipart/related; boundary=abc\n\n--abc--");

    await renderPreview("/tmp/ws/archive.mhtml");

    expect(host.textContent).toContain("解析 MHTML 失败。");
    expect(host.textContent).toContain("显示源码");

    await act(async () => {
      getButton("显示源码").click();
      await flushPromises();
    });

    expect(host.querySelector("pre")?.textContent).toContain("multipart/related");
  });

  it("revokes the generated iframe URL on unmount", async () => {
    await renderPreview("/tmp/ws/page.html");

    await act(async () => {
      root.unmount();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-html");
  });

  async function renderPreview(path: string) {
    await act(async () => {
      root.render(<HtmlPreview rootPath="/tmp/ws" path={path} />);
      await flushPromises();
    });
  }

  function getButton(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) {
      throw new Error(`Expected button "${label}".`);
    }
    return button;
  }
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
```

- [ ] **Step 2: Run component tests and verify failure**

Run:

```bash
npx vitest run features/workspace/components/html-preview.test.tsx
```

Expected: FAIL because `html-preview.tsx` does not exist.

- [ ] **Step 3: Implement HtmlPreview**

Create `features/workspace/components/html-preview.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { tauriCore } from "@/common/lib/tauri";
import {
  HTML_PREVIEW_IFRAME_SANDBOX,
  createSafePreviewHtml,
} from "../lib/html-preview-security";
import { parseMhtmlArchive } from "../lib/mhtml-archive";
import { isMhtmlFilePath } from "../lib/path";

interface HtmlPreviewProps {
  rootPath: string;
  path: string;
}

interface PreviewState {
  source: string | null;
  error: string | null;
  rawText: string | null;
}

export function HtmlPreview({ rootPath, path }: HtmlPreviewProps) {
  const [state, setState] = useState<PreviewState>({
    source: null,
    error: null,
    rawText: null,
  });
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPreview() {
      let loadedRawText: string | null = null;
      try {
        setShowSource(false);
        const { invoke } = await tauriCore();
        loadedRawText = await invoke<string>("read_preview_text_file", {
          rootPath,
          path,
        });

        const previewHtml = isMhtmlFilePath(path)
          ? createMhtmlPreviewHtml(loadedRawText)
          : createSafePreviewHtml(loadedRawText);

        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(
          new Blob([previewHtml], { type: "text/html" }),
        );
        setState({
          source: objectUrl,
          error: null,
          rawText: loadedRawText,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            source: null,
            error: formatError(
              error,
              isMhtmlFilePath(path) ? "解析 MHTML 失败。" : "加载 HTML 失败。",
            ),
            rawText: loadedRawText,
          });
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path, rootPath]);

  if (state.error) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-base-100">
        <div className="flex items-center gap-3 border-b border-base-300 px-4 py-3 text-sm text-base-content/70">
          <span className="flex-1">{state.error}</span>
          {state.rawText ? (
            <button
              type="button"
              className="rounded border border-base-300 px-3 py-1 text-sm text-base-content hover:bg-base-200"
              onClick={() => setShowSource((current) => !current)}
            >
              {showSource ? "隐藏源码" : "显示源码"}
            </button>
          ) : null}
        </div>
        {showSource && state.rawText ? (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm leading-relaxed text-base-content">
            {state.rawText}
          </pre>
        ) : null}
      </div>
    );
  }

  if (!state.source) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-base-content/70">
        正在加载 HTML 预览...
      </div>
    );
  }

  return (
    <iframe
      title="HTML 预览"
      src={state.source}
      sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
      className="h-full w-full border-0 bg-base-100"
    />
  );
}

function createMhtmlPreviewHtml(rawText: string): string {
  const parsed = parseMhtmlArchive(rawText);
  return createSafePreviewHtml(parsed.html, {
    resourceUrls: parsed.resourceUrls,
  });
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback} ${error.message}`;
  }

  if (typeof error === "string" && error.length > 0) {
    return `${fallback} ${error}`;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return `${fallback} ${error.message}`;
  }

  return fallback;
}
```

- [ ] **Step 4: Run component tests and verify pass**

Run:

```bash
npx vitest run features/workspace/components/html-preview.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit HtmlPreview**

Run:

```bash
git add features/workspace/components/html-preview.tsx features/workspace/components/html-preview.test.tsx
git commit -m "feat: render secure html preview iframe"
```

Expected: commit succeeds.

## Task 5: EditorStage Routing

**Files:**

- Modify: `features/workspace/components/editor-stage.tsx`
- Create: `features/workspace/components/editor-stage.test.tsx`

- [ ] **Step 1: Run caller proof**

Run:

```bash
rg -n "isHtmlFilePath|isPlainTextFilePath|isPreviewableFilePath|TextPreview|read_preview_text_file|archive\\.mhtml|\\.mhtml" features src-tauri/src package.json README.md docs/loopx/specs 'docs/loopx/design/HTML与MHTML只读渲染预览需求设计文档.md'
```

Expected: output includes `features/workspace/components/editor-stage.tsx` routing `html` to `TextPreview`, `features/workspace/lib/path.ts`, existing tests, and Rust preview text allow-list.

- [ ] **Step 2: Write failing EditorStage routing tests**

Create `features/workspace/components/editor-stage.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorStage } from "./editor-stage";
import type { WorkspaceTab } from "../lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();

vi.mock("@/common/lib/tauri", () => ({
  tauriCore: async () => ({ invoke }),
}));

vi.mock("./html-preview", () => ({
  HtmlPreview: ({ path }: { path: string }) => (
    <div data-testid="html-preview">{path}</div>
  ),
}));

vi.mock("@/features/editor/components/editor-pane", () => ({
  EditorPane: () => <div data-testid="markdown-editor" />,
}));

describe("EditorStage preview routing", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    invoke.mockResolvedValue("plain text");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("routes mhtml files to HtmlPreview instead of TextPreview", async () => {
    await renderStage({
      tabId: "tab-1",
      path: "/tmp/ws/archive.mhtml",
      title: "archive.mhtml",
      dirty: false,
      needsRenameOnFirstSave: false,
    });

    expect(host.querySelector("[data-testid='html-preview']")).not.toBeNull();
    expect(host.querySelector("pre")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("read_preview_text_file", expect.anything());
  });

  it("keeps txt files on TextPreview", async () => {
    await renderStage({
      tabId: "tab-2",
      path: "/tmp/ws/notes.txt",
      title: "notes.txt",
      dirty: false,
      needsRenameOnFirstSave: false,
    });

    expect(host.querySelector("[data-testid='html-preview']")).toBeNull();
    expect(host.querySelector("pre")?.textContent).toBe("plain text");
  });

  async function renderStage(activeTab: WorkspaceTab) {
    await act(async () => {
      root.render(
        <EditorStage
          rootPath="/tmp/ws"
          activeTab={activeTab}
          dispatch={vi.fn()}
          pendingCliCommand={null}
          onPendingCliCommandHandled={vi.fn()}
          onSelectionChange={vi.fn()}
        />,
      );
      await flushPromises();
    });
  }
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
```

- [ ] **Step 3: Run routing tests and verify failure**

Run:

```bash
npx vitest run features/workspace/components/editor-stage.test.tsx
```

Expected: FAIL because `.mhtml` still routes through plain text and `html` currently renders `TextPreview`.

- [ ] **Step 4: Update EditorStage imports and render branch**

In `features/workspace/components/editor-stage.tsx`, import `HtmlPreview` and `isRenderableHtmlFilePath`:

```tsx
import { HtmlPreview } from "./html-preview";
```

Replace the path imports:

```tsx
import {
  isImageFilePath,
  isMarkdownFilePath,
  isPdfFilePath,
  isPlainTextFilePath,
  isRenderableHtmlFilePath,
} from "../lib/path";
```

Replace the `html` branch:

```tsx
        ) : activeTabKind === "text" ? (
          <TextPreview rootPath={rootPath} path={activeTab.path} />
        ) : activeTabKind === "html" ? (
          <HtmlPreview rootPath={rootPath} path={activeTab.path} />
```

Update `getTabKind` so renderable HTML wins before plain text:

```tsx
function getTabKind(path: string) {
  if (isMarkdownFilePath(path)) {
    return "markdown";
  }

  if (isPdfFilePath(path)) {
    return "pdf";
  }

  if (isImageFilePath(path)) {
    return "image";
  }

  if (isRenderableHtmlFilePath(path)) {
    return "html";
  }

  if (isPlainTextFilePath(path)) {
    return "text";
  }

  return "unsupported";
}
```

- [ ] **Step 5: Run routing tests and verify pass**

Run:

```bash
npx vitest run features/workspace/components/editor-stage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit EditorStage routing**

Run:

```bash
git add features/workspace/components/editor-stage.tsx features/workspace/components/editor-stage.test.tsx
git commit -m "fix: route html and mhtml tabs to rendered preview"
```

Expected: commit succeeds.

## Task 6: Backend Guard Confirmation

**Files:**

- Inspect: `src-tauri/src/workspace_fs.rs`
- Inspect/optional modify: `src-tauri/src/workspace_fs_tests.rs`

- [ ] **Step 1: Verify backend allow-list includes HTML and MHTML**

Run:

```bash
rg -n "PREVIEW_TEXT_EXTENSIONS|matches!\\(extension\\.as_str\\(\\), \"html\" \\| \"htm\"\\)|archive\\.mhtml|page\\.html|legacy\\.htm" src-tauri/src/workspace_fs.rs src-tauri/src/workspace_fs_tests.rs
```

Expected: output shows:

- `PREVIEW_TEXT_EXTENSIONS` includes `"mhtml"`.
- `is_allowed_preview_text_file` has `matches!(extension.as_str(), "html" | "htm")`.
- `read_preview_text_file_allows_text_like_sources` includes `("page.html", ...)`, `("legacy.htm", ...)`, and `("archive.mhtml", ...)`.

- [ ] **Step 2: Add missing Rust fixture cases only if Step 1 does not find all three extensions**

If any of the three fixture cases are missing, edit `src-tauri/src/workspace_fs_tests.rs` inside `read_preview_text_file_allows_text_like_sources` so `cases` includes:

```rust
        ("page.html", "<h1>Page</h1>"),
        ("legacy.htm", "<p>Legacy</p>"),
        ("archive.mhtml", "MHTML"),
```

Do not add a new Tauri command and do not remove `"mhtml"` from `PREVIEW_TEXT_EXTENSIONS`.

- [ ] **Step 3: Run the focused Rust guard test**

Run:

```bash
cd src-tauri && cargo test workspace_fs_tests::read_preview_text_file_allows_text_like_sources
```

Expected: PASS.

- [ ] **Step 4: Commit only if Rust tests changed**

If Step 2 changed `src-tauri/src/workspace_fs_tests.rs`, run:

```bash
git add src-tauri/src/workspace_fs_tests.rs
git commit -m "test: confirm html preview text read guard"
```

Expected: commit succeeds. If no files changed, skip this commit.

## Task 7: Full Verification And Manual Smoke

**Files:**

- Verify: all files changed in Tasks 1-6

- [ ] **Step 1: Run final negative assertions**

Run:

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('features/workspace/components/editor-stage.tsx','utf8'); if (/activeTabKind === \"html\"[\\s\\S]{0,160}<TextPreview/.test(s)) process.exit(1);"
node -e "const fs=require('fs'); const s=fs.readFileSync('features/workspace/lib/path.ts','utf8'); if (/PLAIN_TEXT_EXTENSIONS[\\s\\S]*\"\\.mhtml\"/.test(s)) process.exit(1);"
! rg -n "sandbox=\\{[^}]*allow-scripts|sandbox=\\{[^}]*allow-forms|sandbox=\\{[^}]*allow-same-origin|sandbox=\"[^\"]*allow-scripts|sandbox=\"[^\"]*allow-forms|sandbox=\"[^\"]*allow-same-origin" features/workspace
```

Expected: all commands exit 0.

- [ ] **Step 2: Run focused front-end tests**

Run:

```bash
npx vitest run features/workspace/lib/path.test.ts features/workspace/lib/html-preview-security.test.ts features/workspace/lib/mhtml-archive.test.ts features/workspace/components/html-preview.test.tsx features/workspace/components/editor-stage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run focused backend test**

Run:

```bash
cd src-tauri && cargo test workspace_fs_tests::read_preview_text_file_allows_text_like_sources
```

Expected: PASS.

- [ ] **Step 4: Run repo front-end verification**

Run:

```bash
npm run lint
npm run test
```

Expected: both commands exit 0. Vitest must exclude `ref/`, `rust_out/`, and `.omc/` per `docs/loopx/specs/testing.md`.

- [ ] **Step 5: Run manual Workspace smoke**

Create or copy three local files inside a temporary workspace:

```text
page.html
legacy.htm
archive.mhtml
```

Use this minimal `page.html`:

```html
<!doctype html>
<html>
  <body>
    <h1>HTML Preview Smoke</h1>
    <script>document.body.dataset.scriptRan = "true";</script>
    <img src="https://example.invalid/blocked.png">
  </body>
</html>
```

Use this minimal `archive.mhtml`:

```text
MIME-Version: 1.0
Content-Type: multipart/related; boundary=abc

--abc
Content-Type: text/html; charset=utf-8

<html><head><link rel="stylesheet" href="style.css"></head><body><h1>MHTML Preview Smoke</h1><img src="cid:image-1"></body></html>
--abc
Content-Type: text/css; charset=utf-8
Content-Location: style.css

body{color:red}
--abc
Content-Type: image/png
Content-Transfer-Encoding: base64
Content-ID: <image-1>

iVBORw0KGgo=
--abc--
```

Run:

```bash
npm run dev
```

Expected manual observations:

- Opening `page.html` and `legacy.htm` in Workspace Mode shows rendered headings, not source text.
- Opening `archive.mhtml` shows `MHTML Preview Smoke`; the stylesheet link is rewritten to a data URL; the image uses a data URL.
- Text in the iframe can be selected and copied.
- The script does not run.
- External image URL does not appear in the generated safe HTML and does not load.
- `.txt`, `.json`, image, PDF, and Markdown tabs still use their previous preview/editor paths.

- [ ] **Step 6: Commit final verification notes if a finish workflow requires it**

If using `loopx:subagent-exec` or `loopx:exec`, record the exact verification output in that workflow's finish report. Do not create a source commit for manual notes unless the repo workflow explicitly requires one.

## Self-Review

- Spec coverage:
  - Workspace `.html/.htm` rendered preview: Tasks 1, 4, 5, 7.
  - Workspace `.mhtml` parsed rendered preview with CSS/images: Tasks 3, 4, 5, 7.
  - Text selection/copy: Task 7 manual iframe smoke.
  - Scripts, forms, popups, external navigation, Tauri API access blocked: Tasks 2, 4, 7.
  - Default no external network resources: Tasks 2, 3, 7.
  - Parse failure with source fallback: Task 4.
  - Root escape prevention and no new read API: Task 6.
  - Object URL lifecycle cleanup: Task 4.
- Placeholder scan: no `TBD`, `TODO`, "similar to", or unspecified tests.
- Type consistency:
  - `isMhtmlFilePath` and `isRenderableHtmlFilePath` are defined in Task 1 and consumed in Tasks 4 and 5.
  - `createSafePreviewHtml`, `rewriteCssUrls`, and `HTML_PREVIEW_IFRAME_SANDBOX` are defined in Task 2 and consumed in Tasks 3 and 4.
  - `parseMhtmlArchive` returns `ParsedMhtmlArchive` with `html`, `resourceUrls`, and `diagnostics` in Task 3 and is consumed in Task 4.
- Design drift:
  - No editing, saving, Document Mode, CLI, network loading, or script execution behavior is added.
  - No new parser dependency is introduced; this stays within the plan decision boundary.
- Surface-change coverage:
  - Surface Inventory, Caller Proof, and Negative Assertions are included because `.mhtml` and `.html/.htm` preview behavior changes from source text to rendered iframe.
