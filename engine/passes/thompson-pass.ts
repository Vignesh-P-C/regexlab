/**
 * ThompsonPass — CLAUDE.md v2 §8 (second stage of the pipeline)
 *
 * Algorithm: Thompson's construction — converts an AST into an NFA by
 * recursively building a small "fragment" (a start state and an accept
 * state, with transitions between them) for each AST node, then wiring
 * fragments together according to fixed rules per operator. This is the
 * textbook construction from Aho/Lam/Sethi/Ullman Ch. 3.
 *
 * Most fragments carry one start state and one accept state. When plus
 * is the left operand of concatenation, its mandatory and repeating copies
 * expose two continuation exits so both can connect directly to the next
 * fragment. A top-level plus still receives one shared accept state.
 *
 * This keeps the a+ graph equivalent to a.a* while avoiding an extra
 * plus-accept/concatenation seam before a following fragment.
 *
 * The construction rules (each returns a new fragment from its input
 * fragment(s)):
 *
 *   char c:        (s) --c--> (f)
 *
 *   charset:       (s) --cs:<bitmap>--> (f)   one edge for the WHOLE set
 *                  (grammar v1 / issue #60 — see below)
 *
 *   concat(A, B):  each continuation exit of A --eps--> B.start
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
 *   plus(A):       build mandatory A and repeating A copies
 *                  mandatory.accept --eps--> repeating.start
 *                  repeating.accept --eps--> repeating.start (repeat)
 *                  both copy accepts continue to the next concat fragment,
 *                  or connect to one shared accept when plus is top-level
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
 *   - plus is "one or more", represented as a mandatory copy followed by
 *     a repeating copy. In concatenation, both possible exits connect directly
 *     to the continuation; at the root, both connect to one shared accept.
 *   - `optional` is "zero or one": a skip edge straight to the new accept
 *     state, exactly like star's skip edge, but with NO loop-back edge
 *     (so at most one repetition is ever possible).
 */

import type { ASTNode, Automaton } from "../types.js";
import { encodeCharacterSet } from "../character-set.js";

/** A fragment under construction: exactly one start state, one accept state. */
type Fragment = { start: number; accept: number; inlineExits?: number[] };

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

function buildFragment(node: ASTNode, builder: NFABuilder, inlineTerminalPlus = false): Fragment {
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
      const left = buildFragment(node.left, builder, true);
      const right = buildFragment(node.right, builder, inlineTerminalPlus);
      for (const exit of left.inlineExits ?? [left.accept]) {
        builder.addTransition(exit, "eps", right.start);
      }
      return { start: left.start, accept: right.accept, inlineExits: right.inlineExits };
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

    // One or more: a mandatory copy followed by a repeating copy. If a
    // following concatenation exists, expose both exits so that its start is
    // shared directly instead of allocating another plus accept state.
    case "plus": {
      const first = buildFragment(node.child, builder);
      const repeated = buildFragment(node.child, builder);
      builder.addTransition(first.accept, "eps", repeated.start);
      builder.addTransition(repeated.accept, "eps", repeated.start);

      if (inlineTerminalPlus) {
        return {
          start: first.start,
          accept: repeated.accept,
          inlineExits: [first.accept, repeated.accept],
        };
      }

      const accept = builder.newState();
      builder.addTransition(first.accept, "eps", accept);
      builder.addTransition(repeated.accept, "eps", accept);
      return { start: first.start, accept };
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
