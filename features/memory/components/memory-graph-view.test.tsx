// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryGraphView } from "./memory-graph-view";
import type { StoredItem } from "../lib/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function chunk(id: string, file: string): StoredItem {
  return {
    drawerId: id,
    kind: "material",
    room: "corporate-action",
    sourceFile: file,
    addedAt: "2026-08-14",
    importance: 0,
    statement: null,
    status: null,
    excerpt: `素材 ${id}`,
    supportingRefs: [],
    verificationRefs: [],
    counterexampleRefs: [],
  };
}

/** A pointer event jsdom can build: React dispatches by type, not by class. */
function pointer(type: string, x: number, y: number) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
}

describe("MemoryGraphView", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function mount(overrides: {
    material?: StoredItem[];
    onSelect?: (drawerId: string) => void;
  } = {}) {
    act(() => {
      root.render(
        <MemoryGraphView
          material={
            overrides.material ?? [
              chunk("ev_1", "notes/one.md"),
              chunk("ev_2", "notes/one.md"),
              chunk("ev_3", "notes/one.md"),
            ]
          }
          conclusions={[]}
          onSelect={overrides.onSelect ?? (() => {})}
          onFindSimilar={async () => []}
        />,
      );
    });
  }

  it("does not take the pointer until it is dragged", () => {
    // Capturing on pointerdown is what made the dots unclickable: while a capture
    // is active the browser retargets the click to the capturing element, so every
    // click landed on the canvas and nothing drawn on it could be pressed.
    mount();

    const svg = host.querySelector("svg");

    if (!svg) throw new Error("Expected the canvas to be rendered.");

    const capture = vi.fn();
    svg.setPointerCapture = capture;
    svg.releasePointerCapture = vi.fn();

    act(() => {
      svg.dispatchEvent(pointer("pointerdown", 100, 100));
      svg.dispatchEvent(pointer("pointermove", 101, 101));
    });

    expect(capture).not.toHaveBeenCalled();

    act(() => {
      svg.dispatchEvent(pointer("pointermove", 140, 130));
    });

    // Past the slop it is a pan, and then the capture is what keeps panning working
    // when the pointer leaves the canvas.
    expect(capture).toHaveBeenCalled();
  });

  it("opens a document into its chunks when it is clicked", () => {
    mount();

    // One document, standing for three chunks.
    expect(host.querySelectorAll("circle")).toHaveLength(1);

    const node = host.querySelector("svg g");

    act(() => {
      node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The document, plus the three chunks it holds.
    expect(host.querySelectorAll("circle")).toHaveLength(4);
  });

  it("opens an entry when a chunk is clicked", () => {
    const onSelect = vi.fn();
    // A chunk with no source file is drawn on its own, with no document above it.
    mount({ material: [{ ...chunk("ev_1", ""), sourceFile: null }], onSelect });

    act(() => {
      host
        .querySelector("svg g")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith("ev_1");
  });
});
