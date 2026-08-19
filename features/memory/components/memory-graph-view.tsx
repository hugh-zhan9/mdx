"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TextControlButton } from "@/common/components/ui-controls";
import type { StoredItem } from "../lib/types";
import { buildMemoryGraph, documentSource, placeGraph } from "../lib/memory-graph";

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
  const placed = useMemo(
    () => placeGraph(graph, size.w, size.h),
    [graph, size],
  );
  const positions = useMemo(
    () => new Map(placed.map((node) => [node.id, node])),
    [placed],
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
      <div ref={frame} className="min-h-0 min-w-0 flex-1">
        <svg
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
          role="img"
          aria-label="记忆关系图"
          onWheel={onWheel}
          onPointerDown={(event) => {
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
              event.currentTarget.setPointerCapture(from.id);
            }

            const rect = event.currentTarget.getBoundingClientRect();
            const dx = ((event.clientX - from.x) / rect.width) * box.w;
            const dy = ((event.clientY - from.y) / rect.height) * box.h;
            from.x = event.clientX;
            from.y = event.clientY;
            setView((current) => {
              const at = current ?? { x: 0, y: 0, w: size.w, h: size.h };

              return { ...at, x: at.x - dx, y: at.y - dy };
            });
          }}
          onPointerUp={(event) => {
            if (press.current?.panning === true) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }

            press.current = null;
          }}
        >
        {graph.edges.map((edge) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);

          if (!from || !to) return null;

          const active = hovered === edge.from || hovered === edge.to;

          return (
            <line
              key={`${edge.from}-${edge.to}-${edge.kind}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
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

        {placed.map((node) => {
          // Material is a small dot and a conclusion is a large one, because that
          // is the relation between them: several of the first make one of the
          // second.
          const radius =
            node.kind === "conclusion"
              ? 10 + Math.min(node.degree, 8)
              : node.kind === "document"
                ? // By what it holds: a fourteen-chunk file should look bigger than
                  // a one-line note, and that is the only thing making the document
                  // layer readable as a map of the project.
                  4 + Math.min(9, Math.sqrt(node.weight ?? 1) * 2)
                : node.kind === "verification"
                  ? 4
                  : 3.5 + Math.min(node.degree, 4) * 0.6;
          const adopted =
            node.status === "promoted" || node.status === "canonical";

          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                setSelected(node.id);

                const source = documentSource(node.id);

                if (source !== null) {
                  // No entry sits behind a document node, so opening one would be
                  // opening nothing. Its click is the drill-down instead.
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
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                className={
                  node.kind === "conclusion"
                    ? adopted
                      ? "fill-success/80"
                      : "fill-warning/80"
                    : node.kind === "document"
                      ? "fill-primary/45"
                      : node.kind === "verification"
                        ? "fill-success/35"
                        : "fill-base-content/35"
                }
              />
              {/* Labelled where it will be read: conclusions always, material on
                  hover, because a thousand labels is not a picture. */}
              {labelled.has(node.id) ? (
                <text
                  x={node.x}
                  y={
                    node.kind === "document"
                      ? node.y - radius - 5
                      : node.y + radius + 11
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
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TextControlButton onClick={() => zoom(1 / 1.4)}>放大</TextControlButton>
        <TextControlButton onClick={() => zoom(1.4)}>缩小</TextControlButton>
        <TextControlButton onClick={() => setView(null)}>复位</TextControlButton>
        <span className="text-[11px] text-base-content/45">
          滚轮缩放 · 拖拽平移 · 点文档展开成分块 · 点分块或结论看全文
        </span>
      </div>

      {selected ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
          <span className="min-w-0 truncate text-base-content/60">
            已选：
            {graph.nodes.find((node) => node.id === selected)?.label ?? selected}
          </span>
          {documentSource(selected) === null ? (
            <TextControlButton
              onClick={() => {
                void onFindSimilar(selected).then((neighbours) => {
                  setSimilar((current) => ({
                    ...current,
                    [selected]: neighbours,
                  }));
                });
              }}
            >
              找相似
            </TextControlButton>
          ) : (
            <span className="text-base-content/45">
              {expanded.has(documentSource(selected) ?? "")
                ? "已展开，再点一次收起"
                : "点它展开成分块"}
            </span>
          )}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-base-content/55">
        <Legend className="bg-success/80" label="已采纳的结论" />
        <Legend className="bg-warning/80" label="候选结论" />
        <Legend className="bg-primary/45" label="文档（大小=分块数）" />
        <Legend className="bg-base-content/35" label="展开后的分块" />
        <Legend className="bg-success/35" label="采纳记录" />
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

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${className}`}
      />
      {label}
    </span>
  );
}
