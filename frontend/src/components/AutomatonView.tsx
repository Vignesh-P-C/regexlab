import { useEffect, useRef } from "react";
import type { ASTNode, Automaton, Stage } from "../types/engine";
import { postOrderAstNodes } from "../lib/steps";
import { formatTransitionSymbols } from "../../../engine/character-set.js";
import {
  estimateTransitionLabelWidth,
  placeTransitionLabels,
  type LabelRoute,
} from "../lib/transition-label-layout";
import { layoutNfaFragments } from "../lib/nfa-fragment-layout";

type Props = {
  stage: Stage;
  ast: ASTNode | null;
  automaton: Automaton | null; // the nfa/dfa/minDfa matching `stage`
  activeStates: number[]; // #52: the current playback step's active state(s); [] on the AST tab
  traversedEdges: { from: number; to: number; label: string }[]; // #52: edges taken to reach this step; [] on the AST tab
  astNodeIndex: number | null; // #52: the AST tab's current postOrderAstNodes index; null on the other tabs
};

/** #52: scroll `container` (never the page) just enough to bring `target`
 *  into view. Deliberately not `target.scrollIntoView()`, which can walk
 *  up and scroll ancestors beyond the one scrollable box we own. */
function scrollIntoViewWithinContainer(container: HTMLElement, target: Element) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const pad = 20;
  if (targetRect.left < containerRect.left + pad) {
    container.scrollLeft -= containerRect.left + pad - targetRect.left;
  } else if (targetRect.right > containerRect.right - pad) {
    container.scrollLeft += targetRect.right - (containerRect.right - pad);
  }
  if (targetRect.top < containerRect.top + pad) {
    container.scrollTop -= containerRect.top + pad - targetRect.top;
  } else if (targetRect.bottom > containerRect.bottom - pad) {
    container.scrollTop += targetRect.bottom - (containerRect.bottom - pad);
  }
}

const NODE_R = 20;

type Point = { x: number; y: number };
/** The engine calls the empty transition "eps"; draw it as the textbook symbol. */


type GraphEdge = { from: number; to: number; symbols: string[] };

/**
 * One edge per ordered (from, to) pair. Transitions on different symbols
 * between the same two states share one arrow and one merged label ("a,b"),
 * instead of being drawn on top of each other (D8).
 */
function groupEdges(transitions: Automaton["transitions"]): GraphEdge[] {
  const byPair = new Map<string, GraphEdge>();
  for (const [fromStr, bySymbol] of Object.entries(transitions)) {
    const from = Number(fromStr);
    for (const [symbol, targets] of Object.entries(bySymbol)) {
      for (const to of targets) {
        const key = `${from}>${to}`;
        const edge = byPair.get(key);
        if (!edge) byPair.set(key, { from, to, symbols: [symbol] });
        else if (!edge.symbols.includes(symbol)) edge.symbols.push(symbol);
      }
    }
  }
  return [...byPair.values()];
}

// Two-way pairs (A->B and B->A) bow apart so they no longer share one line.
// The control point sits PAIR_CURVE off the chord; the curve itself bulges by
// half of that.
const PAIR_CURVE = 36;

/**
 * Quadratic-curve geometry for an edge between two state centers. `curve` is
 * the control-point offset from the chord (0 = straight line). The sign picks
 * the side; because the normal flips with direction, giving A->B and B->A the
 * same positive curve bows them to opposite sides.
 */
function edgeGeometry(a: Point, b: Point, curve: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  const ctrl = { x: (a.x + b.x) / 2 + nx * curve, y: (a.y + b.y) / 2 + ny * curve };

  // Start/end on each circle's rim, aimed at the control point so the arrow
  // leaves and enters along the curve.
  const rim = (from: Point) => {
    const d = Math.hypot(ctrl.x - from.x, ctrl.y - from.y) || 1;
    return { x: from.x + ((ctrl.x - from.x) / d) * NODE_R, y: from.y + ((ctrl.y - from.y) / d) * NODE_R };
  };
  const start = rim(a);
  const end = rim(b);

  return { start, end, ctrl };
}

