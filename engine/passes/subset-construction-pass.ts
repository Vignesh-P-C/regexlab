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
 *
 * Grammar v1 addition (issue #60, docs/regex-grammar-v1.md): a
 * CharacterSetNode compiles (in ThompsonPass) to ONE NFA edge labeled
 * with its whole ASCII set (the "cs:" encoding — see character-set.ts),
 * not one edge per matching character. THIS pass is where that
 * compactness goes away again: alphabetOf() below decodes every "cs:"
 * label it finds into its individual ASCII characters and adds each one
 * to the DFA's alphabet, and move() uses transitionMatches() so a single
 * "cs:" edge answers "yes" to every character it covers. The DFA that
 * comes out the other end therefore has one transition per ASCII
 * character, exactly like it always did for plain literals — the "cs:"
 * form is purely an NFA-level space-saving trick, invisible from here
 * downstream. The cost of that: a wide class (e.g. `.`, ~126 codes) makes
 * the DFA's alphabet ~126 symbols wide instead of ~1, which is exactly
 * the quantity MinimizationPass's alphabet compression (see
 * minimization-pass.ts) exists to claw back before Moore's refinement
 * has to pay O(alphabetSize) per state per round for it.
 */

import type { Automaton } from "../types.js";
import type { SubsetConstructionStep, SubsetTrace } from "../growth-types.js";
import { decodeCharacterSet, transitionMatches } from "../character-set.js";
import { AutomatonTooComplexError, MAX_SUBSET_TRACE_STEPS } from "../resource-limits.js";

export type SubsetConstructionLimits = {
  /** Maximum number of distinct reachable subsets (DFA states). */
  maxDfaStates: number;
  /**
   * Deterministic work units charged for inspected NFA edges, alphabet
   * expansion, subset-key construction, and each state/symbol pair.
   */
  maxWorkUnits: number;
};

export const DEFAULT_SUBSET_CONSTRUCTION_LIMITS: Readonly<SubsetConstructionLimits> = Object.freeze({
  maxDfaStates: 20_000,
  maxWorkUnits: 1_000_000,
});

export type BoundedSubsetConstructionResult =
  | { ok: true; dfa: Automaton }
  | { ok: false; reason: string };

type WorkBudget = { remaining: number };

class SubsetConstructionBudgetExceeded extends Error {}

function accountWork(budget: WorkBudget | undefined, amount = 1): void {
  if (!budget) return;
  if (amount > budget.remaining) {
    throw new SubsetConstructionBudgetExceeded("determinization work-unit limit exceeded");
  }
  budget.remaining -= amount;
}

function epsilonClosure(nfa: Automaton, states: Iterable<number>, budget?: WorkBudget): Set<number> {
  const closure = new Set<number>(states);
  const stack = [...closure];
  while (stack.length > 0) {
    const state = stack.pop()!;
    const epsTargets = nfa.transitions.get(state)?.get("eps") ?? [];
    for (const target of epsTargets) {
      accountWork(budget);
      if (!closure.has(target)) {
        closure.add(target);
        stack.push(target);
      }
    }
  }
  return closure;
}

/**
 * Unlike the pre-grammar-v1 version, this can't just look up
 * `nfa.transitions.get(state)?.get(symbol)` directly: `symbol` is always
 * a single ASCII character (see alphabetOf), but the NFA edge that
 * matches it might be labeled with that literal character OR with a
 * "cs:" set that happens to include it. transitionMatches() (see
 * character-set.ts) is what tells the two apart.
 */
function move(nfa: Automaton, states: Iterable<number>, symbol: string, budget?: WorkBudget): Set<number> {
  const result = new Set<number>();
  for (const state of states) {
    accountWork(budget);
    for (const [label, targets] of nfa.transitions.get(state) ?? []) {
      accountWork(budget);
      if (transitionMatches(label, symbol)) {
        for (const target of targets) {
          accountWork(budget);
          result.add(target);
        }
      }
    }
  }
  return result;
}

/**
 * The input alphabet is every symbol the NFA transitions on, excluding
 * "eps" — expanded one ASCII character at a time, even for symbols that
 * arrived compacted as a "cs:" set. See this file's header comment for
 * why that expansion happens here and what it costs downstream.
 */
