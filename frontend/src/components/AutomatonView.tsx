import type { ASTNode, Automaton, Stage } from "../types/engine";

type Props = {
  stage: Stage;
  ast: ASTNode | null;
  automaton: Automaton | null; // the nfa/dfa/minDfa matching `stage`
  activeStates: number[]; // from MatchTrace.steps[activeStep], applies only to minDfa
};

const NODE_R = 20;

type Point = { x: number; y: number };
/** The engine calls the empty transition "eps"; draw it as the textbook symbol. */
const symbolLabel = (symbol: string) => (symbol === "eps" ? "ε" : symbol);

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
const LABEL_GAP = 11;

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

  // Curve midpoint (t = 0.5), then nudge the label to the bulging side.
  const mid = { x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y };
  const side = curve === 0 ? 1 : Math.sign(curve);
  const label = { x: mid.x + nx * side * LABEL_GAP, y: mid.y + ny * side * LABEL_GAP + 4 };
  return { start, end, ctrl, label };
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
function clearCurve(a: Point, b: Point, ends: number[], positions: Point[], signs: number[]): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  for (const bow of BOW_STEPS) {
    for (const sign of signs) {
      const curve = sign * bow;
      const cx = (a.x + b.x) / 2 + nx * curve;
      const cy = (a.y + b.y) / 2 + ny * curve;
      let clear = true;
      for (let t = 0.1; t <= 0.9 && clear; t += 0.05) {
        const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x;
        const py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y;
        positions.forEach((q, id) => {
          if (!ends.includes(id) && Math.hypot(px - q.x, py - q.y) < CLEARANCE) clear = false;
        });
      }
      if (clear) return curve;
    }
  }
  return signs[0] * BOW_STEPS[BOW_STEPS.length - 1];
}

function layeredLayout(stateCount: number, startState: number, edges: GraphEdge[]): Layout {
  const next = new Map<number, number[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);

  // Breadth-first search from the start state: layer[s] = fewest edges from start to s.
  const layer = new Array<number>(stateCount).fill(-1);
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
  // Defensive: a state with no path from the start gets its own last column.
  const lastReached = Math.max(0, ...layer);
  for (let i = 0; i < stateCount; i++) if (layer[i] === -1) layer[i] = lastReached + 1;

  const columns = Math.max(0, ...layer) + 1;
  const rows: number[][] = Array.from({ length: columns }, () => []);
  for (let i = 0; i < stateCount; i++) rows[layer[i]].push(i);

  const tallest = Math.max(1, ...rows.map((r) => r.length));
  // Sized from content alone (margins already include self-loop/arrow
  // clearance) -- no floor, so small automatons aren't padded into an
  // oversized canvas they then have to be shrunk back out of.
  const width = 2 * MARGIN_X + (columns - 1) * LAYER_GAP;
  const height = 2 * MARGIN_Y + (tallest - 1) * ROW_GAP;

  const positions: Point[] = new Array(stateCount);
  for (const row of rows) {
    row.forEach((id, i) => {
      positions[id] = {
        x: MARGIN_X + layer[id] * LAYER_GAP,
        y: height / 2 + (i - (row.length - 1) / 2) * ROW_GAP,
      };
    });
  }
  return { positions, layer, width, height };
}

