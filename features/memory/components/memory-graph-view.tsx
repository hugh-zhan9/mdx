"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TextControlButton } from "@/common/components/ui-controls";
import type { StoredItem } from "../lib/types";
import {
  buildMemoryGraph,
  documentId,
  documentSource,
  motionFrame,
  placeGraph,
  type PlacedNode,
  type Point,
} from "../lib/memory-graph";

interface MemoryGraphViewProps {
  material: StoredItem[];
  conclusions: StoredItem[];
  onSelect: (drawerId: string) => void;
  /** Asks what a search considers close to one entry. */
  onFindSimilar: (drawerId: string) => Promise<string[]>;
}

/**
 * The canvas before it has been measured.
 *
 * Only ever on screen for the first frame. The layout used to be computed against
 * these two numbers permanently, with the viewBox fixed at 900×560 — so the drawing
 * kept a 900:560 letterbox inside whatever element it was given, and a window twice
 * as wide bought nothing but wider margins.
 */
const WIDTH = 900;
const HEIGHT = 560;

/** How far a pointer may travel before a press becomes a pan rather than a click. */
const DRAG_SLOP = 4;

/**
 * How long the picture takes to move from one arrangement to the next.
 *
 * Long enough to be seen as the same dots travelling, short enough that a second
 * click does not queue behind the first one's motion.
 */
const MOTION_MS = 550;

/** How long the globe takes to turn a clicked document round to the front. */
const SPIN_MS = 650;

