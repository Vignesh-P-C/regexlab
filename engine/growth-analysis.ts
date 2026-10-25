/**
 * growth-analysis.ts — issue #68 (Subset Growth / NFA Structure Lab, PR A)
 *
 * Top-level entry points for the opt-in Growth/What-If feature, kept
 * deliberately separate from pipeline.ts: nothing here runs as part of
 * an ordinary compile. The frontend calls these only when the learner
 * opens the Growth panel or triggers a what-if edit (MD §7.1/§7.3).
 */

import type { Automaton } from "./types.js";
import type { CandidateEdit, CandidateResult, GrowthAnalysis } from "./growth-types.js";
import { computeAutomatonMetrics, computePowersetCeiling } from "./automaton-metrics.js";
import {
  DEFAULT_SUBSET_CONSTRUCTION_LIMITS,
  subsetConstructionTraced,
  type SubsetConstructionLimits,
} from "./passes/subset-construction-pass.js";
import { minimize } from "./passes/minimization-pass.js";
import { applyCandidateEdit } from "./candidate.js";
import { checkEquivalence, DEFAULT_EQUIVALENCE_BUDGET } from "./equivalence.js";

/**
 * Computes everything the Subset Growth panel needs from a baseline NFA:
 * the real subset-construction trace, baseline metrics, the three
 * distinct size counts (NFA / reachable subset-DFA / minimized DFA), the
 * 2^n ceiling, and the structural bound's (currently "not-computed")
 * status. Never mutates `nfa`.
 */
export function computeGrowthAnalysis(nfa: Automaton): GrowthAnalysis {
  const nfaMetrics = computeAutomatonMetrics(nfa);
  const { dfa, trace } = subsetConstructionTraced(nfa);
  const minDfa = minimize(dfa);

  return {
    nfaMetrics,
    subsetTrace: trace,
    reachableSubsetStateCount: dfa.stateCount,
    minimizedStateCount: minDfa.stateCount,
    powersetCeiling: computePowersetCeiling(nfa.stateCount),
    bound: {
      status: "not-computed",
      reason:
        "The subset-complexity upper bound (Baburin & Cotterell 2025) assumes an epsilon-free " +
        "automaton. RegexLab's Thompson NFA has epsilon edges, and no semantics-preserving " +
        "epsilon-free normalization has been designed and correctness-reviewed yet for this " +
        "representation (see issue #68). Showing a number here without that work would risk " +
        "presenting an unproven value as a guaranteed bound, which the feature's own design " +
        "rules forbid.",
    },
  };
}

/**
 * Builds one candidate from `baselineNfa` + `edit`, measures it, and
 * verifies it against the (untouched) baseline. `baselineNfa` is never
 * mutated by this call. Reusable by PR B for many candidates against the
 * same baseline — this function does nothing baseline-specific beyond
 * taking it as a plain argument.
 */
export function verifyCandidate(
  baselineNfa: Automaton,
  edit: CandidateEdit,
  budget: number = DEFAULT_EQUIVALENCE_BUDGET,
  subsetLimits: SubsetConstructionLimits = DEFAULT_SUBSET_CONSTRUCTION_LIMITS,
): CandidateResult {
  const candidateNfa = applyCandidateEdit(baselineNfa, edit);
  const metrics = computeAutomatonMetrics(candidateNfa);
  const equivalence = checkEquivalence(baselineNfa, candidateNfa, budget, subsetLimits);

  return {
    edits: [edit],
    nfa: candidateNfa,
    metrics,
    equivalence,
  };
}