/** States in BFS layers, left to right; transitions as labeled arrows, self-loops as small arcs. */function AutomatonGraph({ automaton, activeStates }: { automaton: Automaton; activeStates: number[] }) {
    const { stateCount, startState, acceptStates, transitions } = automaton;
  const edges = groupEdges(transitions);
  const edgeKeys = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const { positions, layer, width, height } = layeredLayout(stateCount, startState, edges);
  const activeSet = new Set(activeStates);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="automaton-svg"
      style={{ minWidth: width * MIN_GRAPH_SCALE, maxWidth: width }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>

      {edges.map((e) => {
        const a = positions[e.from];
        const b = positions[e.to];
        const label = e.symbols.map(symbolLabel).join(",");
        const key = `${e.from}>${e.to}`;
        if (e.from === e.to) {
          // The loop sits above its state, unless an edge already leaves or enters
          // from above; then it goes underneath so it can't run along that edge.
          const neighbours = edges
            .filter((o) => o.from !== o.to && (o.from === e.from || o.to === e.from))
            .map((o) => positions[o.from === e.from ? o.to : o.from]);
          const above = neighbours.some((q) => q.y - a.y < -Math.abs(q.x - a.x) * 0.6);
          const below = neighbours.some((q) => q.y - a.y > Math.abs(q.x - a.x) * 0.6);
          const dir = above && !below ? 1 : -1; // 1 = underneath, -1 = above
          const loopY = a.y + dir * (NODE_R + 24);
          return (
            <g key={key}>
              <path
                d={`M ${a.x - 8} ${a.y + dir * NODE_R} Q ${a.x} ${loopY} ${a.x + 8} ${a.y + dir * NODE_R}`}
                fill="none"
                stroke="currentColor"
                markerEnd="url(#arrow)"
              />
              <text x={a.x} y={dir === 1 ? loopY + 14 : loopY - 4} textAnchor="middle" fontSize="12" className="edge-label">
                {label}
              </text>
            </g>
          );
        }
        const twoWay = edgeKeys.has(`${e.to}>${e.from}`);
        // Column distance: negative = back edge, > 1 = skips a column. Both would
        // otherwise run straight through the states in between, so they bow out.
        const span = layer[e.to] - layer[e.from];
        const skips = span < 0 || span > 1;
        // Back edges bow down, forward skips bow up (a positive curve bows down
        // for a rightward edge and up for a leftward one).
        const wantDown = span < 0;
        const prefer = (b.x - a.x >= 0 ? 1 : -1) * (wantDown ? 1 : -1);
        const curve = !skips
          ? twoWay ? PAIR_CURVE : 0
          : twoWay
            ? clearCurve(a, b, [e.from, e.to], positions, [1])
            : clearCurve(a, b, [e.from, e.to], positions, [prefer, -prefer]);
        const g = edgeGeometry(a, b, curve);
        return (
          <g key={key}>
            <path
              d={`M ${g.start.x} ${g.start.y} Q ${g.ctrl.x} ${g.ctrl.y} ${g.end.x} ${g.end.y}`}
              fill="none"
              stroke="currentColor"
              markerEnd="url(#arrow)"
            />
            <text x={g.label.x} y={g.label.y} textAnchor="middle" fontSize="12" className="edge-label">
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
          <circle cx={p.x} cy={p.y} r={NODE_R} className={`state${acceptStates.includes(id) ? " accept" : ""}${activeSet.has(id) ? " active" : ""}`} />
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
function AstTree({ node }: { node: ASTNode }) {
  let nextLeafX = 0;
  let maxDepth = 0;
  const LEVEL_HEIGHT = 70;
  const LEAF_SPACING = 60;

  function layout(n: ASTNode, depth: number): Positioned {
    maxDepth = Math.max(maxDepth, depth);
    const y = 40 + depth * LEVEL_HEIGHT;
    if (n.kind === "char") {
      const x = 40 + nextLeafX * LEAF_SPACING;
      nextLeafX += 1;
      return { node: n, x, y, children: [] };
    }
    if (n.kind === "star") {
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

  const label = (n: ASTNode) =>
    n.kind === "char" ? `'${n.value}'` : n.kind === "concat" ? "\u00b7" : n.kind === "alt" ? "|" : "*";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ast-svg" style={{ minWidth: width * MIN_AST_SCALE, maxWidth: width }}>
      {edges.map((e, i) => (
        <line key={i} x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y} stroke="currentColor" />
      ))}
      {nodes.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={NODE_R} className="ast-node" />
          <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13">
            {label(p.node)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function AutomatonView({ stage, ast, automaton, activeStates }: Props) {
  if (stage === "ast") {
    if (!ast) return <div className="automaton-view empty">No pattern parsed yet.</div>;
    return (
      <div className="automaton-view">
        <AstTree node={ast} />
      </div>
    );
  }
  if (!automaton) return <div className="automaton-view empty">No pattern parsed yet.</div>;
  return (
    <div className="automaton-view">
      <AutomatonGraph automaton={automaton} activeStates={activeStates} />
    </div>
  );
}
