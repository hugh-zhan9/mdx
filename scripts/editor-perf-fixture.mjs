/**
 * Deterministic mixed-syntax Markdown fixtures for the `D-015` performance
 * measurement (`docs/loopx/design/2026-08-12-milkdown-editor-migration/需求设计文档.md`
 * section 9.2).
 *
 * The generator is pure: no clock, no `Math.random`, no environment reads, no
 * filesystem. The same seed and the same byte target always produce the same
 * bytes, on Node and inside the app's WebView alike, which is what lets a
 * measurement be tied to an exact fixture by checksum.
 *
 * The document is *mixed*, not one construct repeated: prose dominates the way
 * it does in a real note, and every syntax family the product claims — YAML and
 * TOML frontmatter, GitHub callouts (known and unknown kinds), mermaid, inline
 * and block math, footnote calls with their definitions, wikilinks with and
 * without aliases, raw block and inline HTML, unknown `:::` container
 * directives that fall back to preserved source, GFM tables, nested and task
 * lists, and fenced code including a nested fence — appears in proportions a
 * document of this size would plausibly carry. A fixture that exercised one
 * cheap construct would measure nothing.
 *
 * This module is imported by `scripts/generate-editor-perf-fixtures.mjs` and by
 * the gated qualification route under `app/`, so both produce byte-identical
 * text from the same seed.
 */

/** Byte target for the small fixture: exactly 100 KiB. */
export const FIXTURE_100_KIB_BYTES = 100 * 1024;

/** Byte target for the large fixture: exactly 1 MiB. */
export const FIXTURE_1_MIB_BYTES = 1024 * 1024;

/**
 * The pinned fixture set. Ids are what a measurement artifact names, so they
 * are part of the measurement contract and must not be renamed casually.
 */
export const EDITOR_PERF_FIXTURES = [
    { id: "mixed-100kib", seed: "mdx-p007-100kib", bytes: FIXTURE_100_KIB_BYTES },
    { id: "mixed-1mib", seed: "mdx-p007-1mib", bytes: FIXTURE_1_MIB_BYTES },
];

/** FNV-1a over the seed string, so a readable seed becomes a 32-bit state. */
function seedToState(seed) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    // A zero state would make mulberry32 degenerate, and an all-ones state is
    // no better an entry point than any other; nudging keeps both away.
    return hash === 0 ? 0x9e3779b9 : hash;
}

