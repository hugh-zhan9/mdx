// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { $remark } from "@milkdown/kit/utils";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { createBaseMilkdownPlugins } from "../milkdown/base-plugins";
import type { EditorAdapterDiagnostic } from "../adapter/types";

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) await mounted.pop()?.destroy();
    document.body.innerHTML = "";
});

/**
 * Serialization is failed at a real seam: a stringify handler that throws, the
 * same shape a syntax plugin's serializer takes. `remainingFailures` is read at
 * call time, so the failure can be turned on and off between edits.
 */
let remainingFailures = 0;

const failingParagraphSerializer = $remark("mdxFailingSerializer", () => {
    return function failingSerializer(this: {
        data(): { toMarkdownExtensions?: unknown[] };
    }) {
        const data = this.data();
        const extensions = data.toMarkdownExtensions ?? [];
        extensions.push({
            handlers: {
                paragraph: (...args: unknown[]) => {
                    if (remainingFailures > 0) {
                        remainingFailures -= 1;
                        throw new Error("serializer unavailable");
                    }
                    void args;
                    return "PARAGRAPH";
                },
            },
        } as never);
        data.toMarkdownExtensions = extensions;
    };
});

interface Harness {
    host: MilkdownEditorHost;
    changes: string[];
    diagnostics: EditorAdapterDiagnostic[];
}

async function mount(markdown: string): Promise<Harness> {
    const root = document.createElement("div");
    document.body.append(root);
    const harness: Harness = {
        host: null as unknown as MilkdownEditorHost,
        changes: [],
        diagnostics: [],
    };
    harness.host = await createMilkdownEditorHost({
        root,
        markdown,
        editable: true,
        plugins: [
            ...createBaseMilkdownPlugins(),
            ...failingParagraphSerializer.flat(),
        ],
        onMarkdownChange: (next) => harness.changes.push(next),
        onSelectionChange: () => {},
        onDiagnostic: (diagnostic) => harness.diagnostics.push(diagnostic),
    });
    mounted.push(harness.host);
    return harness;
}

afterEach(() => {
    remainingFailures = 0;
});

describe("regression: a serialization failure does not silence the surface forever", () => {
    // The failure used to latch: once one attempt failed, every later attempt
    // returned immediately, so every keystroke after it was discarded in
    // silence and exactly one diagnostic was ever reported.
    it("proves the injected failure actually fires", async () => {
        const harness = await mount("start\n");
        remainingFailures = 1;

        harness.host.replaceSourceRange({ anchor: 5, head: 5 }, " one");
        harness.host.flush();

        expect(harness.diagnostics.map((entry) => entry.code)).toContain(
            "editor_serialize_failed",
        );
        expect(harness.changes).toEqual([]);
        expect(harness.host.hasFailed()).toBe(true);
    });

    it("delivers the held edit once serialization works again", async () => {
        const harness = await mount("start\n");
        remainingFailures = 1;
        harness.host.replaceSourceRange({ anchor: 5, head: 5 }, " one");
        harness.host.flush();
        expect(harness.changes).toEqual([]);

        harness.host.flush();

        // The held edit is delivered rather than discarded. Its content cannot
        // be asserted here: the injected handler replaces paragraph output, so
        // the arrival of a change is the observable that matters.
        expect(harness.changes.length).toBeGreaterThan(0);
        expect(harness.host.hasFailed()).toBe(false);
        expect(harness.diagnostics.map((entry) => entry.code)).toContain(
            "editor_serialize_recovered",
        );
    });

    it("reports the failure only once while it persists", async () => {
        const harness = await mount("start\n");
        remainingFailures = 3;

        harness.host.replaceSourceRange({ anchor: 5, head: 5 }, " one");
        harness.host.flush();
        harness.host.flush();
        harness.host.flush();

        const failures = harness.diagnostics.filter(
            (entry) => entry.code === "editor_serialize_failed",
        );
        expect(failures).toHaveLength(1);
    });
});
