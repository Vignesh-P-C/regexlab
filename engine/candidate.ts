/**
 * candidate.ts — issue #68 (Subset Growth / NFA Structure Lab, PR A)
 *
 * The "copy on write" layer for what-if NFA edits. Everything here
 * produces a NEW Automaton; nothing ever mutates the baseline passed in.
 * This is what makes the feature safe to bolt onto the existing pipeline:
 * the baseline NFA that drives ordinary compile/match/playback is never
 * touched, no matter how many candidates get built from it.
 *
 * A candidate can delete one or several epsilon edges in one edit. All
 * selected removals are applied together to a clone before the exact
 * equivalence check; this matters because safe individual deletions can
 * be unsafe in combination.
 */

import type { Automaton } from "./types.js";
import type { CandidateEdgeId, CandidateEdit } from "./growth-types.js";

/** Deep copy — no shared Map/Set/array structure with the input. */
export function cloneAutomaton(automaton: Automaton): Automaton {
  const transitions = new Map<number, Map<string, number[]>>();
  for (const [state, bySymbol] of automaton.transitions) {
    const copy = new Map<string, number[]>();
    for (const [symbol, targets] of bySymbol) {
      copy.set(symbol, [...targets]);
    }
    transitions.set(state, copy);
  }
  return {
    stateCount: automaton.stateCount,
    startState: automaton.startState,
    acceptStates: new Set(automaton.acceptStates),
    transitions,
  };
}

/** Every distinct (source, "eps", target) relation — a candidate edit's stable identity space. */
export function listEligibleEpsilonEdges(nfa: Automaton): CandidateEdgeId[] {
  const edges: CandidateEdgeId[] = [];
  for (const [source, bySymbol] of nfa.transitions) {
    const targets = bySymbol.get("eps");
    if (!targets) continue;
    for (const target of new Set(targets)) {
      edges.push({ source, symbol: "eps", target });
    }
  }
  // Stable, deterministic ordering — independent of Map iteration order,
  // which JS guarantees is insertion order but which this feature should
  // never depend on silently.
  edges.sort((a, b) => a.source - b.source || a.target - b.target);
  return edges;
}

/**
 * Applies one edit to a FRESH clone of `nfa` and returns that clone.
 * `nfa` itself is never modified. Deleting an edge that doesn't exist is
 * a no-op on the clone (not an error) — the caller is expected to pick
 * edges from listEligibleEpsilonEdges() in the first place.
 */
export function applyCandidateEdit(nfa: Automaton, edit: CandidateEdit): Automaton {
  const candidate = cloneAutomaton(nfa);
  const edges = edit.kind === "deleteEpsilonEdge" ? [edit.edge] : edit.edges;

  for (const edge of edges) {
    const bySymbol = candidate.transitions.get(edge.source);
    const targets = bySymbol?.get("eps");
    if (!bySymbol || !targets) continue;

    const index = targets.indexOf(edge.target);
    if (index === -1) continue;

    const remaining = targets.slice(0, index).concat(targets.slice(index + 1));
    if (remaining.length > 0) bySymbol.set("eps", remaining);
    else bySymbol.delete("eps");
  }

  return candidate;
}