/** mulberry32. Chosen because it is short enough to audit by reading it. */
function createRandom(seed) {
    let state = seedToState(seed);
    return function next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

const ENCODER = new TextEncoder();

/** UTF-8 byte length. The fixtures carry CJK, so character counts would lie. */
export function byteLength(text) {
    return ENCODER.encode(text).length;
}

const EN_WORDS = [
    "adapter", "boundary", "callout", "canonical", "checksum", "clipboard",
    "commit", "composition", "contract", "diagnostic", "document", "editor",
    "fallback", "fingerprint", "fixture", "footnote", "frontmatter", "gate",
    "handle", "harness", "invariant", "latency", "layout", "lifecycle",
    "markdown", "measurement", "migration", "offset", "outline", "paragraph",
    "parser", "pipeline", "preserve", "qualification", "reference", "revision",
    "roundtrip", "sanitizer", "schema", "selection", "serializer", "session",
    "snapshot", "source", "surface", "threshold", "transformer", "workspace",
];

const ZH_WORDS = [
    "编辑器", "适配器", "文档", "语法", "解析", "序列化", "回归", "契约",
    "光标", "选区", "输入法", "组合", "候选", "提交", "撤销", "重做",
    "剪贴板", "拖拽", "焦点", "无障碍", "对比度", "性能", "延迟", "采样",
    "阈值", "构建", "发布", "回滚", "指纹", "冲突", "草稿", "保真",
];

const CODE_LANGS = ["ts", "tsx", "js", "python", "bash", "json", "rust"];

const CALLOUT_KINDS = [
    "NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION",
    // Unknown kinds are deliberate: the callout family claims any `[!...]`, and
    // an unknown one must not fall through to the CommonMark serializer.
    "BANANA", "NOT A TYPE", "",
];

const DIRECTIVE_NAMES = ["spoiler", "note", "warning", "figure", "aside"];

const EMOJI = ["📐", "🧪", "🚧", "✅", "🈶", "👩‍👩‍👧‍👦"];

/** Combining sequences, kept separate so the fixture is not pure BMP ASCII. */
const COMBINING = ["é", "ä", "ô", "각"];

function pick(random, items) {
    return items[Math.floor(random() * items.length) % items.length];
}

function intBetween(random, low, high) {
    return low + Math.floor(random() * (high - low + 1));
}

/** A deterministic run of words, mixing English and CJK the way notes do. */
function words(random, count) {
    const parts = [];
    for (let index = 0; index < count; index += 1) {
        parts.push(random() < 0.22 ? pick(random, ZH_WORDS) : pick(random, EN_WORDS));
    }
    return parts.join(" ");
}

function sentence(random) {
    const text = words(random, intBetween(random, 6, 16));
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * Inline decoration for one sentence.
 *
 * Every inline family the syntax layer owns is reachable from here, and the
 * caller decides how often. A footnote call is only ever emitted through
 * {@link paragraphBlock} so the definition can be written with it.
 */
function decorate(random, text, state) {
    const decorations = [];
    if (random() < 0.30) decorations.push(`**${words(random, 2)}**`);
    if (random() < 0.24) decorations.push(`*${words(random, 2)}*`);
    if (random() < 0.22) decorations.push("`" + words(random, 2) + "`");
    if (random() < 0.20) {
        decorations.push(`[${words(random, 2)}](https://example.com/${state.linkIndex++})`);
    }
    if (random() < 0.18) {
        const target = `${pick(random, EN_WORDS)}-${state.linkIndex++}`;
        decorations.push(
            random() < 0.5 ? `[[${target}]]` : `[[${target}|${words(random, 2)}]]`,
        );
    }
    if (random() < 0.16) {
        decorations.push(`$${pick(random, ["x^2", "\\alpha_i", "\\frac{a}{b}", "e^{i\\pi}"])}$`);
    }
    if (random() < 0.10) decorations.push(`<kbd>${pick(random, ["Command", "Shift", "Esc"])}</kbd>`);
    if (random() < 0.10) decorations.push(pick(random, EMOJI));
    if (random() < 0.08) decorations.push(pick(random, COMBINING));
    if (random() < 0.08) decorations.push(`~~${words(random, 2)}~~`);
    if (decorations.length === 0) return text;
    return `${text.slice(0, -1)} ${decorations.join(" ")}.`;
}

function paragraphBlock(random, state) {
    const lines = [];
    const count = intBetween(random, 2, 5);
    for (let index = 0; index < count; index += 1) {
        lines.push(decorate(random, sentence(random), state));
    }
    let text = lines.join(" ");
    if (random() < 0.14) {
        const label = `fn-${state.footnoteIndex++}`;
        text += `[^${label}]`;
        state.pendingFootnotes.push(label);
    }
    return text;
}

function headingBlock(random, state) {
    // Level 1 only at the very top; the rest walk 2..4 so the outline is a tree
    // rather than a flat run of siblings.
    const level = state.headingIndex === 0 ? 1 : intBetween(random, 2, 4);
    state.headingIndex += 1;
    return `${"#".repeat(level)} ${state.headingIndex}. ${words(random, intBetween(random, 2, 5))}`;
}

function listBlock(random, state) {
    const ordered = random() < 0.35;
    const lines = [];
    const items = intBetween(random, 3, 7);
    for (let index = 0; index < items; index += 1) {
        const marker = ordered ? `${index + 1}.` : "-";
        lines.push(`${marker} ${decorate(random, sentence(random), state)}`);
        if (random() < 0.45) {
            const nested = intBetween(random, 1, 3);
            for (let child = 0; child < nested; child += 1) {
                const childMarker = ordered ? `${child + 1}.` : "-";
                lines.push(`    ${childMarker} ${words(random, intBetween(random, 4, 10))}`);
                if (random() < 0.30) {
                    lines.push(
                        `        - [${random() < 0.5 ? "x" : " "}] ${words(random, intBetween(random, 3, 8))}`,
                    );
                }
            }
        }
    }
    return lines.join("\n");
}

function codeBlock(random) {
    const language = pick(random, CODE_LANGS);
    const lines = [];
    const count = intBetween(random, 3, 12);
    for (let index = 0; index < count; index += 1) {
        lines.push(`const ${pick(random, EN_WORDS)}${index} = ${intBetween(random, 0, 9999)};`);
    }
    if (random() < 0.12) {
        // A nested fence: the outer fence has to be longer, and a generator that
        // never produced one would never exercise the fence-length path.
        return ["````" + language, "```js", ...lines, "```", "````"].join("\n");
    }
    return ["```" + language, ...lines, "```"].join("\n");
}

function tableBlock(random) {
    const columns = intBetween(random, 2, 5);
    const header = [];
    const divider = [];
    for (let index = 0; index < columns; index += 1) {
        header.push(pick(random, EN_WORDS));
        divider.push(pick(random, ["---", ":--", "--:", ":-:"]));
    }
    const rows = [`| ${header.join(" | ")} |`, `| ${divider.join(" | ")} |`];
    const count = intBetween(random, 2, 8);
    for (let index = 0; index < count; index += 1) {
        const cells = [];
        for (let column = 0; column < columns; column += 1) {
            cells.push(
                random() < 0.2
                    ? "`" + pick(random, EN_WORDS) + "`"
                    : words(random, intBetween(random, 1, 3)),
            );
        }
        rows.push(`| ${cells.join(" | ")} |`);
    }
    return rows.join("\n");
}

function calloutBlock(random, state) {
    const kind = pick(random, CALLOUT_KINDS);
    const title = random() < 0.5 ? ` ${words(random, intBetween(random, 1, 3))}` : "";
    const lines = [`> [!${kind}]${title}`];
    const count = intBetween(random, 1, 4);
    for (let index = 0; index < count; index += 1) {
        lines.push(`> ${decorate(random, sentence(random), state)}`);
    }
    return lines.join("\n");
}

function mathBlock(random) {
    const body = pick(random, [
        "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
        "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
        "E = mc^2",
        "\\begin{aligned} a &= b + c \\\\ d &= e - f \\end{aligned}",
    ]);
    return ["$$", body, "$$"].join("\n");
}

function mermaidBlock(random) {
    const nodes = intBetween(random, 2, 5);
    const lines = ["```mermaid", pick(random, ["graph TD", "graph LR", "flowchart TD"])];
    for (let index = 0; index < nodes; index += 1) {
        lines.push(`  N${index}[${pick(random, ZH_WORDS)}] --> N${index + 1}[${pick(random, EN_WORDS)}]`);
    }
    lines.push("```");
    return lines.join("\n");
}

function htmlBlock(random) {
    if (random() < 0.4) {
        return [
            "<details>",
            `  <summary>${words(random, intBetween(random, 2, 4))}</summary>`,
            `  <p>${sentence(random)}</p>`,
            "</details>",
        ].join("\n");
    }
    return [
        `<div class="custom-block" data-index="${intBetween(random, 0, 999)}">`,
        `  <p>${sentence(random)}</p>`,
        "</div>",
    ].join("\n");
}

function directiveBlock(random, state) {
    const name = pick(random, DIRECTIVE_NAMES);
    const lines = [`:::${name}`];
    const count = intBetween(random, 1, 3);
    for (let index = 0; index < count; index += 1) {
        lines.push(decorate(random, sentence(random), state));
    }
    lines.push(":::");
    return lines.join("\n");
}

function quoteBlock(random, state) {
    const lines = [];
    const count = intBetween(random, 1, 3);
    for (let index = 0; index < count; index += 1) {
        lines.push(`> ${decorate(random, sentence(random), state)}`);
    }
    return lines.join("\n");
}

function footnoteDefinitions(random, state) {
    const lines = [];
    for (const label of state.pendingFootnotes) {
        lines.push(`[^${label}]: ${sentence(random)}`);
        if (random() < 0.3) {
            lines.push(`    ${sentence(random)}`);
        }
        lines.push("");
    }
    state.pendingFootnotes = [];
    // Trailing blank line is added by the block joiner, not here.
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
}

/**
 * Block mix, as cumulative weights. Prose dominates; the expensive families
 * (mermaid, math, tables, HTML, directives) appear often enough that a 1 MiB
 * document carries hundreds of them, which is the point of the fixture.
 */
const BLOCK_WEIGHTS = [
    ["paragraph", 40],
    ["heading", 10],
    ["list", 12],
    ["code", 10],
    ["table", 6],
    ["callout", 6],
    ["math", 4],
    ["mermaid", 3],
    ["html", 3],
    ["directive", 2],
    ["quote", 3],
    ["rule", 1],
];

const TOTAL_WEIGHT = BLOCK_WEIGHTS.reduce((sum, entry) => sum + entry[1], 0);

function chooseBlockKind(random) {
    let ticket = random() * TOTAL_WEIGHT;
    for (const [kind, weight] of BLOCK_WEIGHTS) {
        ticket -= weight;
        if (ticket <= 0) return kind;
    }
    return "paragraph";
}

function renderBlock(kind, random, state) {
    switch (kind) {
        case "heading":
            return headingBlock(random, state);
        case "list":
            return listBlock(random, state);
        case "code":
            return codeBlock(random);
        case "table":
            return tableBlock(random);
        case "callout":
            return calloutBlock(random, state);
        case "math":
            return mathBlock(random);
        case "mermaid":
            return mermaidBlock(random);
        case "html":
            return htmlBlock(random);
        case "directive":
            return directiveBlock(random, state);
        case "quote":
            return quoteBlock(random, state);
        case "rule":
            return "---";
        default:
            return paragraphBlock(random, state);
    }
}

/** Frontmatter. YAML for one fixture and TOML for the other, chosen by seed. */
function frontmatterBlock(random, seed) {
    const toml = random() < 0.5;
    if (toml) {
        return [
            "+++",
            `title = "Loam qualification fixture"`,
            `seed = "${seed}"`,
            `tags = ["performance", "qualification"]`,
            "+++",
        ].join("\n");
    }
    return [
        "---",
        "title: Loam qualification fixture",
        `seed: ${seed}`,
        "tags:",
        "  - performance",
        "  - qualification",
        "---",
    ].join("\n");
}

/** Padding that lands the document on an exact byte count. ASCII only. */
function padding(byteCount) {
    if (byteCount <= 0) return "";
    // A run of ASCII words: one byte per character, so the requested byte count
    // is also the character count, and no multi-byte sequence can be split.
    const unit = "padding ";
    let text = "";
    while (text.length < byteCount) text += unit;
    text = text.slice(0, byteCount);
    // A Markdown line must not end in a space: two trailing spaces are a hard
    // break and one is stripped on the round trip, which would move the bytes.
    if (text.endsWith(" ")) text = `${text.slice(0, -1)}.`;
    return text;
}

/**
 * Generates the fixture text for one seed and one exact byte target.
 *
 * The result is exactly `targetBytes` bytes of UTF-8, ending in a newline.
 * Throws when the target is too small to hold the frontmatter and one block,
 * rather than silently producing a document that exercises nothing.
 */
export function generateEditorPerfFixture({ seed, targetBytes }) {
    if (!Number.isInteger(targetBytes) || targetBytes < 4096) {
        throw new Error(
            `targetBytes must be an integer of at least 4096; received ${String(targetBytes)}`,
        );
    }

    const random = createRandom(seed);
    const state = {
        headingIndex: 0,
        linkIndex: 0,
        footnoteIndex: 0,
        pendingFootnotes: [],
    };

    const blocks = [frontmatterBlock(random, seed)];
    let size = byteLength(blocks[0]) + 1;

    // Reserve room for the footnote definitions still owed and for the final
    // padding block, so the document never has to be truncated mid-construct.
    const reserve = 2048;
    let sinceFootnoteFlush = 0;

    while (size < targetBytes - reserve) {
        const kind = chooseBlockKind(random);
        const block = renderBlock(kind, random, state);
        blocks.push(block);
        size += byteLength(block) + 2;
        sinceFootnoteFlush += 1;

        // Definitions are flushed near their calls, the way a real document
        // keeps them per section rather than all at the end.
        if (state.pendingFootnotes.length > 0 && sinceFootnoteFlush >= 6) {
            const definitions = footnoteDefinitions(random, state);
            if (definitions.length > 0) {
                blocks.push(definitions);
                size += byteLength(definitions) + 2;
            }
            sinceFootnoteFlush = 0;
        }
    }

    if (state.pendingFootnotes.length > 0) {
        const definitions = footnoteDefinitions(random, state);
        blocks.push(definitions);
        size += byteLength(definitions) + 2;
    }

    if (blocks.length < 2) {
        throw new Error("fixture target is too small to hold any content block");
    }

    // `blocks.join("\n\n") + "\n"` is `size` bytes. The padding block adds
    // `2 + n` for a separator and n bytes of ASCII.
    const deficit = targetBytes - size;
    if (deficit < 2) {
        throw new Error(
            `fixture overshot its target by ${String(2 - deficit)} bytes; the reserve is too small`,
        );
    }
    blocks.push(padding(deficit - 2));

    const text = `${blocks.join("\n\n")}\n`;
    const actual = byteLength(text);
    if (actual !== targetBytes) {
        throw new Error(
            `fixture is ${String(actual)} bytes but ${String(targetBytes)} were requested`,
        );
    }
    return text;
}

/**
 * Counts the syntax families present, so a fixture can be shown to be mixed
 * rather than asserted to be. Used by the generator CLI and by the harness
 * artifact, and reported alongside the checksum.
 */
export function fixtureSyntaxProfile(text) {
    const lines = text.split("\n");
    const count = (pattern) => {
        const matches = text.match(pattern);
        return matches === null ? 0 : matches.length;
    };

    // Frontmatter delimiters are `---` / `+++` lines that must not be counted
    // as thematic breaks or as anything else; the body starts after them.
    const frontmatterFence = lines[0] === "---" ? "---" : lines[0] === "+++" ? "+++" : null;
    let bodyStart = 0;
    if (frontmatterFence !== null) {
        const close = lines.indexOf(frontmatterFence, 1);
        bodyStart = close < 0 ? 0 : close + 1;
    }
    const body = lines.slice(bodyStart);

    return {
        bytes: byteLength(text),
        lines: lines.length,
        frontmatter: frontmatterFence === null ? 0 : 1,
        headings: body.filter((line) => /^#{1,6} /.test(line)).length,
        callouts: body.filter((line) => /^> \[![^\]\n]*\]/.test(line)).length,
        mermaidFences: count(/^```mermaid$/gm),
        // Opening fences that name a language, mermaid excluded: closing fences
        // and mermaid are counted on their own so none is counted twice.
        codeFences: body.filter(
            (line) => /^`{3,4}[a-z]+$/.test(line) && line !== "```mermaid",
        ).length,
        blockMath: count(/^\$\$$/gm) / 2,
        inlineMath: count(/\$[^$\n]+\$/g),
        footnoteCalls: count(/\[\^[^\]\s]+\](?!:)/g),
        footnoteDefinitions: count(/^\[\^[^\]\s]+\]:/gm),
        wikilinks: count(/\[\[[^\]\n]+\]\]/g),
        links: count(/\]\(https:\/\//g),
        htmlBlocks: count(/^<(div|details)\b/gm),
        inlineHtml: count(/<kbd>/g),
        directives: count(/^:::[a-z]+$/gm),
        tableRows: body.filter((line) => /^\|.*\|$/.test(line)).length,
        listItems: body.filter((line) => /^\s*(-|\d+\.) /.test(line)).length,
        taskItems: count(/^\s*- \[[ x]\] /gm),
        thematicBreaks: body.filter((line) => line === "---").length,
        emoji: count(/[\u{1F300}-\u{1FAFF}]/gu),
        cjkCharacters: count(/[一-鿿]/g),
    };
}
