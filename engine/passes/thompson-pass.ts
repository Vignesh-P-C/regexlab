/** Thompson construction from AST to an epsilon-NFA. */
import type { ASTNode, Automaton } from "../types.js";
import { encodeCharacterSet } from "../character-set.js";
type Fragment = { start: number; accept: number };
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
function buildFragment(node: ASTNode, b: NFABuilder): Fragment {
  switch (node.kind) {
    case "char": { const start = b.newState(), accept = b.newState(); b.addTransition(start, node.value, accept); return { start, accept }; }
    case "charset": { const start = b.newState(), accept = b.newState(); if (node.characters.length) b.addTransition(start, encodeCharacterSet(node.characters), accept); return { start, accept }; }
    case "concat": { const l = buildFragment(node.left, b), r = buildFragment(node.right, b); b.addTransition(l.accept, "eps", r.start); return { start: l.start, accept: r.accept }; }
    case "alt": {
      const l = buildFragment(node.left, b), r = buildFragment(node.right, b), start = b.newState(), accept = b.newState();
      b.addTransition(start, "eps", l.start); b.addTransition(start, "eps", r.start); b.addTransition(l.accept, "eps", accept); b.addTransition(r.accept, "eps", accept); return { start, accept };
    }
    case "star": {
      const inner = buildFragment(node.child, b), start = b.newState(), accept = b.newState();
      b.addTransition(start, "eps", inner.start); b.addTransition(start, "eps", accept); b.addTransition(inner.accept, "eps", inner.start); b.addTransition(inner.accept, "eps", accept); return { start, accept };
    }
    case "plus": {
      const inner = buildFragment(node.child, b), start = b.newState(), accept = b.newState();
      b.addTransition(start, "eps", inner.start); b.addTransition(inner.accept, "eps", inner.start); b.addTransition(inner.accept, "eps", accept); return { start, accept };
    }
    case "optional": {
      const inner = buildFragment(node.child, b), start = b.newState(), accept = b.newState();
      b.addTransition(start, "eps", inner.start); b.addTransition(start, "eps", accept); b.addTransition(inner.accept, "eps", accept); return { start, accept };
    }
  }
}
export function thompsonConstruction(ast: ASTNode): Automaton {
  const builder = new NFABuilder(), fragment = buildFragment(ast, builder);
  return builder.build(fragment.start, fragment.accept);
}
