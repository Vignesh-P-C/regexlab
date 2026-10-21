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
 * invariant is what makes the combination rules below always valid,
 * regardless of how deeply nested the AST is.
 *
 * The construction rules (each returns a new fragment from its input
 * fragment(s)):
 *
 *   char c:        (s) --c--> (f)
 *
 *   charset:       (s) --cs:<bitmap>--> (f)   one edge for the WHOLE set
 *                  (grammar v1 / issue #60 — see below)
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
 *   plus(A):       new start s --eps--> A.start
 *                  A.accept --eps--> A.start (loop back: repeat)
 *                  A.accept --eps--> new accept f
 *                  new fragment = (s, f)      (grammar v1 — see below)
 *
 *   optional(A):   new start s --eps--> A.start
 *                  s --eps--> new accept f   (skip A entirely: zero reps)
 *                  A.accept --eps--> f
 *                  new fragment = (s, f)      (grammar v1 — see below)
 *
 * Epsilon transitions are stored under the symbol key "eps" in the same
 * Automaton.transitions map every later pass uses — SubsetConstructionPass
 * is the one that actually computes epsilon-closures over them.
 *
 * Grammar v1 additions (issue #60, docs/regex-grammar-v1.md):
 *
 *   - `charset` is its OWN fragment rule, not sugar over many `char`
 *     fragments: a character class, `.`, or a shorthand class (\d \w \s and
 *     their negations) becomes exactly one 2-state fragment with ONE edge
 *     labeled by the whole ASCII set (see character-set.ts's "cs:" encoding),
 *     no matter how many characters the class matches. This keeps the NFA
 *     small; it's SubsetConstructionPass that later expands a "cs:" edge
 *     into one ordinary per-character DFA transition per matching code — see
 *     that pass's own comment for why that expansion, not this fragment
 *     rule, is what makes a wide class expensive downstream.
 *   - `plus` is "one or more": textbook-equivalent to `concat(A, star(A))`,
 *     but built directly as its own 2-state fragment (enter once, loop back,
 *     no skip edge) instead of literally duplicating A's fragment — so `a+`
 *     gets one copy of A's states, not two.
 *   - `optional` is "zero or one": a skip edge straight to the new accept
 *     state, exactly like star's skip edge, but with NO loop-back edge
 *     (so at most one repetition is ever possible).
 */

import type { ASTNode, Automaton } from "../types.js";
import { encodeCharacterSet } from "../character-set.js";

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

    // One fragment, one edge, for the whole ASCII set — see this file's
    // header comment. An empty set (can't actually occur today; the parser
    // rejects empty classes as InvalidCharacterClass) would produce a
    // fragment with no transition at all, i.e. a dead end.
    case "charset": {
      const start = builder.newState();
      const accept = builder.newState();
      if (node.characters.length > 0) {
        builder.addTransition(start, encodeCharacterSet(node.characters), accept);
      }
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

    // "One or more": like star, but with NO skip edge from start to
    // accept — the inner fragment must be entered at least once before
    // the loop-back/exit choice applies.
    case "plus": {
      const inner = buildFragment(node.child, builder);
      const start = builder.newState();
      const accept = builder.newState();
      builder.addTransition(start, "eps", inner.start);
      builder.addTransition(inner.accept, "eps", inner.start);
      builder.addTransition(inner.accept, "eps", accept);
      return { start, accept };
    }

    // "Zero or one": like star's skip edge, but with NO loop-back edge —
    // once through the inner fragment, the only way out is to accept.
    case "optional": {
      const inner = buildFragment(node.child, builder);
      const start = builder.newState();
      const accept = builder.newState();
      builder.addTransition(start, "eps", inner.start);
      builder.addTransition(start, "eps", accept);
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
