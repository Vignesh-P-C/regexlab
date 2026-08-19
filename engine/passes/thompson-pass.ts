/**
 * ThompsonPass — CLAUDE.md v2 §8 (second stage of the pipeline)
 *
 * Algorithm: Thompson's construction — converts an AST into an NFA by
 * recursively building a small "fragment" (a start state and an accept
 * state, with transitions between them) for each AST node, then wiring
 * fragments together according to fixed rules per operator. This is the
 * textbook construction from Aho/Lam/Sethi/Ullman Ch. 3.
 *
 * Key invariant, worth being able to state in a viva: every fragment
 * this pass ever produces has EXACTLY ONE start state and EXACTLY ONE
 * accept state, with no transitions leaving the accept state and no
 * transitions entering the start state from outside the fragment. That
 * invariant is what makes the four combination rules below always valid,
 * regardless of how deeply nested the AST is.
 *
 * The four construction rules (each returns a new fragment from its
 * input fragment(s)):
 *
 *   char c:        (s) --c--> (f)
 *
 *   concat(A, B):  A.accept --eps--> B.start
 *                  new fragment = (A.start, B.accept)
 *
 *   alt(A, B):     new start s --eps--> A.start
 *                  s --eps--> B.start
 *                  A.accept --eps--> new accept f
 *                  B.accept --eps--> f
 *                  new fragment = (s, f)
 *
 *   star(A):       new start s --eps--> A.start
 *                  s --eps--> new accept f   (skip A entirely: zero reps)
 *                  A.accept --eps--> A.start (loop back: repeat)
 *                  A.accept --eps--> f       (exit after any rep)
 *                  new fragment = (s, f)
 *
 * Epsilon transitions are stored under the symbol key "eps" in the same
 * Automaton.transitions map every later pass uses — SubsetConstructionPass
 * is the one that actually computes epsilon-closures over them.
 */

import type { ASTNode, Automaton } from "../types.js";

/** A fragment under construction: exactly one start state, one accept state. */
type Fragment = { start: number; accept: number };

class NFABuilder {
  private stateCount = 0;
  private readonly transitions = new Map<number, Map<string, number[]>>();

  newState(): number {
    return this.stateCount++;
  }

  addTransition(from: number, symbol: string, to: number): void {
    let bySymbol = this.transitions.get(from);
    if (!bySymbol) {
      bySymbol = new Map();
      this.transitions.set(from, bySymbol);
    }
    const destinations = bySymbol.get(symbol);
    if (destinations) {
      destinations.push(to);
    } else {
      bySymbol.set(symbol, [to]);
    }
  }

  build(startState: number, acceptState: number): Automaton {
    return {
      stateCount: this.stateCount,
      startState,
      acceptStates: new Set([acceptState]),
      transitions: this.transitions,
    };
  }
}

function buildFragment(node: ASTNode, builder: NFABuilder): Fragment {
  switch (node.kind) {
    case "char": {
      const start = builder.newState();
      const accept = builder.newState();
      builder.addTransition(start, node.value, accept);
      return { start, accept };
    }

    case "concat": {
      const left = buildFragment(node.left, builder);
      const right = buildFragment(node.right, builder);
      builder.addTransition(left.accept, "eps", right.start);
      return { start: left.start, accept: right.accept };
    }

    case "alt": {
      const left = buildFragment(node.left, builder);
      const right = buildFragment(node.right, builder);
      const start = builder.newState();
      const accept = builder.newState();
      builder.addTransition(start, "eps", left.start);
      builder.addTransition(start, "eps", right.start);
      builder.addTransition(left.accept, "eps", accept);
      builder.addTransition(right.accept, "eps", accept);
      return { start, accept };
    }

    case "star": {
      const inner = buildFragment(node.child, builder);
      const start = builder.newState();
      const accept = builder.newState();
      builder.addTransition(start, "eps", inner.start);
      builder.addTransition(start, "eps", accept);
      builder.addTransition(inner.accept, "eps", inner.start);
      builder.addTransition(inner.accept, "eps", accept);
      return { start, accept };
    }
  }
}

/** ThompsonPass entry point: AST in, NFA (as an Automaton) out. Pure, no side effects. */
export function thompsonConstruction(ast: ASTNode): Automaton {
  const builder = new NFABuilder();
  const fragment = buildFragment(ast, builder);
  return builder.build(fragment.start, fragment.accept);
}