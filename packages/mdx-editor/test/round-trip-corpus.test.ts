// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    fromLineFeeds,
    readLineEndingStyle,
} from "../adapter/line-endings";
import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";
import {
    roundTripCorpus,
    roundTripExceptions,
    type RoundTripCase,
} from "./syntax-fixtures";

/**
 * The membership rule for the preservation layer, as a check.
 *
 * "Any construct whose unedited round-trip does not reproduce its original
 * bytes belongs to the preservation layer" is only a rule if something fails
 * when it is broken. That is this file: every corpus document is opened, edited
 * outside the construct under test, serialized, and compared byte-for-byte.
 *
 * Documents that diverge today are named in `roundTripExceptions` with what the
 * divergence costs. Those are asserted to *still* diverge, so the list is a
 * debt register that can only shrink: fixing a construct without deleting its
 * entry fails, and so does reintroducing a divergence someone removed.
 */

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) {
        await mounted.pop()?.destroy();
    }
    document.body.innerHTML = "";
});

const LEADING_ANCHOR = "Anchor.\n\n";
const TRAILING_ANCHOR = "\nAnchor.\n";

/**
 * The document to open and the offset the edit goes at.
 *
 * Serialization only runs once a transaction dirties the document, so every
 * comparison has to edit first, and the edit has to land outside the construct
 * being measured — an insertion inside a list, a fence or a table contaminates
 * the very bytes under test. A separate anchor paragraph is that outside.
 *
 * The anchor takes the entry's own line ending. It is scaffolding, and an
 * anchor written with `\n` would turn a CRLF entry into a mixed-ending
 * document — which normalizes by design, so the comparison would be measuring
 * the scaffolding rather than the construct.
 */
function anchored(entry: RoundTripCase): { document: string; at: number } {
    const { style } = readLineEndingStyle(entry.markdown);
    const leading = fromLineFeeds(LEADING_ANCHOR, style);
    const trailing = fromLineFeeds(TRAILING_ANCHOR, style);
    if ((entry.anchor ?? "before") === "before") {
        return { document: `${leading}${entry.markdown}`, at: 0 };
    }
    return {
        document: `${entry.markdown}${trailing}`,
        at: entry.markdown.length + trailing.indexOf("A"),
    };
}

async function roundTrip(
    entry: RoundTripCase,
): Promise<{ expected: string; actual: string }> {
    const { document: source, at } = anchored(entry);
    const root = document.createElement("div");
    document.body.append(root);
    const host = await createMilkdownEditorHost({
        root,
        markdown: source,
        editable: true,
        plugins: createMdxMilkdownPlugins(),
        onMarkdownChange: () => {},
        onSelectionChange: () => {},
    });
    mounted.push(host);

    // A refused edit would leave the document unserialized, and `getMarkdown()`
    // would echo the input back — passing every comparison below without ever
    // exercising the serializer.
    expect(
        host.replaceSourceRange({ anchor: at, head: at }, "X"),
        `${entry.name}: the anchor edit was refused`,
    ).toBe(true);
    host.flush();

    return {
        expected: `${source.slice(0, at)}X${source.slice(at)}`,
        actual: host.getMarkdown(),
    };
}

const exceptionsByName = new Map(
    roundTripExceptions.map((entry) => [entry.name, entry.reason]),
);

describe("preservation membership — every construct reproduces its own bytes", () => {
    it("names a corpus document for every exception", () => {
        const corpusNames = new Set(roundTripCorpus.map((entry) => entry.name));
        const orphans = roundTripExceptions
            .map((entry) => entry.name)
            .filter((name) => !corpusNames.has(name));
        // An exception naming nothing is an exception nobody can retire: the
        // check that would clear it never runs.
        expect(orphans).toEqual([]);
    });

    it("has no duplicate names to hide one document behind another", () => {
        const names = roundTripCorpus.map((entry) => entry.name);
        expect(new Set(names).size).toBe(names.length);
    });

    for (const entry of roundTripCorpus) {
        const reason = exceptionsByName.get(entry.name);

        if (reason === undefined) {
            it(`reproduces ${entry.name}`, async () => {
                const { expected, actual } = await roundTrip(entry);
                expect(actual).toBe(expected);
            }, 20000);
            continue;
        }

        it(`still diverges: ${entry.name}`, async () => {
            const { expected, actual } = await roundTrip(entry);
            expect(
                actual,
                `"${entry.name}" now reproduces its own bytes — delete its entry from roundTripExceptions (${reason})`,
            ).not.toBe(expected);
        }, 20000);
    }
});
