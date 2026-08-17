// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
    createMilkdownEditorHost,
    type MilkdownEditorHost,
} from "../milkdown/editor-host";
import { createMdxMilkdownPlugins } from "../syntax/milkdown";

/**
 * Milkdown's readiness timers outlive the editor, and nothing can stop them.
 *
 * `@milkdown/ctx`'s `Timer.start()` registers a global listener and schedules a
 * rejection for `timeout` milliseconds later — and throws the `setTimeout`
 * handle away. Nothing keeps it: `Clock.remove()` only deletes the clock's map
 * entry, and `Editor.destroy()` runs plugin cleanups and never touches the
 * clock at all. So every timer the editor waited on during `create()` leaves a
 * three-second callback that fires after `destroy()`, whatever the caller does.
 *
 * That callback calls the bare global `removeEventListener`. In a browser it
 * exists and the call removes a listener that is already gone. Under vitest,
 * if the test file's jsdom environment is torn down inside those three seconds,
 * it does not exist, and the run reports `ReferenceError: removeEventListener
 * is not defined` as an unhandled error attributed to whichever file happens to
 * be running — with the warning that it "might cause false positive tests".
 *
 * This file is the standing account of what that error is and what it can do,
 * so the warning is never taken on faith and never silenced on faith either. It
 * asserts the leak exists; if a Milkdown version ever cancels the timer, this
 * file fails, and deleting it is the right response.
 */

/** `createTimer`'s default timeout in `@milkdown/ctx`. */
const TIMER_TIMEOUT_MS = 3000;

/** The readiness timers `Editor.create()` waits on, by event name. */
const READINESS_TIMERS = [
    "CommandsReady",
    "ConfigReady",
    "EditorStateReady",
    "EditorViewReady",
    "InitReady",
    "KeymapReady",
    "ParserReady",
    "PasteRuleReady",
    "SchemaReady",
    "SerializerReady",
];

interface ListenerTraffic {
    /** Timer event names added, in the phase they were added in. */
    added: string[];
    removed: string[];
}

interface Recorded {
    duringCreate: ListenerTraffic;
    duringDestroy: ListenerTraffic;
    afterTimeout: ListenerTraffic;
    /** Timer listeners still registered when the recording stopped. */
    stillRegistered: number;
    /** Removals naming a listener that was no longer registered. */
    redundantRemovals: number;
    rejections: unknown[];
}

const mounted: MilkdownEditorHost[] = [];

afterEach(async () => {
    while (mounted.length > 0) await mounted.pop()?.destroy();
    document.body.innerHTML = "";
});

function isTimerEvent(type: string): boolean {
    return READINESS_TIMERS.includes(type);
}

async function recordOneEditorLifetime(): Promise<Recorded> {
    const phases: Record<string, ListenerTraffic> = {
        create: { added: [], removed: [] },
        destroy: { added: [], removed: [] },
        after: { added: [], removed: [] },
    };
    let phase = "create";
    let redundantRemovals = 0;
    const registered = new Set<unknown>();
    const rejections: unknown[] = [];

    const realAdd = globalThis.addEventListener.bind(globalThis);
    const realRemove = globalThis.removeEventListener.bind(globalThis);
    const onRejection = (reason: unknown): void => {
        rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);

    globalThis.addEventListener = ((
        type: string,
        listener: never,
        options: never,
    ) => {
        if (isTimerEvent(type)) {
            phases[phase].added.push(type);
            registered.add(listener);
        }
        return realAdd(type, listener, options);
    }) as typeof globalThis.addEventListener;

    globalThis.removeEventListener = ((
        type: string,
        listener: never,
        options: never,
    ) => {
        if (isTimerEvent(type)) {
            phases[phase].removed.push(type);
            if (!registered.delete(listener)) redundantRemovals += 1;
        }
        return realRemove(type, listener, options);
    }) as typeof globalThis.removeEventListener;

    try {
        const root = document.createElement("div");
        document.body.append(root);
        const host = await createMilkdownEditorHost({
            root,
            markdown: "hello\n",
            editable: true,
            plugins: createMdxMilkdownPlugins(),
            onMarkdownChange: () => {},
            onSelectionChange: () => {},
        });
        mounted.push(host);

        phase = "destroy";
        await mounted.pop()?.destroy();

        phase = "after";
        // Real time, because the timer is a real `setTimeout` this code has no
        // handle on: there is nothing to advance and nothing to flush.
        await new Promise((resolve) =>
            setTimeout(resolve, TIMER_TIMEOUT_MS + 400),
        );
    } finally {
        globalThis.addEventListener = realAdd;
        globalThis.removeEventListener = realRemove;
        process.off("unhandledRejection", onRejection);
    }

    return {
        duringCreate: phases.create,
        duringDestroy: phases.destroy,
        afterTimeout: phases.after,
        stillRegistered: registered.size,
        redundantRemovals,
        rejections,
    };
}

describe("milkdown readiness timers — what outlives destroy(), and what it can do", () => {
    it("fires a rejection destroy() could not cancel, and the rejection is inert", async () => {
        const recorded = await recordOneEditorLifetime();

        // Creation waited on every readiness timer, and every one of them
        // resolved: a timer that had not resolved would still hold its
        // listener, and `create()` would not have returned at all.
        expect([...recorded.duringCreate.added].sort()).toEqual(
            READINESS_TIMERS,
        );
        expect([...recorded.duringCreate.removed].sort()).toEqual(
            READINESS_TIMERS,
        );
        expect(recorded.stillRegistered).toBe(0);

        // `destroy()` reaches none of it. There is no handle to reach: the
        // `setTimeout` return value is discarded inside `Timer`, `Clock.remove`
        // deletes a map entry and nothing else, and no public API is given the
        // timer at all. Nothing in this repository's teardown can fix that.
        expect(recorded.duringDestroy).toEqual({ added: [], removed: [] });

        // Three seconds later the rejection Milkdown scheduled during creation
        // arrives — once per timer, with the editor long gone. This is the
        // callback that throws when the environment has been torn down.
        expect([...recorded.afterTimeout.removed].sort()).toEqual(
            READINESS_TIMERS,
        );
        expect(recorded.afterTimeout.added).toEqual([]);

        // And it can do nothing. Every removal it makes names a listener that
        // was removed when the timer resolved, so it changes no listener state;
        // the promise it would reject settled during `create()`, so no
        // rejection is delivered and none is left unhandled. The
        // `ReferenceError` a torn-down environment produces therefore replaces
        // no work: it is noise in the report, not a result anything depends on.
        expect(recorded.redundantRemovals).toBe(READINESS_TIMERS.length);
        expect(recorded.rejections).toEqual([]);
    }, 30000);
});
