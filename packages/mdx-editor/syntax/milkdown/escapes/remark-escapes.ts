import type { MarkdownNode, RemarkPluginRaw } from "@milkdown/kit/transformer";

import {
    AUTHORED_ESCAPE_MDAST_TYPE,
    readAuthoredEscapes,
    writeAuthoredEscapes,
    type AuthoredEscapeMode,
    type AuthoredRun,
} from "./syntax";

/**
 * A source position carrying only what this layer and its readers use.
 *
 * Everything downstream — the offset map, the footnote guard, the preservation
 * layer — reads `offset` and nothing else. Line and column are filled in with
 * the values unist requires and are not meaningful for a piece cut out of a
 * larger node.
 */
function span(from: number, to: number): MarkdownNode["position"] {
    return {
        start: { line: 1, column: 1, offset: from },
        end: { line: 1, column: 1, offset: to },
    };
}

function escapeNode(
    value: string,
    mode: AuthoredEscapeMode,
    position: MarkdownNode["position"],
): MarkdownNode {
    return {
        type: AUTHORED_ESCAPE_MDAST_TYPE,
        mode,
        // The mark carries no position of its own: the text inside it does, and
        // that is what the offset map attributes the run to. A position here
        // would additionally be read as a stretch of syntax the caret cannot
        // enter, which an escaped character is not.
        children: [{ type: "text", value, position }],
    };
}

function runNode(run: AuthoredRun): MarkdownNode {
    const position = span(run.from, run.to);
    if (!run.escaped) return { type: "text", value: run.value, position };
    return escapeNode(run.value, "escaped", position);
}

/**
 * Splits one text node into the runs its source says it is made of, or null
 * when nothing has to change.
 *
 * A node with no source position is left alone. By the time such a node exists
 * every escape it once held is already a node of its own — the splitters that
 * drop positions run after this transformer has been over the tree — so its
 * value is the author's own bytes and is written as it stands.
 */
function splitTextNode(node: MarkdownNode, source: string): MarkdownNode[] | null {
    const value = node.value;
    if (typeof value !== "string" || value.length === 0) return null;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return null;

    const runs = readAuthoredEscapes(value, source, start, end);
    // Provenance could not be established: the value no longer corresponds to
    // the source it spans, so which characters were escaped is unknowable. The
    // whole run goes to the writer's own escaping, which over-escapes rather
    // than dropping an escape the author wrote.
    if (runs === null) return [escapeNode(value, "auto", node.position)];
    if (!runs.some((run) => run.escaped)) return null;
    return runs.map(runNode);
}

/**
 * Rewrites `text` children in place.
 *
 * Only `text` nodes are visited, so an `inlineCode` or `code` payload — which
 * lives in `value`, never in children — stays literal. This transformer's own
 * nodes are not descended into: their text has already been read against its
 * source, and reading it again only rebuilds what is there.
 */
function transformChildren(node: MarkdownNode, source: string): void {
    const children = node.children;
    if (!Array.isArray(children)) return;

    let rewritten: MarkdownNode[] | null = null;
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.type === AUTHORED_ESCAPE_MDAST_TYPE) {
            rewritten?.push(child);
            continue;
        }
        if (child.type === "text") {
            const pieces = splitTextNode(child, source);
            if (pieces) {
                rewritten ??= children.slice(0, index);
                rewritten.push(...pieces);
                continue;
            }
        } else {
            transformChildren(child, source);
        }
        rewritten?.push(child);
    }

    if (rewritten) node.children = rewritten;
}

/**
 * No options of its own. Typed as remark's own option bag rather than an empty
 * one because one of the two registrations is made by hand, into the slice
 * whose entries all carry that type, instead of through `$remark`.
 */
export type AuthoredEscapeRemarkOptions = Record<string, unknown>;

/**
 * Records, on every text node, which of its characters the author escaped.
 *
 * Registered twice, and both registrations are load-bearing:
 *
 * Ahead of every other transformer, because each splitter — the commonmark
 * preset's soft line breaks, wikilinks, footnotes — replaces a text node with
 * fragments that carry no source position. Reaching the tree first means every
 * escape is already a node by the time a fragment exists, so a fragment needs
 * no provenance of its own.
 *
 * After every other transformer, because a family may hand a construct back as
 * text: the math family demotes a `$…$` span the Pandoc rules reject into text
 * built from its own source, escapes and all. Such a node carries its position,
 * so this pass reads it exactly like any other. The pass is idempotent: a node
 * this transformer already split matches its source character for character,
 * and no escape is found in it a second time.
 */
export function createAuthoredEscapeRemarkPlugin(): RemarkPluginRaw<AuthoredEscapeRemarkOptions> {
    // A fresh function per registration, deliberately: unified identifies an
    // attacher by the function itself and merges a second use of the same one
    // into the first, which would silently leave the tree walked once.
    return function authoredEscapes() {
        return (tree, file) => {
            transformChildren(tree as MarkdownNode, String(file));
        };
    };
}

/** One entry of `mdast-util-to-markdown`'s escaping table. */
export interface UnsafePattern {
    character?: string | undefined;
    atBreak?: boolean | undefined;
    inConstruct?: string | string[] | undefined;
}

/** The position info the writer hands every handler. */
export interface WriterInfo {
    before: string;
    after: string;
}

/** A node as the writer's handlers see it. */
interface WriterNode {
    type: string;
    value?: unknown;
    mode?: unknown;
    children?: WriterNode[];
}

/**
 * The slice of `mdast-util-to-markdown`'s serializer state this module uses.
 *
 * Declared here rather than imported so the plugin does not depend on a package
 * the workspace does not depend on directly, the same way the math family
 * declares the part of the state it needs.
 */