// #25: layered left-to-right layout. A state's column is its BFS distance
// from the start state, so the automaton reads like a flow instead of a hairball.
const LAYER_GAP = 130; // horizontal distance between columns
const ROW_GAP = 100; // vertical distance between states in one column
const MARGIN_X = 70; // room on the left for the start arrow
const MARGIN_Y = 70; // room above the top row for self-loops
const MIN_GRAPH_SCALE = 0.92; // below this the graph scrolls instead of shrinking (keeps 12px edge labels >= 11px)
const BOW_STEPS = [70, 110, 150, 190, 230, 270]; // control-point offsets tried, smallest first
const CLEARANCE = NODE_R + 10; // an edge must stay this far from any other state

type Layout = { positions: Point[]; layer: number[]; width: number; height: number };

/**
 * Back edges and layer-skipping edges would run straight through the states
 * between their ends, so give them a bow. Try the smallest bow first, on the
 * preferred side, then the other side, then a bigger bow, and keep the first
 * one that clears every other state. `signs` lists the curve signs allowed.
 */
/** Does bowing the chord a->b by this `curve` keep the resulting arc clear of
 *  every state other than the edge's own two ends? Shared by `clearCurve`
 *  (generic "whichever side is clear" choice, DFA/min-DFA) and
 *  `clearCurveForSide` (NFA's textbook-direction choice, below). */
function curveClears(a: Point, b: Point, ends: number[], positions: Point[], curve: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  const cx = (a.x + b.x) / 2 + nx * curve;
  const cy = (a.y + b.y) / 2 + ny * curve;
  for (let t = 0.1; t <= 0.9; t += 0.05) {
    const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x;
    const py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y;
    for (let id = 0; id < positions.length; id++) {
      if (!ends.includes(id) && Math.hypot(px - positions[id].x, py - positions[id].y) < CLEARANCE) return false;
    }
  }
  return true;
}

function clearCurve(a: Point, b: Point, ends: number[], positions: Point[], signs: number[]): number {
  for (const bow of BOW_STEPS) {
    for (const sign of signs) {
      const curve = sign * bow;
      if (curveClears(a, b, ends, positions, curve)) return curve;
    }
  }
  return signs[0] * BOW_STEPS[BOW_STEPS.length - 1];
}

/**
 * NFA view only (#61 follow-up): a hand-drawn Thompson epsilon-NFA always
 * bows a loop-back edge above the centerline and a bypass/skip edge below
 * it -- a fixed convention, not "whichever side the layout happens to have
 * room on" (that generic rule is `clearCurve`, still used for DFA/min-DFA,
 * where no such convention applies). `curve`'s control point is
 * `mid + (nx, ny) * curve` with `ny = dx / dist`, so the sign of `curve`
 * that moves the control point to smaller y (up) is always `-sign(dx)` --
 * this only depends on which way the edge runs left-to-right, not on its
 * particular geometry, so it can be computed directly instead of searched for.
 */
function clearCurveForSide(
  a: Point,
  b: Point,
  ends: number[],
  positions: Point[],
  wantAbove: boolean,
): number {
  const dx = b.x - a.x;
  const upSign = dx === 0 ? -1 : -Math.sign(dx);
  const preferred = wantAbove ? upSign : -upSign;
  for (const bow of BOW_STEPS) {
    if (curveClears(a, b, ends, positions, preferred * bow)) return preferred * bow;
  }
  // The textbook side is blocked at every bow radius tried -- bow the other
  // way rather than draw the arc through a state.
  for (const bow of BOW_STEPS) {
    if (curveClears(a, b, ends, positions, -preferred * bow)) return -preferred * bow;
  }
  return preferred * BOW_STEPS[BOW_STEPS.length - 1];
}

/**
 * `precomputedLayer` (NFA view): layer[i] already assigned by
 * layoutNfaFragments, from the AST's own recursive structure -- see that
 * file for why BFS distance isn't the same thing. Omitted (DFA/min-DFA):
 * plain BFS from the start state, unchanged from before this file's #61
 * follow-up.
 */
