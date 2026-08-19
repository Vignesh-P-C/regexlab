/**
 * SubsetConstructionPass — CLAUDE.md v2 §8 (third stage of the pipeline)
 *
 * Algorithm: subset construction (Rabin–Scott), implemented as a
 * worklist/fixpoint over epsilon-closures — the textbook technique for
 * turning a nondeterministic automaton into a deterministic one.
 *
 * Core idea: each DFA state IS a set of NFA states — specifically, the
 * set of NFA states you could simultaneously be "standing on" while
 * reading the same input. Two structures make this concrete:
 *
 *   epsilonClosure(S) — every NFA state reachable from set S using only
 *   "eps" transitions, including S itself. This is what makes the DFA
 *   deterministic: the epsilon-ambiguity gets folded into which SET of
 *   NFA states a single DFA state represents, so the DFA itself never
 *   needs an "eps" transition at all.
 *
 *   move(S, symbol) — the set of NFA states reachable from set S by
 *   consuming exactly one input symbol (no epsilons).
 *
 * The worklist starts with epsilonClosure({nfa.startState}) as DFA state
 * 0, and for every unprocessed DFA state, computes epsilonClosure(move(S,
 * symbol)) for every symbol in the alphabet — creating a new DFA state
 * only the first time a given set of NFA states is seen (sets are
 * deduplicated by a sorted-and-joined key). This naturally terminates:
 * there are at most 2^|NFA states| distinct sets, so the fixpoint is
 * always reached, even though that bound is exponential in the worst
 * case (see CLAUDE.md §10 complexity table — this is the O(2^m) line).
 *
 * A DFA state is an accept state iff the NFA-state-set it represents
 * contains at least one of the original NFA's accept states.
 */

import type { Automaton } from "../types.js";

function epsilonClosure(nfa: Automaton, states: Iterable<number>): Set<number> {
  const closure = new Set<number>(states);
  const stack = [...closure];
  while (stack.length > 0) {
    const state = stack.pop()!;
    const epsTargets = nfa.transitions.get(state)?.get("eps") ?? [];
    for (const target of epsTargets) {
      if (!closure.has(target)) {
        closure.add(target);
        stack.push(target);
      }
    }
  }
  return closure;
}

function move(nfa: Automaton, states: Iterable<number>, symbol: string): Set<number> {
  const result = new Set<number>();
  for (const state of states) {
    const targets = nfa.transitions.get(state)?.get(symbol) ?? [];
    for (const target of targets) result.add(target);
  }
  return result;
}

/** The input alphabet is every symbol the NFA transitions on, excluding "eps". */
function alphabetOf(nfa: Automaton): string[] {
  const symbols = new Set<string>();
  for (const bySymbol of nfa.transitions.values()) {
    for (const symbol of bySymbol.keys()) {
      if (symbol !== "eps") symbols.add(symbol);
    }
  }
  return [...symbols].sort();
}

/** Canonical, order-independent key for a set of NFA states, used to dedupe DFA states. */
function setKey(states: Set<number>): string {
  return [...states].sort((a, b) => a - b).join(",");
}

/** SubsetConstructionPass entry point: NFA in, DFA out (same Automaton shape, no "eps" transitions). */
export function subsetConstruction(nfa: Automaton): Automaton {
  const alphabet = alphabetOf(nfa);

  const stateSets: Set<number>[] = []; // DFA state id -> the NFA-state-set it represents
  const idBySetKey = new Map<string, number>();
  const transitions = new Map<number, Map<string, number[]>>();

  function idFor(nfaStateSet: Set<number>): number {
    const key = setKey(nfaStateSet);
    let id = idBySetKey.get(key);
    if (id === undefined) {
      id = stateSets.length;
      idBySetKey.set(key, id);
      stateSets.push(nfaStateSet);
    }
    return id;
  }

  const startState = idFor(epsilonClosure(nfa, [nfa.startState]));

  // Worklist/fixpoint: process every DFA state exactly once, even though
  // new states can be discovered mid-loop (stateSets.length grows as we go).
  const processed = new Set<number>();
  const worklist: number[] = [startState];

  while (worklist.length > 0) {
    const current = worklist.pop()!;
    if (processed.has(current)) continue;
    processed.add(current);

    for (const symbol of alphabet) {
      const moved = move(nfa, stateSets[current], symbol);
      if (moved.size === 0) continue; // no transition on this symbol -> implicit dead state, omitted

      const targetId = idFor(epsilonClosure(nfa, moved));

      let bySymbol = transitions.get(current);
      if (!bySymbol) {
        bySymbol = new Map();
        transitions.set(current, bySymbol);
      }
      bySymbol.set(symbol, [targetId]); // deterministic: exactly one destination per symbol

      if (!processed.has(targetId)) worklist.push(targetId);
    }
  }

  const acceptStates = new Set<number>();
  stateSets.forEach((nfaStateSet, dfaId) => {
    for (const nfaState of nfaStateSet) {
      if (nfa.acceptStates.has(nfaState)) {
        acceptStates.add(dfaId);
        break;
      }
    }
  });

  return {
    stateCount: stateSets.length,
    startState,
    acceptStates,
    transitions,
  };
}