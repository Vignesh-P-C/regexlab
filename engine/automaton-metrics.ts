/**
 * AutomatonMetrics — issue #68 (Subset Growth / NFA Structure Lab, PR A)
 *
 * Pure, read-only measurements of a single Automaton (NFA or DFA — the
 * function doesn't care which). Used both for the baseline NFA shown in
 * the Growth panel and for a what-if candidate's NFA after an edit, so
 * the two can be compared side by side with the same definitions.
 *
 * Definitions (stated here once, precisely, because "trim" and "alphabet
 * size" are easy to define two different ways by accident):
 *
 *   raw state count      — automaton.stateCount, no filtering.
 *   reachable states      — states reachable from startState by following
 *                            ANY transition (including "eps" and "cs:"
 *                            edges) forward, zero or more times.
 *   trim states            — reachable states that can ALSO reach at least
 *                            one accept state by following transitions
 *                            forward zero or more times. ("Trim" is the
 *                            standard automata-theory term for this.)
 *   epsilon-edge count     — distinct (source, "eps", target) relations.
 *   consuming-edge count   — distinct (source, symbol, target) relations
 *                            where symbol != "eps". A single "cs:" edge
 *                            counts as ONE relation here, regardless of
 *                            how many ASCII codes it matches — that
 *                            expansion is SubsetConstructionPass's job,
 *                            not a property of the NFA itself.
 *   alphabet size           — count of distinct symbol labels (excluding
 *                            "eps") appearing on at least one transition.
 *                            A "cs:..." label counts as ONE symbol here
 *                            (this is the NFA's own label alphabet, not
 *                            the per-ASCII-character alphabet that
 *                            SubsetConstructionPass's own alphabetOf()
 *                            computes for building the DFA — the two
 *                            numbers are intentionally different views).
 */

import type { Automaton } from "./types.js";

export type AutomatonMetrics = {
  rawStateCount: number;
  reachableStateCount: number;
  trimStateCount: number;
  epsilonEdgeCount: number;
  consumingEdgeCount: number;
  totalTransitionCount: number;
  alphabetSize: number;
};

function forwardReachable(nfa: Automaton, from: number): Set<number> {
  const seen = new Set<number>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const state = stack.pop()!;
    for (const targets of nfa.transitions.get(state)?.values() ?? []) {
      for (const target of targets) {
        if (!seen.has(target)) {
          seen.add(target);
          stack.push(target);
        }
      }
    }
  }
  return seen;
}

/** Reverse-edge reachability: every state that can reach `from` going forward. */
function canReach(nfa: Automaton, targetsOfInterest: ReadonlySet<number>): Set<number> {
  // Build the reverse adjacency once, then flood-fill from every accept state.
  const reverse = new Map<number, number[]>();
  for (const [source, bySymbol] of nfa.transitions) {
    for (const targets of bySymbol.values()) {
      for (const target of targets) {
        let preds = reverse.get(target);
        if (!preds) {
          preds = [];
          reverse.set(target, preds);
        }
        preds.push(source);
      }
    }
  }
  const seen = new Set<number>(targetsOfInterest);
  const stack = [...targetsOfInterest];
  while (stack.length > 0) {
    const state = stack.pop()!;
    for (const pred of reverse.get(state) ?? []) {
      if (!seen.has(pred)) {
        seen.add(pred);
        stack.push(pred);
      }
    }
  }
  return seen;
}

export function computeAutomatonMetrics(automaton: Automaton): AutomatonMetrics {
  const reachable = forwardReachable(automaton, automaton.startState);
  const reachesAccept = canReach(automaton, automaton.acceptStates);
  let trimCount = 0;
  for (const state of reachable) {
    if (reachesAccept.has(state)) trimCount++;
  }

  let epsilonEdgeCount = 0;
  let consumingEdgeCount = 0;
  const alphabet = new Set<string>();

  for (const bySymbol of automaton.transitions.values()) {
    for (const [symbol, targets] of bySymbol) {
      // Distinct relations only — dedupe any accidental duplicate targets
      // under the same (source, symbol) pair before counting.
      const distinctTargets = new Set(targets);
      if (symbol === "eps") {
        epsilonEdgeCount += distinctTargets.size;
      } else {
        consumingEdgeCount += distinctTargets.size;
        alphabet.add(symbol);
      }
    }
  }

  return {
    rawStateCount: automaton.stateCount,
    reachableStateCount: reachable.size,
    trimStateCount: trimCount,
    epsilonEdgeCount,
    consumingEdgeCount,
    totalTransitionCount: epsilonEdgeCount + consumingEdgeCount,
    alphabetSize: alphabet.size,
  };
}

/**
 * The coarse `2^n` powerset ceiling from subset construction's worst case
 * (CLAUDE.md §10's O(2^m) line). Computed as an exact arbitrary-precision
 * decimal string via BigInt — n can be in the hundreds under the existing
 * pattern-length guards, which would silently overflow a plain `number`
 * (IEEE-754 doubles lose integer precision past 2^53). BigInt has no such
 * ceiling, so this is the EXACT value, never an approximation, however
 * long the decimal string gets; the frontend decides how to abbreviate it
 * for display (e.g. by the string's digit count) rather than this
 * function silently rounding anything.
 */
export type PowersetCeiling = { exponent: number; exactDecimal: string };

export function computePowersetCeiling(nfaStateCount: number): PowersetCeiling {
  const exponent = Math.max(0, nfaStateCount);
  const exact = 2n ** BigInt(exponent);
  return { exponent, exactDecimal: exact.toString() };
}