function layeredLayout(
  stateCount: number,
  startState: number,
  edges: GraphEdge[],
  precomputedLayer?: number[],
): Layout {
  let layer: number[];
  if (precomputedLayer) {
    layer = precomputedLayer;
  } else {
    const next = new Map<number, number[]>();
    for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);

    // Breadth-first search from the start state: layer[s] = fewest edges from start to s.
    layer = new Array<number>(stateCount).fill(-1);
    layer[startState] = 0;
    const queue = [startState];
    for (let head = 0; head < queue.length; head++) {
      const s = queue[head];
      for (const t of next.get(s) ?? []) {
        if (layer[t] === -1) {
          layer[t] = layer[s] + 1;
          queue.push(t);
        }
      }
    }
  }
  // Defensive: a state with no path from the start gets its own last column.
  const lastReached = Math.max(0, ...layer);
  for (let i = 0; i < stateCount; i++) if (layer[i] === undefined || layer[i] === -1) layer[i] = lastReached + 1;

  const columns = Math.max(0, ...layer) + 1;
  const rows: number[][] = Array.from({ length: columns }, () => []);
  for (let i = 0; i < stateCount; i++) rows[layer[i]].push(i);

  const tallest = Math.max(1, ...rows.map((r) => r.length));
  // Sized from content alone (margins already include self-loop/arrow
  // clearance) -- no floor, so small automatons aren't padded into an
  // oversized canvas they then have to be shrunk back out of.
  const layerGap = Math.max(
    LAYER_GAP,
    ...edges.map((edge) => estimateTransitionLabelWidth(formatTransitionSymbols(edge.symbols)) + 2 * NODE_R + 24),
  );
  const width = 2 * MARGIN_X + (columns - 1) * layerGap;
  const height = 2 * MARGIN_Y + (tallest - 1) * ROW_GAP;

  const positions: Point[] = new Array(stateCount);
  for (const row of rows) {
    row.forEach((id, i) => {
      positions[id] = {
        x: MARGIN_X + layer[id] * layerGap,
        y: height / 2 + (i - (row.length - 1) / 2) * ROW_GAP,
      };
    });
  }
  return { positions, layer, width, height };
}

