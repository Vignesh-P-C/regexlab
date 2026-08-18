/**
 * MinimizationPass — CLAUDE.md v2 §8 (fourth stage of the pipeline)
 *
 * Algorithm: Moore's algorithm — iterative partition refinement.
 * Complexity: O(n² · k) — see CLAUDE.md §10 (n = DFA states, k = alphabet
 * size). Hopcroft's O(n log n · k) algorithm is the Hard Stretch upgrade
 * to this pass, deliberately not attempted until this simpler version is
 * solid and both of you can explain it unaided (§0.1 rule 9 / §11).
 *
 * Core idea: two DFA states are "equivalent" (mergeable into one state
 * in the minimal DFA) exactly when no input string can ever tell them
 * apart — i.e. for every symbol, they transition into states that are
 * ALSO equivalent, and they agree on whether they're accepting.
 *
 * Moore's algorithm computes this via refinement, starting from the
 * coarsest possible guess and splitting groups apart only when evidence
 * proves two states aren't actually equivalent:
 *
 *   1. Start with 2 groups: accepting states, non-accepting states.
 *      (This is the coarsest safe guess — nothing in group A can be
 *      equivalent to something in group B, since one accepts and the
 *      other doesn't.)
 *   2. Repeat: for every group, split it into subgroups whenever two
 *      states in it transition to DIFFERENT groups on the same symbol.
 *      This is real evidence they're distinguishable.
 *   3. Stop when a full pass causes zero splits — a fixpoint. What's
 *      left is the coarsest partition consistent with the automaton's
 *      actual behavior, i.e. exactly the equivalence classes we wanted.
 *
 * Each final group becomes exactly one state in the minimized DFA.
 *
 * Note: this pass assumes every input state is reachable from the start
 * state, which is true by construction — SubsetConstructionPass's
 * worklist only ever creates states it discovers via a real transition,
 * so there's no unreachable-state pruning step needed here.
 */

import type { Automaton } from "../types.js";

function alphabetOf(dfa: Automaton): string[] {
  const symbols = new Set<string>();
  for (const bySymbol of dfa.transitions.values()) {
    for (const symbol of bySymbol.keys()) symbols.add(symbol);
  }
  return [...symbols].sort();
}

/** One refinement pass: split every group using each state's "signature" (which group each symbol leads to). */
function refine(groups: number[][], dfa: Automaton, alphabet: string[]): { groups: number[][]; changed: boolean } {
  const groupIndexOf = new Map<number, number>();
  groups.forEach((group, index) => {
    for (const state of group) groupIndexOf.set(state, index);
  });

  const newGroups: number[][] = [];
  let changed = false;

  for (const group of groups) {
    const buckets = new Map<string, number[]>();
    for (const state of group) {
      const signature = alphabet
        .map((symbol) => {
          const dest = dfa.transitions.get(state)?.get(symbol)?.[0];
          return dest === undefined ? "-" : groupIndexOf.get(dest);
        })
        .join(",");
      const bucket = buckets.get(signature);
      if (bucket) {
        bucket.push(state);
      } else {
        buckets.set(signature, [state]);
      }
    }
    if (buckets.size > 1) changed = true;
    newGroups.push(...buckets.values());
  }

  return { groups: newGroups, changed };
}

/** MinimizationPass entry point: DFA in, minimal DFA out (Moore's algorithm). */
export function minimize(dfa: Automaton): Automaton {
  const alphabet = alphabetOf(dfa);

  const allStates = Array.from({ length: dfa.stateCount }, (_, i) => i);
  const accepting = allStates.filter((s) => dfa.acceptStates.has(s));
  const nonAccepting = allStates.filter((s) => !dfa.acceptStates.has(s));

  // Coarsest safe starting partition: accepting vs non-accepting (skip empty groups).
  let groups = [nonAccepting, accepting].filter((g) => g.length > 0);

  // Fixpoint: keep refining until a full pass produces zero splits.
  let changed = true;
  while (changed) {
    const result = refine(groups, dfa, alphabet);
    groups = result.groups;
    changed = result.changed;
  }

  const groupIndexOfState = new Map<number, number>();
  groups.forEach((group, index) => {
    for (const state of group) groupIndexOfState.set(state, index);
  });

  // Renumber groups via a worklist starting from the start group, so IDs are
  // assigned in a deterministic discovery order (same style as the other passes)
  // rather than the arbitrary order refinement happened to produce them in.
  const canonicalId = new Map<number, number>(); // original group index -> canonical new id
  const transitions = new Map<number, Map<string, number[]>>();
  const startGroupIndex = groupIndexOfState.get(dfa.startState)!;

  function idFor(groupIndex: number): number {
    let id = canonicalId.get(groupIndex);
    if (id === undefined) {
      id = canonicalId.size;
      canonicalId.set(groupIndex, id);
    }
    return id;
  }

  const startState = idFor(startGroupIndex);
  const worklist = [startGroupIndex];
  const processed = new Set<number>();

  while (worklist.length > 0) {
    const groupIndex = worklist.pop()!;
    if (processed.has(groupIndex)) continue;
    processed.add(groupIndex);

    const representative = groups[groupIndex][0]; // any member; refinement guarantees they all agree
    const currentId = idFor(groupIndex);

    for (const symbol of alphabet) {
      const dest = dfa.transitions.get(representative)?.get(symbol)?.[0];
      if (dest === undefined) continue;

      const destGroupIndex = groupIndexOfState.get(dest)!;
      const destId = idFor(destGroupIndex);

      let bySymbol = transitions.get(currentId);
      if (!bySymbol) {
        bySymbol = new Map();
        transitions.set(currentId, bySymbol);
      }
      bySymbol.set(symbol, [destId]);

      if (!processed.has(destGroupIndex)) worklist.push(destGroupIndex);
    }
  }

  const acceptStates = new Set<number>();
  groups.forEach((group, groupIndex) => {
    if (dfa.acceptStates.has(group[0])) {
      acceptStates.add(idFor(groupIndex));
    }
  });

  return {
    stateCount: canonicalId.size,
    startState,
    acceptStates,
    transitions,
  };
}