/** Thompson construction from AST to an epsilon-NFA. */
import type { ASTNode, Automaton } from "../types.js";
import { encodeCharacterSet } from "../character-set.js";
import { AutomatonTooComplexError, MAX_NFA_STATES } from "../resource-limits.js";
type Fragment = { start: number; accept: number; inlineExits?: number[] };

function addCapped(left: number, right: number): number {
  return left > MAX_NFA_STATES || right > MAX_NFA_STATES - left ? MAX_NFA_STATES + 1 : left + right;
}

function doubleCapped(value: number): number {
  return value > Math.floor(MAX_NFA_STATES / 2) ? MAX_NFA_STATES + 1 : value * 2;
}

/** Counts the exact allocations buildFragment will make, saturating before exponential growth. */
function estimateStateCount(node: ASTNode, inlineTerminalPlus = false): number {
  switch (node.kind) {
    case "char":
    case "charset":
      return 2;
    case "concat":
      return addCapped(estimateStateCount(node.left, true), estimateStateCount(node.right, inlineTerminalPlus));
    case "alt":
      return addCapped(addCapped(estimateStateCount(node.left), estimateStateCount(node.right)), 2);
    case "star":
    case "optional":
      return addCapped(estimateStateCount(node.child), 2);
    case "plus":
      return addCapped(doubleCapped(estimateStateCount(node.child)), inlineTerminalPlus ? 0 : 1);
  }
}
class NFABuilder {
  private stateCount = 0;
  private readonly transitions = new Map<number, Map<string, number[]>>();
  newState(): number { return this.stateCount++; }
  addTransition(from: number, symbol: string, to: number): void {
    let bySymbol = this.transitions.get(from);
    if (!bySymbol) { bySymbol = new Map(); this.transitions.set(from, bySymbol); }
    const dest = bySymbol.get(symbol);
    if (dest) dest.push(to); else bySymbol.set(symbol, [to]);
  }
  build(startState: number, acceptState: number): Automaton {
    return { stateCount: this.stateCount, startState, acceptStates: new Set([acceptState]), transitions: this.transitions };
  }
}
function buildFragment(node: ASTNode, b: NFABuilder, inlineTerminalPlus = false): Fragment {
  switch (node.kind) {
    case "char": { const start = b.newState(), accept = b.newState(); b.addTransition(start, node.value, accept); return { start, accept }; }
    case "charset": { const start = b.newState(), accept = b.newState(); if (node.characters.length) b.addTransition(start, encodeCharacterSet(node.characters), accept); return { start, accept }; }
    case "concat": {
      const l = buildFragment(node.left, b, true), r = buildFragment(node.right, b, inlineTerminalPlus);
      for (const exit of l.inlineExits ?? [l.accept]) b.addTransition(exit, "eps", r.start);
      return { start: l.start, accept: r.accept, inlineExits: r.inlineExits };
    }
    case "alt": {
      const l = buildFragment(node.left, b), r = buildFragment(node.right, b), start = b.newState(), accept = b.newState();
      b.addTransition(start, "eps", l.start); b.addTransition(start, "eps", r.start); b.addTransition(l.accept, "eps", accept); b.addTransition(r.accept, "eps", accept); return { start, accept };
    }
    case "star": {
      const inner = buildFragment(node.child, b), start = b.newState(), accept = b.newState();
      b.addTransition(start, "eps", inner.start); b.addTransition(start, "eps", accept); b.addTransition(inner.accept, "eps", inner.start); b.addTransition(inner.accept, "eps", accept); return { start, accept };
    }
    case "plus": {
      const first = buildFragment(node.child, b), repeated = buildFragment(node.child, b);
      b.addTransition(first.accept, "eps", repeated.start);
      b.addTransition(repeated.accept, "eps", repeated.start);
      if (inlineTerminalPlus) {
        return { start: first.start, accept: repeated.accept, inlineExits: [first.accept, repeated.accept] };
      }
      const accept = b.newState();
      b.addTransition(first.accept, "eps", accept); b.addTransition(repeated.accept, "eps", accept);
      return { start: first.start, accept };
    }
    case "optional": {
      const inner = buildFragment(node.child, b), start = b.newState(), accept = b.newState();
      b.addTransition(start, "eps", inner.start); b.addTransition(start, "eps", accept); b.addTransition(inner.accept, "eps", accept); return { start, accept };
    }
  }
}
export function thompsonConstruction(ast: ASTNode): Automaton {
  const estimatedStates = estimateStateCount(ast);
  if (estimatedStates > MAX_NFA_STATES) {
    throw new AutomatonTooComplexError(
      `Thompson construction would exceed the safe limit of ${MAX_NFA_STATES.toLocaleString()} NFA states.`,
    );
  }
  const builder = new NFABuilder(), fragment = buildFragment(ast, builder);
  return builder.build(fragment.start, fragment.accept);
}
