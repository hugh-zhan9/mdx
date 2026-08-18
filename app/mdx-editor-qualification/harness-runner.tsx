"use client";

/**
 * The `D-015` measurement protocol, as it runs inside the app.
 *
 * Loaded only on the client (see `page.tsx`): everything here reads the live
 * document, the WebView's capabilities and the URL, none of which exist during
 * prerender, and a server-rendered guess at any of them would end up recorded
 * as environment metadata on a measurement artifact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MarkdownEditorAdapter } from "@/packages/mdx-editor";
import type {
    EditorAdapterDiagnostic,
    EditorSurfaceMode,
    MarkdownEditorAdapterHandle,
} from "@/packages/mdx-editor";
import {
    EDITOR_PERF_FIXTURES,
    fixtureSyntaxProfile,
    generateEditorPerfFixture,
} from "@/scripts/editor-perf-fixture.mjs";
/** Artifact schema version. The verifier refuses anything it does not know. */
const ARTIFACT_SCHEMA = "mdx-editor-qualification/1";

/** `D-015`: at least 200 valid input samples and 200 valid IME samples each. */
const REQUIRED_INPUT_SAMPLES = 200;

/** `D-015`: at least 20 mode switches in each direction, after warm-up. */
const REQUIRED_MODE_SWITCHES = 20;
const MODE_SWITCH_WARMUP = 3;

/** `D-015`: 30 seconds of continuous scrolling under a `PerformanceObserver`. */
const SCROLL_SECONDS = 30;

/** How many cold mounts the first-editable phase takes before reporting. */
const FIRST_EDITABLE_SAMPLES = 5;

/**
 * `?smoke=1` shrinks every count so the protocol can be exercised end to end
 * in a development browser in under a minute.
 *
 * It is deliberately not a knob a real run could reach by accident: a smoke run
 * stamps its own artifact as disqualified, and the verifier refuses it twice
 * over — once for the reduced counts and once for the development build.
 */
function smokeCounts(): {
    smoke: boolean;
    firstEditable: number;
    input: number;
    modeSwitch: number;
    scrollSeconds: number;
} {
    const smoke =
        typeof location !== "undefined" &&
        new URLSearchParams(location.search).get("smoke") === "1";
    return smoke
        ? {
              smoke,
              firstEditable: 2,
              input: 12,
              modeSwitch: 2,
              scrollSeconds: 3,
          }
        : {
              smoke,
              firstEditable: FIRST_EDITABLE_SAMPLES,
              input: REQUIRED_INPUT_SAMPLES,
              modeSwitch: REQUIRED_MODE_SWITCHES,
              scrollSeconds: SCROLL_SECONDS,
          };
}

/** Frames a sample may wait for the DOM to show the change before it is void. */
const MUTATION_DEADLINE_FRAMES = 30;

type Phase =
    | "first-editable"
    | "input-latency"
    | "ime-latency"
    | "mode-switch"
    | "long-task-scroll";

/**
 * What produced the input that a latency sample measures.
 *
 * `user` is a real key event or a real composition — the operating system put
 * it there, whether a person's finger or macOS automation pressed the key. It
 * is the only driver `AC-014` can be reported from.
 *
 * `execCommand` is the scripted pass. Chromium inserts the text but does not
 * fire `beforeinput` for `document.execCommand`, so those samples are anchored
 * on `input`, which is strictly after the DOM has already changed and therefore
 * a *shorter* interval than the contract defines. They are kept as a cheap
 * regression signal and the verifier never counts them toward the threshold.
 */
type SampleDriver = "user" | "execCommand";

/** Which event started the clock. */
type SampleAnchor = "beforeinput" | "input" | "compositionend" | null;

interface Sample {
    phase: Phase;
    fixtureId: string;
    /** Mode-switch direction, `null` for phases that have none. */
    direction: "wysiwyg->source" | "source->wysiwyg" | null;
    index: number;
    valid: boolean;
    /** Milliseconds, or `null` when the sample never completed. */
    ms: number | null;
    /** Why an invalid sample is invalid. `null` when it is valid. */
    reason: string | null;
    /** Discarded warm-up samples are recorded but never counted. */
    warmup: boolean;
    driver: SampleDriver;
    anchor: SampleAnchor;
}

interface LongTaskEntry {
    fixtureId: string;
    startTime: number;
    duration: number;
    name: string;
}

interface FixtureRecord {
    id: string;
    seed: string;
    bytes: number;
    sha256: string | null;
    syntaxProfile: Record<string, number>;
}