interface WriterState {
    unsafe: UnsafePattern[];
    handlers: Record<string, TextHandler>;
    safe(value: string, config: WriterInfo): string;
    containerPhrasing(node: WriterNode, info: WriterInfo): string;
}

export type TextHandler = (
    node: WriterNode,
    parent: unknown,
    state: WriterState,
    info: WriterInfo,
) => string;

/**
 * Characters whose escape the writer must keep even in ordinary prose, because
 * dropping it changes which characters the file holds rather than what they
 * mean.
 *
 * An `&` before a name would be read back as a character reference and the
 * ampersand would be gone from the text; a `\` against a line ending would be
 * read back as a hard break and the backslash would be gone with it; a space
 * there is dropped by the next parse, and two are a hard break. A backslash in
 * front of punctuation needs no entry: the writer always escapes that one,
 * whatever this table says.
 */
const IDENTITY_CHARACTERS = new Set(["\\", "&", " ", "\t", "\r", "\n"]);

const PHRASING = "phrasing";

/**
 * The same pattern with ordinary prose taken out of its scope, or null when
 * prose was its whole scope.
 *
 * These are the escapes this layer stops adding: whether a `[`, `*`, `_` or
 * backtick in prose is inert has no local answer, and the author's own source
 * already says whether they escaped it. Everything else in the table stays in
 * force — a pattern that fires at a line start protects the block structure the
 * serializer is writing, and a pattern scoped to a construct protects that
 * construct's own delimiters. Both are the serializer's business; neither is a
 * judgement about the author's prose.
 *
 * A pattern may name prose alongside a construct — GFM's footnote extension
 * scopes `[` to label, phrasing and reference in one entry — so prose is
 * removed from the scope rather than the whole pattern being dropped.
 */
function withoutProse(pattern: UnsafePattern): UnsafePattern | null {
    if (pattern.atBreak) return pattern;
    const character = pattern.character;
    if (character === undefined || IDENTITY_CHARACTERS.has(character)) {
        return pattern;
    }
    const construct = pattern.inConstruct;
    const scope = typeof construct === "string" ? [construct] : construct;
    if (!scope || !scope.includes(PHRASING)) return pattern;
    const rest = scope.filter((name) => name !== PHRASING);
    return rest.length === 0 ? null : { ...pattern, inConstruct: rest };
}

/**
 * The escaping table with prose removed from every pattern that named it.
 *
 * Cached per table so the writer's compiled patterns — which it caches on the
 * pattern objects themselves — are reused rather than rebuilt on every node.
 */
const withoutProsePatterns = new WeakMap<UnsafePattern[], UnsafePattern[]>();

export function proseSafeUnsafe(unsafe: UnsafePattern[]): UnsafePattern[] {
    const cached = withoutProsePatterns.get(unsafe);
    if (cached) return cached;
    const narrowed: UnsafePattern[] = [];
    for (const pattern of unsafe) {
        const kept = withoutProse(pattern);
        if (kept) narrowed.push(kept);
    }
    withoutProsePatterns.set(unsafe, narrowed);
    return narrowed;
}

/**
 * `mdast-util-to-markdown`'s own `text` handler, for a composition where no
 * syntax family installed one of its own.
 */
function defaultText(
    node: WriterNode,
    _parent: unknown,
    state: WriterState,
    info: WriterInfo,
): string {
    return state.safe(typeof node.value === "string" ? node.value : "", info);
}

/**
 * Wraps the `text` handler a syntax family owns so it stops escaping the
 * characters whose escapes belong to the author.
 *
 * Wrapping rather than replacing is what lets that family keep its handler: the
 * math family's writer still decides which dollars are fences, and this layer
 * only narrows the table it decides against.
 */
function authoredText(inner: TextHandler): TextHandler {
    return (node, parent, state, info) => {
        const unsafe = state.unsafe;
        state.unsafe = proseSafeUnsafe(unsafe);
        try {
            return inner(node, parent, state, info);
        } finally {
            state.unsafe = unsafe;
        }
    };
}

/** The text a mark node wraps, or null when it wraps anything else. */
function markedText(node: WriterNode): string | null {
    const children = node.children;
    if (!Array.isArray(children)) return null;
    let value = "";
    for (const child of children) {
        if (child.type !== "text" || typeof child.value !== "string") return null;
        value += child.value;
    }
    return value;
}

/**
 * Writes a marked run: the author's own backslashes for a run read out of the
 * source, and the writer's full escaping for a run whose source could not be
 * read — or one that turns out to hold anything but text, which is the same
 * question answered the same way.
 */
function authoredEscapeHandler(inner: TextHandler): TextHandler {
    return (node, parent, state, info) => {
        const mode = node.mode;
        const value = mode === "auto" ? null : markedText(node);
        if (value !== null) return writeAuthoredEscapes(value);

        // The fallback writes the run through the handler this layer wrapped,
        // which is what the editor did for every run before provenance existed.
        // The table is already the full one here: it is narrowed only for the
        // duration of the wrapped handler, and this is not inside one.
        const handlers = state.handlers;
        const wrapped = handlers.text;
        handlers.text = inner;
        try {
            return state.containerPhrasing(node, info);
        } finally {
            handlers.text = wrapped;
        }
    };
}

/** Installs both handlers over whichever `text` handler is in place. */
export function authoredEscapeHandlers(
    handlers: Record<string, TextHandler> | undefined,
): Record<string, TextHandler> {
    const inner = handlers?.text ?? defaultText;
    return {
        ...handlers,
        text: authoredText(inner),
        [AUTHORED_ESCAPE_MDAST_TYPE]: authoredEscapeHandler(inner),
    };
}