/** Eased so the turn starts and lands gently — an abrupt stop reads as a jump. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The equivalent rotation within (-π, π], so the globe takes the short way round. */
function shortestTurn(angle: number): number {
  const wrapped = (((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  return wrapped - Math.PI;
}

/**
 * The library as relations: which conclusions stand on which material.
 *
 * Drawn as SVG rather than on a canvas because every node here is a thing you can
 * point at — hovering says what it is, clicking opens it — and giving each one a
 * real element is how that works without hit-testing coordinates by hand.
 *
 * The edge it draws is the only edge the library holds today. When entity
 * extraction has run, its triples are another set of edges over these same nodes,
 * and the layout takes them without changing shape.
 */
export function MemoryGraphView({
  material,
  conclusions,
  onSelect,
  onFindSimilar,
}: MemoryGraphViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * The element's real size in pixels.
   *
   * Measured rather than assumed, because the picture is laid out in these units and
   * the viewBox is set to them: one canvas pixel is one screen pixel at rest, the
   * drawing fills whatever room the panel has, and growing the window grows the
   * canvas instead of the margins around it.
   */
  const frame = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: WIDTH, h: HEIGHT });

  useEffect(() => {
    const element = frame.current;

    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;

      if (!rect || rect.width < 1 || rect.height < 1) return;

      setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  /**
   * The part of the canvas on screen, or null for "all of it".
   *
   * A thousand nodes do not fit at a readable size, so the frame moves instead of
   * the drawing shrinking: the wheel zooms about the pointer, a drag pans, and the
   * whole thing is one `viewBox` — no transform per node, and labels keep their size
   * while the picture scales. Null until someone zooms or pans, so a resized window
   * re-fits instead of holding a box measured for the old one.
   */
  const [view, setView] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const box = view ?? { x: 0, y: 0, w: size.w, h: size.h };
  /**
   * The press in progress, and whether it has become a pan.
   *
   * Pointer capture is taken only once the pointer has actually moved: while a
   * capture is active the browser retargets the click to the capturing element, so
   * capturing on pointerdown meant every click landed on the canvas and no dot on it
   * could ever be clicked.
   */
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    panning: boolean;
  } | null>(null);

  /** Zooms about the centre of what is on screen, which is what a button means. */
  const zoom = (factor: number) => {
    setView((current) => {
      const from = current ?? { x: 0, y: 0, w: size.w, h: size.h };
      const w = Math.min(size.w * 4, Math.max(size.w / 12, from.w * factor));
      const h = w * (size.h / size.w);

      return {
        x: from.x + (from.w - w) / 2,
        y: from.y + (from.h - h) / 2,
        w,
        h,
      };
    });
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;

    setView((current) => {
      const from = current ?? { x: 0, y: 0, w: size.w, h: size.h };
      // Zoom about the pointer rather than the centre: zooming into a corner is
      // the whole reason to zoom, and a centre-anchored zoom walks away from it.
      const scale = Math.exp(event.deltaY * 0.0015);
      const w = Math.min(size.w * 4, Math.max(size.w / 12, from.w * scale));
      const h = w * (size.h / size.w);

      return {
        x: from.x + (from.w - w) * px,
        y: from.y + (from.h - h) * py,
        w,
        h,
      };
    });
  };
  /**
   * Neighbours a search found, by the entry they were found from.
   *
   * Asked for, never computed on load: it is one query per entry, and it is the
   * machine's opinion rather than anything a person asserted — so it arrives when
   * someone asks and it is drawn so you can tell.
   */
  const [similar, setSimilar] = useState<Record<string, string[]>>({});
  /**
   * Documents whose chunks are drawn one by one.
   *
   * The default grain is one dot per document, because a project's material is
   * mostly chunks of a few files and a dot each made a thousand identical points.
   * Clicking a document opens it; clicking it again closes it.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const graph = useMemo(
    () => buildMemoryGraph(material, conclusions, { similar, expanded }),
    [material, conclusions, similar, expanded],
  );
  const placed = useMemo(() => placeGraph(graph), [graph]);

  /**
   * How the globe is currently turned. Dragging turns it; clicking a document
   * turns it so that document faces the viewer. Two angles are enough: yaw
   * spins it like a globe on its stand, pitch tips it towards or away.
   */
  const [rotation, setRotation] = useState({ yaw: 0, pitch: 0 });
  const spinHandle = useRef(0);
  /**
   * What currently owns the rotation: a drag, a turn-to-front, or nobody.
   * Tracked as state because the idle turn below must stop the moment either
   * gesture starts, and start again when it ends.
   */
  const [gesture, setGesture] = useState<"drag" | "spin" | null>(null);

  useEffect(() => () => cancelAnimationFrame(spinHandle.current), []);

  /** Turns the globe until the given direction faces the viewer. */
  const spinTo = (point: Point) => {
    cancelAnimationFrame(spinHandle.current);
    setGesture("spin");

    const level = Math.hypot(point.x, point.z);
    const target = {
      yaw: Math.atan2(-point.x, point.z),
      pitch: Math.atan2(-point.y, level),
    };
    const from = rotation;
    const turnYaw = shortestTurn(target.yaw - from.yaw);
    const turnPitch = target.pitch - from.pitch;
    // The clock starts on the first frame, not here: this closure is built
    // during render, where reading the clock is a side effect.
    let began = 0;
    const step = (now: number) => {
      if (began === 0) began = now;

      const t = Math.min(1, (now - began) / SPIN_MS);
      const eased = easeInOut(t);

      setRotation({
        yaw: from.yaw + turnYaw * eased,
        pitch: from.pitch + turnPitch * eased,
      });

      if (t < 1) {
        spinHandle.current = requestAnimationFrame(step);
      } else {
        setGesture(null);
      }
    };

    spinHandle.current = requestAnimationFrame(step);
  };

  /**
   * Whether motion should be kept to what the person asked for.
   *
   * The idle turn is the one motion nobody asks for, so it is the one that
   * honours the system setting.
   */
  const [stillness] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  /**
   * The globe turns slowly on its own while nobody is touching it.
   *
   * This is what says "this is a ball you can turn" without a manual: the first
   * glance shows dots coming round the horizon. It yields to every deliberate
   * act — a drag, a turn-to-front, a hover, a selection — and resumes when the
   * reader lets go.
   */
  const idling =
    gesture === null && hovered === null && selected === null && !stillness;

  useEffect(() => {
    if (!idling) return;

    let handle = 0;
    let last = 0;
    const step = (now: number) => {
      if (last !== 0) {
        const turn = (now - last) * 0.00009;

        setRotation((current) => ({ ...current, yaw: current.yaw + turn }));
      }

      last = now;
      handle = requestAnimationFrame(step);
    };

    handle = requestAnimationFrame(step);

    return () => cancelAnimationFrame(handle);
  }, [idling]);

  /** Where an entering node comes from: a chunk blooms out of its document. */
  const anchors = useMemo(() => {
    const map = new Map<string, string>();

    for (const item of material) {
      if (item.sourceFile) map.set(item.drawerId, documentId(item.sourceFile));
    }

    return map;
  }, [material]);

  /**
   * Where each dot is currently drawn, which trails the layout by up to
   * MOTION_MS: when the layout changes, every dot travels from where it stands
   * to where it now belongs instead of teleporting. Null until something has
   * moved — the first layout is drawn in place, having nothing to move from.
   *
   * An overlay of positions rather than a copy of the node list, so the nodes on
   * screen are always exactly the graph's: a dot the layout just added is drawn
   * in the same commit, at wherever the overlay last saw its anchor.
   */
  const [motion, setMotion] = useState<Map<string, Point> | null>(null);
  const drawnAt = useRef<Map<string, Point>>(new Map());

  useEffect(() => {
    const start = drawnAt.current;
    const record = (nodes: PlacedNode[]) => {
      drawnAt.current = new Map(
        nodes.map((node) => [node.id, { x: node.x, y: node.y, z: node.z }]),
      );
    };

    if (start.size === 0) {
      record(placed);
      return;
    }

    let handle = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / MOTION_MS);
      const eased = easeInOut(t);
      const moved = motionFrame(start, placed, anchors, eased);

      record(moved);
      setMotion(new Map(drawnAt.current));

      if (t < 1) handle = requestAnimationFrame(step);
    };

    handle = requestAnimationFrame(step);

    return () => cancelAnimationFrame(handle);
  }, [placed, anchors]);

  const nodesDrawn = useMemo(() => {
    if (!motion) return placed;

    return placed.map((node) => {
      // A node the overlay has never seen enters from its anchor — a chunk from
      // its document — so an expansion blooms out of the dot that was clicked.
      const at =
        motion.get(node.id) ?? motion.get(anchors.get(node.id) ?? "");

      return at ? { ...node, x: at.x, y: at.y, z: at.z } : node;
    });
  }, [placed, motion, anchors]);

  /**
   * The globe, turned and flattened: each node's place on screen, and how far
   * round the back it currently is. Depth is what makes the picture read as a
   * ball rather than as a disc of dots — the far side draws first, smaller and
   * fainter, and turning the globe moves nodes through that gradient.
   */
  const sphereR = Math.min(size.w, size.h) * 0.42;
  const projected = useMemo(() => {
    const cosYaw = Math.cos(rotation.yaw);
    const sinYaw = Math.sin(rotation.yaw);
    const cosPitch = Math.cos(rotation.pitch);
    const sinPitch = Math.sin(rotation.pitch);
    const flat = new Map<string, { x: number; y: number; depth: number }>();

    for (const node of nodesDrawn) {
      const x1 = node.x * cosYaw + node.z * sinYaw;
      const z1 = -node.x * sinYaw + node.z * cosYaw;
      const y1 = node.y * cosPitch + z1 * sinPitch;
      const depth = -node.y * sinPitch + z1 * cosPitch;

      flat.set(node.id, {
        x: size.w / 2 + x1 * sphereR,
        y: size.h / 2 + y1 * sphereR,
        depth,
      });
    }

    return flat;
  }, [nodesDrawn, rotation, size, sphereR]);

  /** Back of the globe first, so the near side always draws over the far side. */
  const drawOrder = useMemo(
    () =>
      [...nodesDrawn].sort(
        (left, right) =>
          (projected.get(left.id)?.depth ?? 0) -
          (projected.get(right.id)?.depth ?? 0),
      ),
    [nodesDrawn, projected],
  );

  /**
   * Which nodes carry a label.
   *
   * Whatever is being pointed at, the few largest conclusions, and the few largest
   * documents — three of each. Labelling everything put overlapping lines of text
   * across the middle, which is worse than labelling none; labelling nothing left a
   * hundred anonymous dots with no way in but hovering each one. Three names is
   * enough to say where you are.
   */
  const labelled = useMemo(() => {
    const names = new Set<string>();

    if (hovered) names.add(hovered);
    if (selected) names.add(selected);

    placed
      .filter((node) => node.kind === "conclusion")
      .sort((left, right) => right.degree - left.degree)
      .slice(0, 3)
      .forEach((node) => names.add(node.id));

    placed
      .filter((node) => node.kind === "document")
      .sort((left, right) => (right.weight ?? 1) - (left.weight ?? 1))
      .slice(0, 3)
      .forEach((node) => names.add(node.id));

    return names;
  }, [placed, hovered, selected]);

  /**
   * The node the card describes, and — for a document — the chunks behind it.
   *
   * Looked up rather than stored: a collapse can remove the selected chunk from
   * the graph, and a card describing a dot that is no longer drawn would be a
   * card about nothing.
   */
  const selectedNode = selected
    ? (graph.nodes.find((node) => node.id === selected) ?? null)
    : null;
  const selectedSource = selectedNode ? documentSource(selectedNode.id) : null;
  const selectedChunks =
    selectedSource !== null
      ? material.filter((item) => item.sourceFile === selectedSource)
      : [];

  if (graph.nodes.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-2 p-4 text-xs leading-relaxed text-base-content/60">
        {/*
         * Said rather than drawn: an empty canvas invites the reading that the
         * view is broken. The library has no relations yet because a relation is
         * something a person asserts by adopting a conclusion.
         */}
        <p>这个范围里还没有素材，所以没有点可以画。</p>
        <p>
          左边「素材与结论」里存一条，或者把状态条的范围切成「全部项目」。
        </p>
      </div>
    );
  }

  return (
    // The canvas takes the room, and the controls take a line: the graph is the
    // subject of this tab, so everything else is one row under it.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2">
      {/*
       * `relative`, because the selection card sits on the canvas rather than
       * under it. As a row below, appearing and disappearing, it resized the
       * canvas on every click — and the layout is computed against that size, so
       * selecting a dot moved every other dot.
       */}
      <div ref={frame} className="relative min-h-0 min-w-0 flex-1">
        <svg
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
          role="img"
          aria-label="记忆关系图"
          onWheel={onWheel}
          onPointerDown={(event) => {
            // Taking hold of the globe stops any turn still in flight.
            cancelAnimationFrame(spinHandle.current);
            setGesture(null);
            press.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              panning: false,
            };
          }}
          onPointerMove={(event) => {
            const from = press.current;

            if (!from) return;

            if (!from.panning) {
              // Still within slop: this is a click on whatever is under the
              // pointer, and capturing now would steal it.
              if (
                Math.hypot(event.clientX - from.x, event.clientY - from.y) <
                DRAG_SLOP
              ) {
                return;
              }

              from.panning = true;
              setGesture("drag");
              event.currentTarget.setPointerCapture(from.id);
            }

            // Screen pixels, not canvas units: scaled by the zoom, a zoomed-in
            // view turned the globe at a twelfth of the speed, which reads as
            // "dragging does nothing" rather than as precision.
            const dx = event.clientX - from.x;
            const dy = event.clientY - from.y;
            from.x = event.clientX;
            from.y = event.clientY;
            setRotation((current) => ({
              yaw: current.yaw + dx / sphereR,
              // Held short of the poles: past them the globe turns upside down
              // and left-right dragging reverses, which feels broken.
              pitch: Math.max(
                -1.35,
                Math.min(1.35, current.pitch + dy / sphereR),
              ),
            }));
          }}
          onPointerUp={(event) => {
            if (press.current?.panning === true) {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setGesture(null);
            }

            press.current = null;
          }}
        >
        {graph.edges.map((edge) => {
          const from = projected.get(edge.from);
          const to = projected.get(edge.to);

          if (!from || !to) return null;

          const active = hovered === edge.from || hovered === edge.to;
          // Fades round the back of the globe, like the dots it joins.
          const facing = ((from.depth + to.depth) / 2 + 1) / 2;

          return (
            <line
              key={`${edge.from}-${edge.to}-${edge.kind}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              opacity={0.25 + 0.75 * facing}
              strokeWidth={edge.kind === "holds" ? 0.8 : active ? 1.6 : 1.1}
              strokeDasharray={edge.kind === "similar" ? "3 3" : undefined}
              className={
                edge.kind === "contradicts"
                  ? "stroke-error/60"
                  : edge.kind === "verifies"
                    ? "stroke-success/45"
                    : edge.kind === "holds"
                      ? "stroke-base-content/18"
                      : edge.kind === "similar"
                        ? "stroke-info/50"
                        : active
                          ? "stroke-primary/75"
                          : "stroke-primary/35"
              }
            />
          );
        })}

        {drawOrder.map((node) => {
          const at = projected.get(node.id);

          if (!at) return null;

          // Nearer is bigger and brighter: the ball reads as a ball because the
          // far side recedes instead of merely sitting underneath.
          const facing = (at.depth + 1) / 2;
          const depthScale = 0.55 + 0.45 * facing;
          // Material is a small dot and a conclusion is a large one, because that
          // is the relation between them: several of the first make one of the
          // second.
          const radius =
            (node.kind === "conclusion"
              ? 10 + Math.min(node.degree, 8)
              : node.kind === "document"
                ? // By what it holds: a fourteen-chunk file should look bigger than
                  // a one-line note, and that is the only thing making the document
                  // layer readable as a map of the project.
                  4 + Math.min(9, Math.sqrt(node.weight ?? 1) * 2)
                : node.kind === "verification"
                  ? 4
                  : 3.5 + Math.min(node.degree, 4) * 0.6) * depthScale;
          const adopted =
            node.status === "promoted" || node.status === "canonical";

          return (
            <g
              key={node.id}
              className="cursor-pointer"
              opacity={0.35 + 0.65 * facing}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                setSelected(node.id);

                const source = documentSource(node.id);

                if (source !== null) {
                  // The globe brings the clicked document round to face the
                  // viewer, then its chunks come out around it: the dot you
                  // clicked is the one dot guaranteed to end up in front of you.
                  spinTo(node);
                  setExpanded((current) => {
                    const next = new Set(current);

                    if (!next.delete(source)) next.add(source);

                    return next;
                  });
                  return;
                }

                onSelect(node.id);
              }}
            >
              {/*
               * One shape per kind, not just one colour: colour alone was five
               * translucent fills that all read as grey, with success standing
               * for two different things. A conclusion is a solid disc, a
               * document is a ring — a container, openable — a chunk is a small
               * solid dot, and an adoption record is a hollow diamond.
               */}
              {node.kind === "verification" ? (
                <path
                  d={diamondPath(at.x, at.y, radius + 2)}
                  strokeWidth={1.6}
                  className="fill-base-100 stroke-success"
                />
              ) : (
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={radius}
                  strokeWidth={node.kind === "document" ? 2.2 : undefined}
                  className={
                    node.kind === "conclusion"
                      ? adopted
                        ? "fill-success/90"
                        : "fill-warning/90"
                      : node.kind === "document"
                        ? "fill-base-100 stroke-primary"
                        : "fill-base-content/50"
                  }
                />
              )}
              {/* Labelled where it will be read: conclusions always, material on
                  hover, because a thousand labels is not a picture. */}
              {labelled.has(node.id) ? (
                <text
                  x={at.x}
                  y={
                    node.kind === "document"
                      ? at.y - radius - 5
                      : at.y + radius + 11
                  }
                  textAnchor="middle"
                  // Scaled against the zoom so a label stays readable at any
                  // magnification instead of growing into a banner.
                  fontSize={(11 * box.w) / size.w}
                  // Painted over its own outline, the way a label on a map is: the
                  // few labels here sit where the picture is densest, and without it
                  // any overlap turns both of them into mush.
                  stroke="var(--color-base-100)"
                  strokeWidth={(3 * box.w) / size.w}
                  style={{ paintOrder: "stroke" }}
                  className="fill-base-content/70"
                >
                  {/* A document's label is already a shortened file name. */}
                  {node.kind !== "document" && node.label.length > 30
                    ? `${node.label.slice(0, 30)}…`
                    : node.label}
                </text>
              ) : null}
            </g>
          );
        })}
        </svg>

        {selectedNode ? (
          <div className="absolute right-2 top-2 flex w-60 max-w-[75%] flex-col gap-1.5 rounded-md border border-base-content/15 bg-base-100/95 p-2 text-[11px] shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium leading-snug text-base-content/80">
                {selectedNode.label}
              </span>
              <button
                type="button"
                aria-label="关闭"
                className="shrink-0 rounded px-1 text-base-content/45 hover:text-base-content/80"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>

            {selectedSource !== null ? (
              <>
                <span className="text-base-content/50">
                  {selectedChunks.length} 个分块 ·{" "}
                  {expanded.has(selectedSource)
                    ? "再点它可以收起"
                    : "再点它可以展开"}
                </span>
                {/*
                 * The document's content without expanding it: one line per
                 * chunk, full text one click away. Before this card, a document
                 * dot could only be opened into more dots — there was no way to
                 * find out what any of it said.
                 */}
                <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                  {selectedChunks.map((chunk) => (
                    <li key={chunk.drawerId}>
                      <button
                        type="button"
                        className="w-full truncate rounded px-1 py-0.5 text-left text-base-content/70 hover:bg-base-content/10"
                        onClick={() => onSelect(chunk.drawerId)}
                      >
                        {chunkLine(chunk)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div>
                <TextControlButton
                  onClick={() => {
                    void onFindSimilar(selectedNode.id).then((neighbours) => {
                      setSimilar((current) => ({
                        ...current,
                        [selectedNode.id]: neighbours,
                      }));
                    });
                  }}
                >
                  找相似
                </TextControlButton>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TextControlButton onClick={() => zoom(1 / 1.4)}>放大</TextControlButton>
        <TextControlButton onClick={() => zoom(1.4)}>缩小</TextControlButton>
        <TextControlButton
          onClick={() => {
            cancelAnimationFrame(spinHandle.current);
            setGesture(null);
            setView(null);
            setRotation({ yaw: 0, pitch: 0 });
          }}
        >
          复位
        </TextControlButton>
        <span className="text-[11px] text-base-content/45">
          拖拽转动球体 · 滚轮缩放 · 点文档转到正面并展开 · 点分块或结论看全文
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-base-content/55">
        <Legend swatch="h-2.5 w-2.5 rounded-full bg-success/90" label="已采纳的结论" />
        <Legend swatch="h-2.5 w-2.5 rounded-full bg-warning/90" label="候选结论" />
        <Legend
          swatch="h-2.5 w-2.5 rounded-full border-2 border-primary"
          label="文档（大小=分块数）"
        />
        <Legend swatch="h-2 w-2 rounded-full bg-base-content/50" label="展开后的分块" />
        <Legend swatch="h-2 w-2 rotate-45 border border-success bg-base-100" label="采纳记录" />
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-px w-4 bg-primary/60" />
          实线 = 有人断言
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-px w-4 border-t border-dashed border-info/60"
          />
          虚线 = 检索认为相近
        </span>
        <span>
          {graph.nodes.length} 个节点 · {graph.edges.length} 条边 ·{" "}
          {material.length} 条素材聚合在
          {graph.nodes.filter((node) => node.kind === "document").length} 份文档里
          {graph.missing > 0
            ? ` · ${graph.missing} 条被引用的素材不在当前这一页`
            : ""}
        </span>
      </div>
    </div>
  );
}

/** A legend swatch is the node's actual shape, not a colour chip beside a word. */
function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`inline-block ${swatch}`} />
      {label}
    </span>
  );
}

/** A diamond centred on a point: the adoption record's shape. */
function diamondPath(x: number, y: number, r: number): string {
  return `M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`;
}

/** One line of a chunk: enough to recognise it, the dialog holds the rest. */
function chunkLine(item: StoredItem): string {
  return (item.statement ?? item.excerpt).replace(/\s+/g, " ").trim();
}