interface HarnessArtifact {
    schema: string;
    contract: "D-015";
    /** Wall clock, for the record only. No measurement reads it. */
    recordedAtIso: string;
    /**
     * False whenever anything about the run disqualifies it — a development
     * build, a browser rather than the app, a missing commit stamp. The
     * verifier refuses to report a pass for a run that is not qualifying, and
     * the page never overrides this.
     */
    qualifying: boolean;
    disqualifications: string[];
    environment: Record<string, unknown>;
    fixtures: FixtureRecord[];
    samples: Sample[];
    longTasks: LongTaskEntry[];
    /**
     * Longest gap between consecutive animation frames during the scroll phase.
     * This is NOT the `D-015` long-task measurement; it is recorded so a run on
     * a WebView without the Long Tasks API still carries evidence, and it is
     * never substituted for the contract measurement.
     */
    scrollFrameGaps: { fixtureId: string; maxGapMs: number; frames: number }[];
    notes: string[];
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

/**
 * Resolves after the paint of the frame whose rendering step is running now.
 *
 * Must be called from inside a `requestAnimationFrame` callback, or from a
 * microtask chained to one. A rAF callback runs *before* the frame is painted,
 * so it cannot itself be the end of an input-latency measurement; a task posted
 * from inside it runs after that paint, which is the first moment the change is
 * on screen.
 *
 * Scheduling a *second* `requestAnimationFrame` here instead would land on the
 * following frame and add a whole frame — around 16 ms against a 50 ms
 * threshold — to every sample.
 */
function afterThisPaint(): Promise<number> {
    return new Promise((resolve) => {
        setTimeout(() => resolve(performance.now()), 0);
    });
}

function sleepFrames(count: number): Promise<void> {
    return (async () => {
        for (let index = 0; index < count; index += 1) await nextFrame();
    })();
}

async function sha256Hex(text: string): Promise<string | null> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function percentile(values: number[], fraction: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    // Nearest-rank: the smallest value at or above the requested fraction of
    // the sample. No interpolation, and never a mean.
    const rank = Math.ceil(fraction * sorted.length);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Valid attended samples per fixture and phase, keyed `fixtureId/phase`.
 *
 * Only `driver: "user"` samples are counted: they are the ones the verifier
 * will accept, so the counter on screen has to be the count that matters, not
 * a larger number the operator would stop at too early.
 */
function countValid(samples: Sample[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const sample of samples) {
        if (!sample.valid || sample.warmup || sample.driver !== "user") continue;
        if (sample.phase !== "input-latency" && sample.phase !== "ime-latency") {
            continue;
        }
        const key = `${sample.fixtureId}/${sample.phase}`;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

/**
 * The deepest editable text node with enough text to hold a caret.
 *
 * The harness needs somewhere to type. It finds it the way a click does — by
 * walking the rendered text — rather than by naming a selector the editor
 * package owns, which would make this page depend on implementation-private
 * DOM the adapter contract forbids callers to know.
 */
function findCaretTarget(container: HTMLElement): Text | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
        const text = node as Text;
        const parent = text.parentElement;
        if (
            text.data.trim().length >= 40 &&
            parent !== null &&
            parent.isContentEditable
        ) {
            return text;
        }
        node = walker.nextNode();
    }
    return null;
}

/** The nearest descendant that actually scrolls, or the container itself. */
function findScrollTarget(container: HTMLElement): HTMLElement {
    const queue: HTMLElement[] = [container];
    let best: HTMLElement = container;
    let bestOverflow = container.scrollHeight - container.clientHeight;
    while (queue.length > 0) {
        const node = queue.shift();
        if (node === undefined) break;
        const overflow = node.scrollHeight - node.clientHeight;
        if (overflow > bestOverflow) {
            best = node;
            bestOverflow = overflow;
        }
        for (const child of Array.from(node.children)) {
            if (child instanceof HTMLElement) queue.push(child);
        }
    }
    return best;
}

interface MountRecord {
    /** `performance.now()` captured as the adapter element is created. */
    markedAt: number;
    documentId: string;
}


export default function HarnessRunner() {
    const [fixtureIndex, setFixtureIndex] = useState(0);
    const [mode, setMode] = useState<EditorSurfaceMode>("wysiwyg");
    const [documentGeneration, setDocumentGeneration] = useState(0);
    const [status, setStatus] = useState("idle");
    const [log, setLog] = useState<string[]>([]);
    const [artifactText, setArtifactText] = useState("");
    const [counters, setCounters] = useState<Record<string, number>>({});
    const [running, setRunning] = useState(false);

    const handleRef = useRef<MarkdownEditorAdapterHandle | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const samplesRef = useRef<Sample[]>([]);
    const longTasksRef = useRef<LongTaskEntry[]>([]);
    const frameGapsRef = useRef<HarnessArtifact["scrollFrameGaps"]>([]);
    const notesRef = useRef<string[]>([]);
    const diagnosticsRef = useRef<EditorAdapterDiagnostic[]>([]);
    const mountRef = useRef<MountRecord | null>(null);
    const readyResolversRef = useRef<((at: number) => void)[]>([]);
    /** Incremented by a MutationObserver for every editor DOM change. */
    const mutationCountRef = useRef(0);
    /** True while the scripted pass types, so the user recorder stands down. */
    const scriptedPassRef = useRef(false);
    const activeFixtureRef = useRef(EDITOR_PERF_FIXTURES[0].id);

    const fixtures = useMemo(
        () =>
            EDITOR_PERF_FIXTURES.map((descriptor) => ({
                ...descriptor,
                text: generateEditorPerfFixture({
                    seed: descriptor.seed,
                    targetBytes: descriptor.bytes,
                }),
            })),
        [],
    );

    const fixture = fixtures[fixtureIndex];
    const documentId = `${fixture.id}#${String(documentGeneration)}`;

    // The mount mark. React renders the adapter element on this line, commits
    // it, then runs the adapter's own effect, so this is the last moment before
    // the adapter starts building — the closest a caller can stand to the
    // adapter's mount without reaching inside the package.
    if (mountRef.current?.documentId !== documentId) {
        mountRef.current = { markedAt: performance.now(), documentId };
    }

    // Stable identity: a fresh snapshot object on every render would ask the
    // adapter to re-evaluate the document mid-measurement, and the keystrokes
    // the run has just made are not in `fixture.text`.
    const snapshot = useMemo(
        () => ({
            documentId,
            revision: documentGeneration,
            markdown: fixture.text,
        }),
        [documentGeneration, documentId, fixture.text],
    );

    const append = useCallback((line: string) => {
        setLog((previous) => [...previous.slice(-200), line]);
    }, []);

    const onReady = useCallback(() => {
        // First editable is the first animation frame *after* `onReady`.
        requestAnimationFrame(() => {
            const at = performance.now();
            const resolvers = readyResolversRef.current;
            readyResolversRef.current = [];
            for (const resolve of resolvers) resolve(at);
        });
    }, []);

    const waitForReady = useCallback(
        () =>
            new Promise<number>((resolve) => {
                readyResolversRef.current.push(resolve);
            }),
        [],
    );

    // Editor DOM mutations, counted so a latency sample can require that the
    // change actually reached the DOM before the paint it was measured to.
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) return;
        const observer = new MutationObserver(() => {
            mutationCountRef.current += 1;
        });
        observer.observe(container, {
            subtree: true,
            childList: true,
            characterData: true,
        });
        return () => observer.disconnect();
    }, []);

    const counts = useMemo(() => smokeCounts(), []);

    const environment = useMemo(() => {
        const supported = PerformanceObserver.supportedEntryTypes ?? [];
        const nav = navigator as Navigator & { deviceMemory?: number };
        const tauri = Object.keys(globalThis).some((key) =>
            key.toLowerCase().startsWith("__tauri"),
        );
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            deviceMemoryGiB: nav.deviceMemory ?? null,
            devicePixelRatio: window.devicePixelRatio,
            screen: { width: screen.width, height: screen.height },
            viewport: { width: window.innerWidth, height: window.innerHeight },
            webAssetsProfile: process.env.NODE_ENV,
            appCommit: process.env.NEXT_PUBLIC_MDX_BUILD_COMMIT ?? null,
            appVersion: process.env.NEXT_PUBLIC_MDX_APP_VERSION ?? null,
            runtime: tauri ? "tauri" : "browser",
            longTaskObserverSupported: supported.includes("longtask"),
            supportedEntryTypes: supported,
            qualificationSurfaceEnv: true,
        };
    }, []);

    const record = useCallback((sample: Sample) => {
        samplesRef.current.push(sample);
    }, []);

    /**
     * Measures one latency: from `t0` to the paint that shows the change.
     *
     * The change has to be observed, not assumed. Frames pass until the
     * MutationObserver has seen the editor DOM move; the paint of *that* frame
     * — the first one carrying the change — ends the measurement. A sample whose
     * change never appears is recorded as invalid with a reason rather than
     * dropped, because a run that quietly discarded its failures would report a
     * p95 over the samples that happened to work.
     */
    const measureToPaint = useCallback(
        async (t0: number, mutationsBefore: number): Promise<
            { ms: number; reason: null } | { ms: null; reason: string }
        > => {
            for (let frame = 0; frame < MUTATION_DEADLINE_FRAMES; frame += 1) {
                // Wait for a frame first. At `beforeinput` the browser has not
                // applied the change yet, so a check before the first frame can
                // only ever be false — and answering it there would push the
                // measurement onto the frame after the one that showed the
                // change.
                await nextFrame();
                if (mutationCountRef.current > mutationsBefore) {
                    // Still inside this frame's rendering step: the paint has
                    // not happened, and a task posted now runs just after it.
                    const paintedAt = await afterThisPaint();
                    return { ms: paintedAt - t0, reason: null };
                }
            }
            return { ms: null, reason: "no-dom-mutation-within-deadline" };
        },
        [],
    );

    const focusCaret = useCallback((): string | null => {
        const container = containerRef.current;
        if (container === null) return "no-container";
        handleRef.current?.focus();
        const target = findCaretTarget(container);
        if (target === null) return "no-editable-text-node";
        const selection = window.getSelection();
        if (selection === null) return "no-selection-api";
        const range = document.createRange();
        const offset = Math.min(20, Math.max(target.data.length - 1, 0));
        range.setStart(target, offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return null;
    }, []);

    const runFirstEditable = useCallback(async () => {
        for (let index = 0; index < counts.firstEditable; index += 1) {
            setStatus(
                `first-editable ${String(index + 1)}/${String(counts.firstEditable)}`,
            );
            const readyAt = waitForReady();
            // A new documentId forces a cold build of the whole document:
            // syntax parse, schema, and every NodeView, which is exactly what
            // `D-015` includes in first-editable.
            setDocumentGeneration((generation) => generation + 1);
            const at = await readyAt;
            const mark = mountRef.current;
            record({
                phase: "first-editable",
                fixtureId: activeFixtureRef.current,
                direction: null,
                index,
                valid: mark !== null,
                ms: mark === null ? null : at - mark.markedAt,
                reason: mark === null ? "no-mount-mark" : null,
                warmup: false,
                driver: "user",
                anchor: null,
            });
            await sleepFrames(10);
        }
    }, [counts.firstEditable, record, waitForReady]);

    /**
     * The scripted input pass. Supplementary evidence, never the gate.
     *
     * `document.execCommand("insertText")` is the only way a page can insert
     * text into a contenteditable without a real key event, and Chromium does
     * not fire `beforeinput` for it — verified: the text lands, the `input`
     * event fires, and a `beforeinput` listener in the capture phase sees
     * nothing. `D-015` anchors input latency on `beforeinput`, so these samples
     * are anchored on `input` instead, which starts the clock *after* the DOM
     * has already changed and therefore reports a shorter interval than the
     * contract defines.
     *
     * They are recorded with `driver: "execCommand"` and the verifier does not
     * count them. Anchoring the gate on them would report a number that looks
     * fine and measures something else, which is exactly what `D-015` forbids.
     */
    const runScriptedInputPass = useCallback(async () => {
        const container = containerRef.current;
        if (container === null) return;
        const failure = focusCaret();
        if (failure !== null) {
            record({
                phase: "input-latency",
                fixtureId: activeFixtureRef.current,
                direction: null,
                index: 0,
                valid: false,
                ms: null,
                reason: failure,
                warmup: false,
                driver: "execCommand",
                anchor: null,
            });
            return;
        }

        // Read through functions: the listeners write during `execCommand`, and
        // control-flow narrowing would otherwise still believe the values were
        // cleared before the call.
        const seen: {
            beforeInput: { t0: number; inputType: string } | null;
            input: { t0: number; inputType: string } | null;
        } = { beforeInput: null, input: null };
        const takeBeforeInput = () => seen.beforeInput;
        const takeInput = () => seen.input;
        const onBeforeInput = (event: Event) => {
            const detail = event as InputEvent;
            seen.beforeInput = {
                t0: performance.now(),
                inputType: detail.inputType,
            };
        };
        const onInput = (event: Event) => {
            const detail = event as InputEvent;
            seen.input = { t0: performance.now(), inputType: detail.inputType };
        };
        // Suppress the always-on user recorder: on an engine that *does* fire
        // `beforeinput` for `execCommand`, a scripted keystroke would otherwise
        // be recorded as if a person had typed it.
        scriptedPassRef.current = true;
        container.addEventListener("beforeinput", onBeforeInput, true);
        container.addEventListener("input", onInput, true);

        try {
            // 10 warm-up keystrokes: the first insertion into a freshly built
            // document pays for work no later keystroke repeats.
            const total = counts.input + 10;
            for (let index = 0; index < total; index += 1) {
                const warmup = index < 10;
                if (index % 20 === 0) {
                    setStatus(
                        `scripted-input ${String(index)}/${String(total)} on ${activeFixtureRef.current}`,
                    );
                    await sleepFrames(1);
                }
                seen.beforeInput = null;
                seen.input = null;
                const mutationsBefore = mutationCountRef.current;
                const inserted = document.execCommand(
                    "insertText",
                    false,
                    "abcdefghij"[index % 10],
                );
                const observed = takeBeforeInput() ?? takeInput();
                const anchor: SampleAnchor =
                    takeBeforeInput() === null ? "input" : "beforeinput";
                if (!inserted || observed === null) {
                    record({
                        phase: "input-latency",
                        fixtureId: activeFixtureRef.current,
                        direction: null,
                        index,
                        valid: false,
                        ms: null,
                        reason: inserted
                            ? "no-beforeinput-or-input-event"
                            : "insertText-refused",
                        warmup,
                        driver: "execCommand",
                        anchor: null,
                    });
                    await sleepFrames(2);
                    continue;
                }
                const inputType = observed.inputType;
                const result = await measureToPaint(observed.t0, mutationsBefore);
                record({
                    phase: "input-latency",
                    fixtureId: activeFixtureRef.current,
                    direction: null,
                    index,
                    valid:
                        result.reason === null && inputType.startsWith("insert"),
                    ms: result.ms,
                    reason:
                        result.reason ??
                        (inputType.startsWith("insert")
                            ? null
                            : `unexpected-input-type:${inputType}`),
                    warmup,
                    driver: "execCommand",
                    anchor,
                });
                await sleepFrames(2);
            }
        } finally {
            container.removeEventListener("beforeinput", onBeforeInput, true);
            container.removeEventListener("input", onInput, true);
            scriptedPassRef.current = false;
        }
    }, [counts.input, focusCaret, measureToPaint, record]);

    const runModeSwitch = useCallback(async () => {
        const handle = handleRef.current;
        if (handle === null) return;
        const total = counts.modeSwitch + MODE_SWITCH_WARMUP;
        for (let index = 0; index < total; index += 1) {
            for (const target of ["source", "wysiwyg"] as EditorSurfaceMode[]) {
                const direction =
                    target === "source" ? "wysiwyg->source" : "source->wysiwyg";
                setStatus(
                    `mode-switch ${String(index + 1)}/${String(total)} ${direction}`,
                );
                const readyAt = waitForReady();
                const t0 = performance.now();
                const result = await handle.setMode(target);
                if (!result.ok) {
                    readyResolversRef.current = [];
                    record({
                        phase: "mode-switch",
                        fixtureId: activeFixtureRef.current,
                        direction,
                        index,
                        valid: false,
                        ms: null,
                        reason: `setMode-refused:${result.code}`,
                        warmup: index < MODE_SWITCH_WARMUP,
                        driver: "user",
                        anchor: null,
                    });
                    continue;
                }
                setMode(target);
                const at = await readyAt;
                record({
                    phase: "mode-switch",
                    fixtureId: activeFixtureRef.current,
                    direction,
                    index,
                    valid: true,
                    ms: at - t0,
                    reason: null,
                    warmup: index < MODE_SWITCH_WARMUP,
                    driver: "user",
                    anchor: null,
                });
                await sleepFrames(4);
            }
        }
    }, [counts.modeSwitch, record, waitForReady]);

    const runLongTaskScroll = useCallback(async () => {
        const container = containerRef.current;
        if (container === null) return;
        const scroller = findScrollTarget(container);
        const fixtureId = activeFixtureRef.current;
        const collected: LongTaskEntry[] = [];
        let observer: PerformanceObserver | null = null;
        if (environment.longTaskObserverSupported) {
            observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    collected.push({
                        fixtureId,
                        startTime: entry.startTime,
                        duration: entry.duration,
                        name: entry.name,
                    });
                }
            });
            observer.observe({ type: "longtask", buffered: false });
        } else {
            notesRef.current.push(
                "PerformanceObserver does not support `longtask` in this WebView; " +
                    "the D-015 long-task measurement could not be taken.",
            );
        }

        const endAt = performance.now() + counts.scrollSeconds * 1000;
        let previousFrame = performance.now();
        let maxGap = 0;
        let frames = 0;
        let direction = 1;
        while (performance.now() < endAt) {
            await nextFrame();
            const now = performance.now();
            const gap = now - previousFrame;
            previousFrame = now;
            if (gap > maxGap) maxGap = gap;
            frames += 1;
            const limit = scroller.scrollHeight - scroller.clientHeight;
            if (limit <= 0) break;
            let next = scroller.scrollTop + direction * 120;
            if (next >= limit) {
                next = limit;
                direction = -1;
            } else if (next <= 0) {
                next = 0;
                direction = 1;
            }
            scroller.scrollTop = next;
            if (frames % 60 === 0) {
                setStatus(
                    `long-task scroll ${String(Math.round((endAt - now) / 1000))}s left`,
                );
            }
        }
        // Drain before disconnecting. A `PerformanceObserver` callback is
        // itself a task, so entries produced by the last few seconds of
        // scrolling can still be queued when the loop ends; disconnecting
        // straight away discards exactly the entries a slow finish produced,
        // which is the direction that would flatter the result.
        await sleepFrames(5);
        for (const entry of observer?.takeRecords() ?? []) {
            collected.push({
                fixtureId,
                startTime: entry.startTime,
                duration: entry.duration,
                name: entry.name,
            });
        }
        observer?.disconnect();
        longTasksRef.current.push(...collected);
        frameGapsRef.current.push({ fixtureId, maxGapMs: maxGap, frames });
        record({
            phase: "long-task-scroll",
            fixtureId,
            direction: null,
            index: 0,
            valid: environment.longTaskObserverSupported && frames > 0,
            ms: collected.reduce((worst, entry) => Math.max(worst, entry.duration), 0),
            reason: environment.longTaskObserverSupported
                ? frames > 0
                    ? null
                    : "no-frames-observed"
                : "longtask-entry-type-unsupported",
            warmup: false,
            driver: "user",
            anchor: null,
        });
    }, [counts.scrollSeconds, environment.longTaskObserverSupported, record]);

    /**
     * The attended input recorder — the only source of `AC-014` input samples.
     *
     * `beforeinput` is what `D-015` anchors input latency on, and only a real
     * key event produces one: a script can insert text, but it cannot make the
     * engine dispatch `beforeinput` (verified against Chromium's
     * `document.execCommand("insertText")`, which inserts the character and
     * fires only `input`). So the samples that count come from a real keyboard
     * — a person's, or macOS automation driving the same key events into the
     * app. The recorder is always armed; the operator types into the fixture
     * until the counter reaches the required sample count.
     */
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) return;
        let index = 0;

        const onBeforeInput = (event: Event) => {
            if (scriptedPassRef.current) return;
            const detail = event as InputEvent;
            // A composition's own `beforeinput` belongs to the IME measurement,
            // which is anchored on the commit, not on each candidate keystroke.
            if (detail.isComposing) return;
            if (!detail.inputType.startsWith("insert")) return;
            const t0 = performance.now();
            const mutationsBefore = mutationCountRef.current;
            const current = index;
            index += 1;
            void (async () => {
                const result = await measureToPaint(t0, mutationsBefore);
                record({
                    phase: "input-latency",
                    fixtureId: activeFixtureRef.current,
                    direction: null,
                    index: current,
                    valid: result.reason === null,
                    ms: result.ms,
                    reason: result.reason,
                    warmup: false,
                    driver: "user",
                    anchor: "beforeinput",
                });
                setCounters(countValid(samplesRef.current));
            })();
        };

        container.addEventListener("beforeinput", onBeforeInput, true);
        return () => {
            container.removeEventListener("beforeinput", onBeforeInput, true);
        };
    }, [measureToPaint, record]);

    // Attended IME recorder. A real IME cannot be driven from script, so the
    // composition samples are collected while a human types with a real input
    // method. Nothing here synthesizes a composition: a synthetic composition
    // event does not put the editor into a composing state, and a number taken
    // from one would describe the harness, not the IME.
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) return;
        let mutationsAtStart = mutationCountRef.current;
        let index = 0;

        const onStart = () => {
            mutationsAtStart = mutationCountRef.current;
        };
        const onEnd = () => {
            const t0 = performance.now();
            const mutationsBefore = mutationsAtStart;
            const current = index;
            index += 1;
            void (async () => {
                const result = await measureToPaint(t0, mutationsBefore);
                record({
                    phase: "ime-latency",
                    fixtureId: activeFixtureRef.current,
                    direction: null,
                    index: current,
                    valid: result.reason === null,
                    ms: result.ms,
                    reason: result.reason,
                    warmup: false,
                    driver: "user",
                    anchor: "compositionend",
                });
                setCounters(countValid(samplesRef.current));
            })();
        };

        container.addEventListener("compositionstart", onStart, true);
        container.addEventListener("compositionend", onEnd, true);
        return () => {
            container.removeEventListener("compositionstart", onStart, true);
            container.removeEventListener("compositionend", onEnd, true);
        };
    }, [measureToPaint, record]);

    const buildArtifact = useCallback(async (): Promise<HarnessArtifact> => {
        const records: FixtureRecord[] = [];
        for (const entry of fixtures) {
            records.push({
                id: entry.id,
                seed: entry.seed,
                bytes: entry.bytes,
                sha256: await sha256Hex(entry.text),
                syntaxProfile: fixtureSyntaxProfile(entry.text) as unknown as Record<
                    string,
                    number
                >,
            });
        }

        const disqualifications: string[] = [];
        if (environment.webAssetsProfile !== "production") {
            disqualifications.push(
                `web assets were built with NODE_ENV=${String(environment.webAssetsProfile)}; D-015 requires release web assets`,
            );
        }
        if (environment.runtime !== "tauri") {
            disqualifications.push(
                "the run was not inside the Tauri app; D-015 requires a release-like Tauri build",
            );
        }
        if (environment.appCommit === null) {
            disqualifications.push(
                "NEXT_PUBLIC_MDX_BUILD_COMMIT was not baked into the build; the app commit cannot be recorded",
            );
        }
        if (counts.smoke) {
            disqualifications.push(
                "the run used the reduced `?smoke=1` sample counts, which are below every D-015 minimum",
            );
        }
        if (records.some((entry) => entry.sha256 === null)) {
            disqualifications.push(
                "SubtleCrypto was unavailable, so the fixture checksums could not be computed",
            );
        }

        return {
            schema: ARTIFACT_SCHEMA,
            contract: "D-015",
            recordedAtIso: new Date().toISOString(),
            qualifying: disqualifications.length === 0,
            disqualifications,
            environment: {
                ...environment,
                adapterDiagnostics: diagnosticsRef.current,
            },
            fixtures: records,
            samples: samplesRef.current,
            longTasks: longTasksRef.current,
            scrollFrameGaps: frameGapsRef.current,
            notes: notesRef.current,
        };
    }, [counts.smoke, environment, fixtures]);

    const publish = useCallback(async () => {
        const artifact = await buildArtifact();
        const text = JSON.stringify(artifact, null, 2);
        setArtifactText(text);
        (
            globalThis as unknown as { __mdxQualificationArtifact?: HarnessArtifact }
        ).__mdxQualificationArtifact = artifact;
        return artifact;
    }, [buildArtifact]);

    const runAutomatable = useCallback(async () => {
        if (running) return;
        setRunning(true);
        // Discard only what this pass is about to produce again. The attended
        // samples are a person's typing — 200 keystrokes and 200 IME commits per
        // fixture — and a run that silently threw them away because the operator
        // pressed the button in the wrong order would cost an hour and look like
        // nothing had happened.
        samplesRef.current = samplesRef.current.filter(
            (sample) =>
                sample.driver === "user" &&
                (sample.phase === "input-latency" || sample.phase === "ime-latency"),
        );
        longTasksRef.current = [];
        frameGapsRef.current = [];
        notesRef.current = [];
        try {
            for (let index = 0; index < fixtures.length; index += 1) {
                activeFixtureRef.current = fixtures[index].id;
                setFixtureIndex(index);
                // No `waitForReady` here: switching to the fixture that is
                // already mounted would not rebuild anything, and a promise
                // waiting for a build that never starts would hang the run.
                // `runFirstEditable` forces its own cold builds.
                await sleepFrames(5);
                await runFirstEditable();
                await runScriptedInputPass();
                await runModeSwitch();
                await runLongTaskScroll();
                append(`finished ${fixtures[index].id}`);
            }
            notesRef.current.push(
                "IME composition samples are not produced by this pass. They are " +
                    "collected while a human types with a real input method; see " +
                    "docs/loopx/design/2026-08-12-milkdown-editor-migration/P-007-macos-manual-checklist.md.",
            );
            await publish();
            setStatus("done");
        } catch (error: unknown) {
            setStatus(
                `failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            setRunning(false);
        }
    }, [
        append,
        fixtures,
        publish,
        runFirstEditable,
        runScriptedInputPass,
        runLongTaskScroll,
        runModeSwitch,
        running,
    ]);

    // The runner is also reachable from script, so a development smoke run can
    // drive it without a click. It is the same protocol either way.
    useEffect(() => {
        const api = {
            run: runAutomatable,
            publish,
            samples: () => samplesRef.current,
        };
        (globalThis as unknown as { __mdxQualification?: typeof api }).__mdxQualification =
            api;
    }, [publish, runAutomatable]);

    const attendedTarget = counts.smoke ? 12 : REQUIRED_INPUT_SAMPLES;

    /**
     * Live p95 over the attended samples, by the same nearest-rank rule the
     * verifier uses. It is a progress read-out, not a verdict: the number that
     * counts is the one the verifier computes from the artifact.
     */
    const attendedP95 = (fixtureId: string, phase: Phase): string => {
        const value = percentile(
            samplesRef.current
                .filter(
                    (sample) =>
                        sample.phase === phase &&
                        sample.fixtureId === fixtureId &&
                        sample.driver === "user" &&
                        sample.valid &&
                        !sample.warmup,
                )
                .map((sample) => sample.ms)
                .filter((ms): ms is number => ms !== null),
            0.95,
        );
        return value === null ? "-" : `${value.toFixed(1)} ms`;
    };

    return (
        <main
            className="flex h-screen min-h-0 flex-col"
            data-mdx-qualification-harness=""
        >
            <header className="shrink-0 border-b p-3 font-mono text-xs">
                <div className="flex flex-wrap items-center gap-3">
                    <strong>D-015 qualification harness</strong>
                    <span data-qualification-status={status}>status: {status}</span>
                    <span>mode: {mode}</span>
                    {fixtures.map((entry, index) => (
                        <button
                            key={entry.id}
                            type="button"
                            className={
                                index === fixtureIndex
                                    ? "border px-2 py-1 font-bold underline"
                                    : "border px-2 py-1"
                            }
                            disabled={running}
                            onClick={() => {
                                activeFixtureRef.current = entry.id;
                                setFixtureIndex(index);
                            }}
                        >
                            {entry.id}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="border px-2 py-1"
                        disabled={running}
                        onClick={() => void runAutomatable()}
                        data-qualification-run=""
                    >
                        Run scripted protocol
                    </button>
                    <button
                        type="button"
                        className="border px-2 py-1"
                        onClick={() => void publish()}
                        data-qualification-publish=""
                    >
                        Build artifact JSON
                    </button>
                    <button
                        type="button"
                        className="border px-2 py-1"
                        onClick={() => {
                            void navigator.clipboard?.writeText(artifactText);
                        }}
                    >
                        Copy artifact JSON
                    </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-4">
                    <span>
                        Attended samples needed: {String(attendedTarget)} typed
                        keystrokes and {String(attendedTarget)} IME commits, on each
                        fixture. Only real key events count.
                    </span>
                    {fixtures.map((entry) => (
                        <span key={entry.id} data-qualification-progress={entry.id}>
                            {entry.id}: typed{" "}
                            {String(counters[`${entry.id}/input-latency`] ?? 0)}/
                            {String(attendedTarget)} (p95{" "}
                            {attendedP95(entry.id, "input-latency")}), IME{" "}
                            {String(counters[`${entry.id}/ime-latency`] ?? 0)}/
                            {String(attendedTarget)} (p95{" "}
                            {attendedP95(entry.id, "ime-latency")})
                        </span>
                    ))}
                </div>
                {log.length > 0 ? <div className="mt-1">{log.join(" | ")}</div> : null}
            </header>
            <div className="min-h-0 flex-1" ref={containerRef}>
                <MarkdownEditorAdapter
                    ref={handleRef}
                    snapshot={snapshot}
                    mode={mode}
                    editable
                    onChange={() => {}}
                    onSelectionChange={() => {}}
                    onModeChange={setMode}
                    onDiagnostic={(diagnostic) => {
                        diagnosticsRef.current.push(diagnostic);
                    }}
                    onOpenWikilink={() => {}}
                    onOpenLink={() => undefined}
                    onReady={onReady}
                />
            </div>
            {artifactText.length > 0 ? (
                <textarea
                    readOnly
                    className="h-40 shrink-0 border-t font-mono text-[10px]"
                    value={artifactText}
                    data-qualification-artifact=""
                />
            ) : null}
        </main>
    );
}