function alphabetOf(nfa: Automaton, budget?: WorkBudget): string[] {
  const symbols = new Set<string>();
  for (const bySymbol of nfa.transitions.values()) {
    for (const label of bySymbol.keys()) {
      accountWork(budget);
      if (label === "eps") continue;
      const characterSet = decodeCharacterSet(label);
      if (characterSet) {
        for (const code of characterSet) {
          accountWork(budget);
          symbols.add(String.fromCharCode(code));
        }
      } else if (label.length === 1) {
        symbols.add(label);
      }
    }
  }
  return [...symbols].sort();
}

/** Canonical, order-independent key for a set of NFA states, used to dedupe DFA states. */
function setKey(states: Set<number>, budget?: WorkBudget): string {
  accountWork(budget, states.size);
  return [...states].sort((a, b) => a - b).join(",");
}

/** SubsetConstructionPass entry point: NFA in, DFA out (same Automaton shape, no "eps" transitions). */
function subsetConstructionImpl(nfa: Automaton, limits?: SubsetConstructionLimits): Automaton {
  if (
    limits &&
    (!Number.isSafeInteger(limits.maxDfaStates) ||
      limits.maxDfaStates < 0 ||
      !Number.isSafeInteger(limits.maxWorkUnits) ||
      limits.maxWorkUnits < 0)
  ) {
    throw new RangeError("Subset-construction limits must be non-negative safe integers, with at least one DFA state allowed.");
  }
  const budget = limits ? { remaining: limits.maxWorkUnits } : undefined;
  const alphabet = alphabetOf(nfa, budget);

  const stateSets: Set<number>[] = []; // DFA state id -> the NFA-state-set it represents
  const idBySetKey = new Map<string, number>();
  const transitions = new Map<number, Map<string, number[]>>();

  function idFor(nfaStateSet: Set<number>): number {
    const key = setKey(nfaStateSet, budget);
    let id = idBySetKey.get(key);
    if (id === undefined) {
      if (limits && stateSets.length >= limits.maxDfaStates) {
        throw new SubsetConstructionBudgetExceeded("determinization DFA-state limit exceeded");
      }
      id = stateSets.length;
      idBySetKey.set(key, id);
      stateSets.push(nfaStateSet);
    }
    return id;
  }

  const startState = idFor(epsilonClosure(nfa, [nfa.startState], budget));

  // Worklist/fixpoint: process every DFA state exactly once, even though
  // new states can be discovered mid-loop (stateSets.length grows as we go).
  const processed = new Set<number>();
  const worklist: number[] = [startState];

  while (worklist.length > 0) {
    const current = worklist.pop()!;
    if (processed.has(current)) continue;
    processed.add(current);

    for (const symbol of alphabet) {
      accountWork(budget);
      const moved = move(nfa, stateSets[current], symbol, budget);
      if (moved.size === 0) continue; // no transition on this symbol -> implicit dead state, omitted

      const targetId = idFor(epsilonClosure(nfa, moved, budget));

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
    accountWork(budget, nfaStateSet.size);
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

/** Runs determinization with explicit state and work caps for opt-in analysis. */
export function subsetConstructionBounded(
  nfa: Automaton,
  limits: SubsetConstructionLimits = DEFAULT_SUBSET_CONSTRUCTION_LIMITS,
): BoundedSubsetConstructionResult {
  try {
    return { ok: true, dfa: subsetConstructionImpl(nfa, limits) };
  } catch (error) {
    if (error instanceof SubsetConstructionBudgetExceeded) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

/** Determinization used by the ordinary pipeline, guarded by explicit state and work limits. */
export function subsetConstruction(
  nfa: Automaton,
  limits: SubsetConstructionLimits = DEFAULT_SUBSET_CONSTRUCTION_LIMITS,
): Automaton {
  const result = subsetConstructionBounded(nfa, limits);
  if (!result.ok) {
    throw new AutomatonTooComplexError(`DFA determinization exceeded its safety limits: ${result.reason}.`);
  }
  return result.dfa;
}

/**
 * SubsetConstructionPass, traced — issue #68 (Subset Growth / NFA
 * Structure Lab, PR A). Same worklist algorithm as subsetConstruction()
 * above (reuses the exact same private helpers: epsilonClosure, move,
 * alphabetOf, setKey), with one addition: every worklist step is
 * recorded as a SubsetConstructionStep. This is a SEPARATE entry point,
 * not a parameter added to subsetConstruction() itself, specifically so
 * the normal pipeline (which calls subsetConstruction() directly) is
 * byte-for-byte untouched by this feature — trace collection only runs
 * when this function is explicitly called.
 */
export function subsetConstructionTraced(
  nfa: Automaton,
  limits: SubsetConstructionLimits = DEFAULT_SUBSET_CONSTRUCTION_LIMITS,
  maxTraceSteps = MAX_SUBSET_TRACE_STEPS,
): { dfa: Automaton; trace: SubsetTrace } {
  if (
    !Number.isSafeInteger(limits.maxDfaStates) ||
    limits.maxDfaStates < 1 ||
    !Number.isSafeInteger(limits.maxWorkUnits) ||
    limits.maxWorkUnits < 0 ||
    !Number.isSafeInteger(maxTraceSteps) ||
    maxTraceSteps < 0
  ) {
    throw new RangeError("Subset trace limits must be non-negative safe integers, with at least one DFA state allowed.");
  }

  const budget = { remaining: limits.maxWorkUnits };
  try {
    const alphabet = alphabetOf(nfa, budget);
    const stateSets: Set<number>[] = [];
    const idBySetKey = new Map<string, number>();
    const transitions = new Map<number, Map<string, number[]>>();
    const steps: SubsetConstructionStep[] = [];

    function idFor(nfaStateSet: Set<number>): { id: number; isNew: boolean } {
      const key = setKey(nfaStateSet, budget);
      let id = idBySetKey.get(key);
      if (id === undefined) {
        if (stateSets.length >= limits.maxDfaStates) {
          throw new SubsetConstructionBudgetExceeded("DFA-state limit exceeded");
        }
        id = stateSets.length;
        idBySetKey.set(key, id);
        stateSets.push(nfaStateSet);
        return { id, isNew: true };
      }
      return { id, isNew: false };
    }

    function sortedStates(states: Iterable<number>): number[] {
      return [...states].sort((a, b) => a - b);
    }

    const startClosure = epsilonClosure(nfa, [nfa.startState], budget);
    const { id: startState } = idFor(startClosure);
    const processed = new Set<number>();
    const worklist: number[] = [startState];

    while (worklist.length > 0) {
      const current = worklist.pop()!;
      if (processed.has(current)) continue;
      processed.add(current);

      for (const symbol of alphabet) {
        accountWork(budget);
        const sourceNfaStates = stateSets[current];
        const moved = move(nfa, sourceNfaStates, symbol, budget);
        if (moved.size === 0) continue;

        const closure = epsilonClosure(nfa, moved, budget);
        const { id: targetId, isNew } = idFor(closure);
        accountWork(budget, closure.size);
        const isAccepting = [...closure].some((state) => nfa.acceptStates.has(state));
        if (steps.length >= maxTraceSteps) {
          throw new SubsetConstructionBudgetExceeded("subset-trace step limit exceeded");
        }

        steps.push({
          sourceId: current,
          sourceNfaStates: sortedStates(sourceNfaStates),
          symbol,
          moveNfaStates: sortedStates(moved),
          closureNfaStates: sortedStates(closure),
          targetId,
          isNew,
          isAccepting,
        });

        let bySymbol = transitions.get(current);
        if (!bySymbol) {
          bySymbol = new Map();
          transitions.set(current, bySymbol);
        }
        bySymbol.set(symbol, [targetId]);
        if (!processed.has(targetId)) worklist.push(targetId);
      }
    }

    const acceptStates = new Set<number>();
    stateSets.forEach((nfaStateSet, dfaId) => {
      accountWork(budget, nfaStateSet.size);
      for (const nfaState of nfaStateSet) {
        if (nfa.acceptStates.has(nfaState)) {
          acceptStates.add(dfaId);
          break;
        }
      }
    });

    const dfa: Automaton = { stateCount: stateSets.length, startState, acceptStates, transitions };
    return { dfa, trace: { steps, subsetCount: stateSets.length } };
  } catch (error) {
    if (error instanceof SubsetConstructionBudgetExceeded) {
      throw new AutomatonTooComplexError(`Growth Lab subset construction stopped safely: ${error.message}.`);
    }
    throw error;
  }
}
