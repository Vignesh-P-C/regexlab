/**
 * equivalence.ts — issue #68 (Subset Growth / NFA Structure Lab, PR A)
 *
 * The reusable exact-equivalence verifier. THIS is the function PR B's
 * bounded search should call once per candidate rather than
 * re-implementing product BFS — see checkEquivalence()'s own comment.
 *
 * Algorithm (textbook): two DFAs recognize the same language iff there is
 * no reachable pair of states, one from each machine, where the two
 * machines disagree on acceptance. Determinize both automata, complete
 * each over the UNION of both alphabets with a rejecting sink for any
 * missing transition, then breadth-first search the product graph from
 * the pair of start states. BFS visits states in non-decreasing distance
 * order, so the first distinguishing pair found yields a SHORTEST
 * distinguishing input string. If the search exhausts every reachable
 * pair without finding one, the languages are exactly equal.
 *
 * This is exact whenever it completes. Both subset construction and
 * product traversal have hard, finite, injectable budgets; exceeding any
 * limit returns inconclusive rather than a guessed equivalent/different
 * result (MD §5.3, point 8 — do not reinterpret a resource limit as a
 * language inequivalence or equivalence).
 */

import type { Automaton } from "./types.js";
import type { EquivalenceResult } from "./growth-types.js";
import {
  DEFAULT_SUBSET_CONSTRUCTION_LIMITS,
  subsetConstructionBounded,
  type SubsetConstructionLimits,
} from "./passes/subset-construction-pass.js";

/** Default cap on visited product-state pairs before giving up as inconclusive.
 *  Chosen as a round number comfortably above what any pattern within the
 *  existing 500-char/1000-depth guards produces for the two worked examples
 *  in this PR's tests (a handful of pairs each), while still being a real,
 *  finite, stated limit rather than "run until the machine falls over". */
export const DEFAULT_EQUIVALENCE_BUDGET = 20_000;

function alphabetOfDfa(dfa: Automaton): string[] {
  const symbols = new Set<string>();
  for (const bySymbol of dfa.transitions.values()) {
    for (const symbol of bySymbol.keys()) symbols.add(symbol);
  }
  return [...symbols];
}

/** Returns a NEW Automaton: `dfa` plus one rejecting sink state, with every
 *  (state, symbol) pair in `alphabet` given an explicit transition — sink
 *  transitions to itself on every symbol. `dfa` itself is not mutated. */
function completeWithSink(dfa: Automaton, alphabet: readonly string[]): Automaton {
  const sinkId = dfa.stateCount;
  const transitions = new Map<number, Map<string, number[]>>();
  for (const [state, bySymbol] of dfa.transitions) {
    transitions.set(state, new Map(bySymbol));
  }
  for (let state = 0; state < dfa.stateCount; state++) {
    const bySymbol = transitions.get(state) ?? new Map<string, number[]>();
    if (!transitions.has(state)) transitions.set(state, bySymbol);
    for (const symbol of alphabet) {
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, [sinkId]);
    }
  }
  const sinkRow = new Map<string, number[]>();
  for (const symbol of alphabet) sinkRow.set(symbol, [sinkId]);
  transitions.set(sinkId, sinkRow);

  return {
    stateCount: dfa.stateCount + 1,
    startState: dfa.startState,
    acceptStates: new Set(dfa.acceptStates), // sink is never accepting
    transitions,
  };
}

function pairKey(a: number, b: number): string {
  return `${a},${b}`;
}

/**
 * Exact language equivalence of two NFAs (ordinary Automaton values —
 * epsilon edges and "cs:" labels are fine, this determinizes both first).
 * Reusable by PR B: call once per candidate against the same baseline.
 */
export function checkEquivalence(
  baselineNfa: Automaton,
  candidateNfa: Automaton,
  budget: number = DEFAULT_EQUIVALENCE_BUDGET,
  subsetLimits: SubsetConstructionLimits = DEFAULT_SUBSET_CONSTRUCTION_LIMITS,
): EquivalenceResult {
  const baselineResult = subsetConstructionBounded(baselineNfa, subsetLimits);
  if (!baselineResult.ok) {
    return { status: "inconclusive", reason: "Baseline " + baselineResult.reason + "." };
  }

  const candidateResult = subsetConstructionBounded(candidateNfa, subsetLimits);
  if (!candidateResult.ok) {
    return { status: "inconclusive", reason: "Candidate " + candidateResult.reason + "." };
  }

  const baselineDfa = baselineResult.dfa;
  const candidateDfa = candidateResult.dfa;

  const unionAlphabet = [...new Set([...alphabetOfDfa(baselineDfa), ...alphabetOfDfa(candidateDfa)])].sort();

  const baseline = completeWithSink(baselineDfa, unionAlphabet);
  const candidate = completeWithSink(candidateDfa, unionAlphabet);

  type Parent = { from: string; symbol: string } | null;
  const parent = new Map<string, Parent>();
  const startKey = pairKey(baseline.startState, candidate.startState);
  parent.set(startKey, null);

  const queue: Array<{ b: number; c: number; key: string }> = [
    { b: baseline.startState, c: candidate.startState, key: startKey },
  ];
  let visited = 0;
  let head = 0;

  function reconstructWord(key: string): string {
    const chars: string[] = [];
    let cursor: string | undefined = key;
    while (cursor !== undefined) {
      const p = parent.get(cursor);
      if (p === null || p === undefined) break;
      chars.push(p.symbol);
      cursor = p.from;
    }
    return chars.reverse().join("");
  }

  while (head < queue.length) {
    const { b, c, key } = queue[head++];
    visited++;
    if (visited > budget) {
      return { status: "inconclusive", reason: `Resource limit reached: more than ${budget} product states visited before the search completed.` };
    }

    const bAccept = baseline.acceptStates.has(b);
    const cAccept = candidate.acceptStates.has(c);
    if (bAccept !== cAccept) {
      const word = reconstructWord(key);
      return {
        status: "different",
        witness: { word, isEmpty: word.length === 0, baselineAccepts: bAccept, candidateAccepts: cAccept },
      };
    }

    for (const symbol of unionAlphabet) {
      const nextB = baseline.transitions.get(b)!.get(symbol)![0];
      const nextC = candidate.transitions.get(c)!.get(symbol)![0];
      const nextKey = pairKey(nextB, nextC);
      if (!parent.has(nextKey)) {
        parent.set(nextKey, { from: key, symbol });
        queue.push({ b: nextB, c: nextC, key: nextKey });
      }
    }
  }

  return { status: "equivalent" };
}
