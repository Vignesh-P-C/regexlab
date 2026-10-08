import type { ASTNode, Automaton, Stage } from "../types/engine";

type Props = {
  stage: Stage;
  ast: ASTNode | null;
  automaton: Automaton | null; // the nfa/dfa/minDfa matching `stage`
  activeStates: number[]; // from MatchTrace.steps[activeStep], applies only to minDfa
};

const WIDTH = 640;
const HEIGHT = 420;
const NODE_R = 20;

type Point = { x: number; y: number };
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

/** States laid out on a circle; transitions as labeled arrows, self-loops as small arcs. */
function AutomatonGraph({ automaton, activeStates }: { automaton: Automaton; activeStates: number[] }) {
  const { stateCount, startState, acceptStates, transitions } = automaton;
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const radius = Math.min(WIDTH, HEIGHT) / 2 - 60;

  const positions = Array.from({ length: stateCount }, (_, i) => {
    const angle = (2 * Math.PI * i) / Math.max(stateCount, 1) - Math.PI / 2;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  const activeSet = new Set(activeStates);
  const edges = groupEdges(transitions);
  const edgeKeys = new Set(edges.map((e) => `${e.from}>${e.to}`));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="automaton-svg">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>

      {edges.map((e) => {
        const a = positions[e.from];
        const b = positions[e.to];
        const label = e.symbols.join(",");
        const key = `${e.from}>${e.to}`;
        if (e.from === e.to) {
          const loopY = a.y - NODE_R - 24;
          return (
            <g key={key}>
              <path
                d={`M ${a.x - 8} ${a.y - NODE_R} Q ${a.x} ${loopY} ${a.x + 8} ${a.y - NODE_R}`}
                fill="none"
                stroke="currentColor"
                markerEnd="url(#arrow)"
              />
              <text x={a.x} y={loopY - 4} textAnchor="middle" fontSize="12" className="edge-label">
                {label}
              </text>
            </g>
          );
        }
        const twoWay = edgeKeys.has(`${e.to}>${e.from}`);
        const g = edgeGeometry(a, b, twoWay ? PAIR_CURVE : 0);
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
          <circle cx={p.x} cy={p.y} r={NODE_R} className={activeSet.has(id) ? "state active" : "state"} />
          {acceptStates.includes(id) && <circle cx={p.x} cy={p.y} r={NODE_R - 4} fill="none" stroke="currentColor" />}
          <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13">
            {id}
          </text>
        </g>
      ))}
    </svg>
  );
}

const MIN_AST_HEIGHT = 160;
// Large trees stop shrinking to fit at this fraction of natural size and
// scroll inside the view instead, so nodes stay legible.
const MIN_AST_SCALE = 0.5;

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
  const width = Math.max(WIDTH, nextLeafX * LEAF_SPACING + 80);
  // Height follows the tree's depth (D7): a fixed height clipped any tree
  // deeper than 5 levels. 40px margin above the root and below the deepest row.
  const height = Math.max(MIN_AST_HEIGHT, 80 + maxDepth * LEVEL_HEIGHT);

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
    <svg viewBox={`0 0 ${width} ${height}`} className="ast-svg" style={{ minWidth: width * MIN_AST_SCALE }}>
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
