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
  const edges: { from: number; to: number; symbol: string }[] = [];
  for (const [fromStr, bySymbol] of Object.entries(transitions)) {
    const from = Number(fromStr);
    for (const [symbol, targets] of Object.entries(bySymbol)) {
      for (const to of targets) edges.push({ from, to, symbol });
    }
  }

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="automaton-svg">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>

      {edges.map((e, i) => {
        const a = positions[e.from];
        const b = positions[e.to];
        if (e.from === e.to) {
          const loopY = a.y - NODE_R - 24;
          return (
            <g key={i}>
              <path
                d={`M ${a.x - 8} ${a.y - NODE_R} Q ${a.x} ${loopY} ${a.x + 8} ${a.y - NODE_R}`}
                fill="none"
                stroke="currentColor"
                markerEnd="url(#arrow)"
              />
              <text x={a.x} y={loopY - 4} textAnchor="middle" fontSize="12">
                {e.symbol}
              </text>
            </g>
          );
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const startX = a.x + ux * NODE_R;
        const startY = a.y + uy * NODE_R;
        const endX = b.x - ux * NODE_R;
        const endY = b.y - uy * NODE_R;
        return (
          <g key={i}>
            <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="currentColor" markerEnd="url(#arrow)" />
            <text x={(startX + endX) / 2} y={(startY + endY) / 2 - 4} textAnchor="middle" fontSize="12">
              {e.symbol}
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

type Positioned = { node: ASTNode; x: number; y: number; children: Positioned[] };

/** Depth = y, in-order leaf position = x — a plain recursive tree layout. */
function AstTree({ node }: { node: ASTNode }) {
  let nextLeafX = 0;
  const LEVEL_HEIGHT = 70;
  const LEAF_SPACING = 60;

  function layout(n: ASTNode, depth: number): Positioned {
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
    <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="ast-svg">
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