/** States in BFS layers, left to right; transitions as labeled arrows, self-loops as small arcs. */
function AutomatonGraph({
  automaton,
  activeStates,
  traversedEdges,
  stage,
  ast,
}: {
  automaton: Automaton;
  activeStates: number[];
  traversedEdges: { from: number; to: number; label: string }[];
  stage: Stage;
  ast: ASTNode | null;
}) {
  const isNfaView = stage === "nfa";
  const { stateCount, startState, acceptStates, transitions } = automaton;
  const edges = groupEdges(transitions);
  const edgeKeys = new Set(edges.map((e) => `${e.from}>${e.to}`));
  // The structural (construction-order) layout only applies -- and only
  // CAN apply -- to the NFA stage: it's built by re-walking the same AST
  // Thompson's construction consumed, so a DFA/min-DFA (whose states don't
  // correspond to AST positions at all) always falls through to BFS below.
  const structuralLayer = isNfaView && ast ? layoutNfaFragments(ast) : null;
  const precomputedLayer =
    structuralLayer && structuralLayer.stateCount === stateCount ? structuralLayer.layer : undefined;
  const { positions, layer, width, height } = layeredLayout(stateCount, startState, edges, precomputedLayer);
  const activeSet = new Set(activeStates);
  // #52: traversedEdges is per-symbol; group it the same way groupEdges
  // groups drawn edges, so a merged multi-symbol edge highlights whenever
  // ANY of its symbols was the one actually taken.
  const traversedKeys = new Set(traversedEdges.map((e) => `${e.from}>${e.to}`));

  // Calculate every path first, then place labels against all paths and nodes.
  // The same route objects drive drawing and text placement so playback
  // highlighting remains attached to the edge the label describes.
  const labelRoutes: LabelRoute[] = edges.map((e) => {
    const key = `${e.from}>${e.to}`;
    const label = formatTransitionSymbols(e.symbols);
    const a = positions[e.from];
    const b = positions[e.to];
    if (e.from === e.to) {
      const neighbours = edges
        .filter((other) => other.from !== other.to && (other.from === e.from || other.to === e.from))
        .map((other) => positions[other.from === e.from ? other.to : other.from]);
      const above = neighbours.some((point) => point.y - a.y < -Math.abs(point.x - a.x) * 0.6);
      const below = neighbours.some((point) => point.y - a.y > Math.abs(point.x - a.x) * 0.6);
      const direction = above && !below ? 1 : -1;
      return {
        key,
        label,
        start: { x: a.x - 8, y: a.y + direction * NODE_R },
        control: { x: a.x, y: a.y + direction * (NODE_R + 24) },
        end: { x: a.x + 8, y: a.y + direction * NODE_R },
        preferredSide: direction,
      };
    }

    const twoWay = edgeKeys.has(`${e.to}>${e.from}`);
    const span = layer[e.to] - layer[e.from];
    const skips = span <= 0 || span > 1;
    let curve: number;
    if (isNfaView) {
      // Classify by span alone, even for a reciprocal pair: a char edge
      // sitting right next to its own loop-back (e.g. a*'s 0->1 beside
      // 1->0) is still a plain span-1 forward edge and stays straight --
      // "twoWay" existing at all isn't reason enough to bow it, only
      // actually looping back or skipping layers is. Loop-back (span <= 0)
      // bows above the centerline, bypass/skip (span > 1) bows below.
      curve = span === 1 ? 0 : clearCurveForSide(a, b, [e.from, e.to], positions, span <= 0);
    } else if (!skips) {
      curve = twoWay ? PAIR_CURVE : 0;
    } else if (twoWay) {
      curve = clearCurve(a, b, [e.from, e.to], positions, [1]);
    } else {
      const wantDown = span < 0;
      const prefer = (b.x - a.x >= 0 ? 1 : -1) * (wantDown ? 1 : -1);
      curve = clearCurve(a, b, [e.from, e.to], positions, [prefer, -prefer]);
    }
    const geometry = edgeGeometry(a, b, curve);
    return {
      key,
      label,
      start: geometry.start,
      control: geometry.ctrl,
      end: geometry.end,
      preferredSide: curve === 0 ? 1 : Math.sign(curve),
    };
  });
  const placedLabels = placeTransitionLabels(labelRoutes, positions);
  const routeByKey = new Map(labelRoutes.map((route) => [route.key, route]));
  const geometryPoints: Point[] = [
    ...positions,
    ...labelRoutes.flatMap((route) => [route.start, route.control, route.end]),
    ...Array.from(placedLabels.values()).flatMap(({ bounds }) => [
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
    ]),
  ];
  const viewMinX = Math.min(0, ...geometryPoints.map((point) => point.x)) - 12;
  const viewMinY = Math.min(0, ...geometryPoints.map((point) => point.y)) - 12;
  const viewMaxX = Math.max(width, ...geometryPoints.map((point) => point.x)) + 12;
  const viewMaxY = Math.max(height, ...geometryPoints.map((point) => point.y)) + 12;
  const graphWidth = viewMaxX - viewMinX;
  const graphHeight = viewMaxY - viewMinY;
  const viewBox = [viewMinX, viewMinY, graphWidth, graphHeight].join(" ");

  return (
    <svg
      viewBox={viewBox}
      className="automaton-svg"
      style={{ minWidth: graphWidth * MIN_GRAPH_SCALE, maxWidth: graphWidth }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>

      {edges.map((e) => {
        const key = `${e.from}>${e.to}`;
        const route = routeByKey.get(key)!;
        const label = formatTransitionSymbols(e.symbols);
        const placed = placedLabels.get(key)!;
        return (
          <g key={key}>
            <path
              d={"M " + route.start.x + " " + route.start.y + " Q " + route.control.x + " " + route.control.y + " " + route.end.x + " " + route.end.y}
              fill="none"
              stroke="currentColor"
              markerEnd="url(#arrow)"
              className={traversedKeys.has(key) ? "traversed" : undefined}
            />
            <text x={placed.x} y={placed.y} textAnchor="middle" fontSize="12" className="edge-label">
              {label}
            </text>
          </g>
        );
      })}

      {positions.map((p, id) => (
        <g key={id}>
          {id === startState && (
            <line x1={p.x - NODE_R - 24} y1={p.y} x2={p.x - NODE_R} y2={p.y} stroke="currentColor" markerEnd="url(#arrow)" />
          )}
          <circle
            cx={p.x}
            cy={p.y}
            r={NODE_R}
            data-state-id={id}
            className={`state${acceptStates.includes(id) ? " accept" : ""}${activeSet.has(id) ? " active" : ""}`}
          />
          {acceptStates.includes(id) && <circle cx={p.x} cy={p.y} r={NODE_R - 6} className="accept-ring" />}
          <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13">
            {id}
          </text>
        </g>
      ))}
    </svg>
  );
}

// Large trees stop shrinking to fit at this fraction of natural size and
// scroll inside the view instead, so nodes stay legible (>= 11px at the 13px base).
const MIN_AST_SCALE = 0.85;

type Positioned = { node: ASTNode; x: number; y: number; children: Positioned[] };

/** Depth = y, in-order leaf position = x — a plain recursive tree layout. */
function AstTree({ node, highlightNodeIndex }: { node: ASTNode; highlightNodeIndex: number | null }) {
  let nextLeafX = 0;
  let maxDepth = 0;
  const LEVEL_HEIGHT = 70;
  const LEAF_SPACING = 60;

  function layout(n: ASTNode, depth: number): Positioned {
    maxDepth = Math.max(maxDepth, depth);
    const y = 40 + depth * LEVEL_HEIGHT;
    if (n.kind === "char" || n.kind === "charset") {
      const x = 40 + nextLeafX * LEAF_SPACING;
      nextLeafX += 1;
      return { node: n, x, y, children: [] };
    }
    if (n.kind === "star" || n.kind === "plus" || n.kind === "optional") {
      const child = layout(n.child, depth + 1);
      return { node: n, x: child.x, y, children: [child] };
    }
    const left = layout(n.left, depth + 1);
    const right = layout(n.right, depth + 1);
    return { node: n, x: (left.x + right.x) / 2, y, children: [left, right] };
  }

  const root = layout(node, 0);
  // Sized from content alone, no floor (D7 already made height follow tree
  // depth instead of a fixed box; this removes the matching width floor so
  // small trees aren't padded into a canvas they then have to shrink out of).
  const width = nextLeafX * LEAF_SPACING + 80;
  const height = 80 + maxDepth * LEVEL_HEIGHT;

  const nodes: Positioned[] = [];
  const edges: { from: Positioned; to: Positioned }[] = [];
  (function collect(p: Positioned) {
    nodes.push(p);
    for (const c of p.children) {
      edges.push({ from: p, to: c });
      collect(c);
    }
  })(root);

  const label = (n: ASTNode) => {
    if (n.kind === "char") return "'" + n.value + "'";
    if (n.kind === "charset") return n.label;
    if (n.kind === "concat") return "\\u00b7";
    if (n.kind === "alt") return "|";
    return n.kind === "star" ? "*" : n.kind === "plus" ? "+" : "?";
  };

  // #52: highlightNodeIndex is a postOrderAstNodes index (the same order
  // computeAstSteps walks) -- not this component's own `nodes` array
  // order (collect() above visits parent-before-children). Resolve it to
  // the actual ASTNode object, then match by reference.
  const highlightedNode =
    highlightNodeIndex === null ? null : postOrderAstNodes(node)[highlightNodeIndex]?.node ?? null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ast-svg" style={{ minWidth: width * MIN_AST_SCALE, maxWidth: width }}>
      {edges.map((e, i) => (
        <line key={i} x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y} stroke="currentColor" />
      ))}
      {nodes.map((p, i) => (
        <g key={i}>
          <circle
            cx={p.x}
            cy={p.y}
            r={NODE_R}
            data-node-index={highlightNodeIndex !== null && p.node === highlightedNode ? highlightNodeIndex : undefined}
            className={`ast-node${p.node === highlightedNode ? " active" : ""}`}
          />
          <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13">
            {label(p.node)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function AutomatonView({ stage, ast, automaton, activeStates, traversedEdges, astNodeIndex }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // #52: keep the current step's highlight visible by scrolling only this
  // box (scrollIntoViewWithinContainer never touches window/page scroll).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selector = stage === "ast" ? `[data-node-index="${astNodeIndex}"]` : `[data-state-id="${activeStates[0]}"]`;
    if (stage === "ast" ? astNodeIndex === null : activeStates.length === 0) return;
    const target = container.querySelector(selector);
    if (target) scrollIntoViewWithinContainer(container, target);
  }, [stage, activeStates, astNodeIndex]);

  if (stage === "ast") {
    if (!ast) return <div className="automaton-view empty">No pattern parsed yet.</div>;
    return (
      <div className="automaton-view" ref={containerRef}>
        <AstTree node={ast} highlightNodeIndex={astNodeIndex} />
      </div>
    );
  }
  if (!automaton) return <div className="automaton-view empty">No pattern parsed yet.</div>;
  return (
    <div className="automaton-view" ref={containerRef}>
      <AutomatonGraph automaton={automaton} activeStates={activeStates} traversedEdges={traversedEdges} stage={stage} ast={ast} />
    </div>
  );
}
