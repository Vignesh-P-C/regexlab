/**
 * bounded-optimization.ts - issue B, the bounded verified optimization explorer.
 *
 * Searches a deterministic, capped neighborhood of epsilon-edge deletions.
 * Each candidate is built from a fresh copy and passed through A's exact
 * verifyCandidate/checkEquivalence path. This is not global NFA minimization.
 */

import type { Automaton } from "./types.js";
import {
  type BoundedAutomatonMetrics,
  type BoundedOptimizationCandidate,
  type BoundedOptimizationResult,
  type BoundedSearchLimits,
  type CandidateEdgeId,
} from "./growth-types.js";
import { computeAutomatonMetrics } from "./automaton-metrics.js";
import { applyCandidateEdit, listEligibleEpsilonEdges } from "./candidate.js";
import { verifyCandidate } from "./growth-analysis.js";
import { minimize } from "./passes/minimization-pass.js";
import { subsetConstructionBounded } from "./passes/subset-construction-pass.js";

export const DEFAULT_BOUNDED_SEARCH_LIMITS: Readonly<BoundedSearchLimits> = Object.freeze({
  maxEligibleEdges: 12,
  maxEditDepth: 2,
  maxCandidates: 24,
  maxDfaStates: 128,
  maxWorkUnitsPerCheck: 100_000,
  maxProductStatePairs: 10_000,
});

const HARD_LIMITS: BoundedSearchLimits = {
  maxEligibleEdges: 12,
  maxEditDepth: 3,
  maxCandidates: 64,
  maxDfaStates: 256,
  maxWorkUnitsPerCheck: 200_000,
  maxProductStatePairs: 20_000,
};

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
}

function normalizeLimits(requested: Partial<BoundedSearchLimits>): BoundedSearchLimits {
  return {
    maxEligibleEdges: boundedInteger(requested.maxEligibleEdges, DEFAULT_BOUNDED_SEARCH_LIMITS.maxEligibleEdges, HARD_LIMITS.maxEligibleEdges),
    maxEditDepth: boundedInteger(requested.maxEditDepth, DEFAULT_BOUNDED_SEARCH_LIMITS.maxEditDepth, HARD_LIMITS.maxEditDepth),
    maxCandidates: boundedInteger(requested.maxCandidates, DEFAULT_BOUNDED_SEARCH_LIMITS.maxCandidates, HARD_LIMITS.maxCandidates),
    maxDfaStates: boundedInteger(requested.maxDfaStates, DEFAULT_BOUNDED_SEARCH_LIMITS.maxDfaStates, HARD_LIMITS.maxDfaStates),
    maxWorkUnitsPerCheck: boundedInteger(requested.maxWorkUnitsPerCheck, DEFAULT_BOUNDED_SEARCH_LIMITS.maxWorkUnitsPerCheck, HARD_LIMITS.maxWorkUnitsPerCheck),
    maxProductStatePairs: boundedInteger(requested.maxProductStatePairs, DEFAULT_BOUNDED_SEARCH_LIMITS.maxProductStatePairs, HARD_LIMITS.maxProductStatePairs),
  };
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

function boundedSpaceSize(edgeCount: number, editDepth: number): number {
  let count = 0;
  for (let depth = 1; depth <= Math.min(edgeCount, editDepth); depth++) {
    count += binomial(edgeCount, depth);
  }
  return count;
}

function fingerprint(automaton: Automaton): string {
  const accepts = [...automaton.acceptStates].sort((a, b) => a - b);
  const transitions = [...automaton.transitions.entries()]
    .sort(([a], [b]) => a - b)
    .map(([state, bySymbol]) => [
      state,
      [...bySymbol.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([symbol, targets]) => [symbol, [...targets].sort((a, b) => a - b)]),
    ]);
  return JSON.stringify([automaton.stateCount, automaton.startState, accepts, transitions]);
}

function measureBoundedAutomaton(automaton: Automaton, limits: BoundedSearchLimits): BoundedAutomatonMetrics {
  const nfa = computeAutomatonMetrics(automaton);
  const determinized = subsetConstructionBounded(automaton, {
    maxDfaStates: limits.maxDfaStates,
    maxWorkUnits: limits.maxWorkUnitsPerCheck,
  });
  if (!determinized.ok) {
    return {
      nfa,
      reachableSubsetStateCount: null,
      minimizedStateCount: null,
      subsetAnalysisReason: determinized.reason,
      minimizationReason: null,
    };
  }

  try {
    return {
      nfa,
      reachableSubsetStateCount: determinized.dfa.stateCount,
      minimizedStateCount: minimize(determinized.dfa).stateCount,
      subsetAnalysisReason: null,
      minimizationReason: null,
    };
  } catch (error) {
    return {
      nfa,
      reachableSubsetStateCount: determinized.dfa.stateCount,
      minimizedStateCount: null,
      subsetAnalysisReason: null,
      minimizationReason: error instanceof Error ? error.message : "Minimization reached its safety limit.",
    };
  }
}

function candidateId(edges: readonly CandidateEdgeId[]): string {
  return "delete-eps:" + edges.map((edge) => String(edge.source) + ">" + String(edge.target)).join(",");
}

type ParetoPoint = { id: string; metrics: BoundedAutomatonMetrics };

function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  const aSubsetCount = a.metrics.reachableSubsetStateCount;
  const bSubsetCount = b.metrics.reachableSubsetStateCount;
  if (aSubsetCount === null || bSubsetCount === null) return false;

  const aValues = [a.metrics.nfa.epsilonEdgeCount, a.metrics.nfa.totalTransitionCount, aSubsetCount];
  const bValues = [b.metrics.nfa.epsilonEdgeCount, b.metrics.nfa.totalTransitionCount, bSubsetCount];
  return aValues.every((value, index) => value <= bValues[index]) &&
    aValues.some((value, index) => value < bValues[index]);
}

function paretoFrontier(
  baseline: BoundedAutomatonMetrics,
  candidates: readonly BoundedOptimizationCandidate[],
): string[] {
  const points: ParetoPoint[] = [];
  if (baseline.reachableSubsetStateCount !== null) points.push({ id: "baseline", metrics: baseline });
  for (const candidate of candidates) {
    if (candidate.equivalence.status === "equivalent" && candidate.metrics.reachableSubsetStateCount !== null) {
      points.push({ id: candidate.id, metrics: candidate.metrics });
    }
  }
  return points
    .filter((point, index) => !points.some((other, otherIndex) => otherIndex !== index && dominates(other, point)))
    .map((point) => point.id);
}

/**
 * Searches epsilon-edge deletion sets in ascending edit depth and stable
 * lexicographic edge order. Work per candidate and number of candidates are
 * capped, so the total search has a finite, visible upper bound.
 */
export function searchBoundedEpsilonDeletions(
  baselineNfa: Automaton,
  requestedLimits: Partial<BoundedSearchLimits> = {},
): BoundedOptimizationResult {
  const limits = normalizeLimits(requestedLimits);
  const allEdges = listEligibleEpsilonEdges(baselineNfa);
  const consideredEdges = allEdges.slice(0, limits.maxEligibleEdges);
  const searchSpaceCandidateCount = boundedSpaceSize(consideredEdges.length, limits.maxEditDepth);
  const baselineMetrics = measureBoundedAutomaton(baselineNfa, limits);
  const candidates: BoundedOptimizationCandidate[] = [];
  let generatedCandidateCount = 0;
  let evaluatedCandidateCount = 0;
  let equivalentCandidateCount = 0;
  let differentCandidateCount = 0;
  let inconclusiveCandidateCount = 0;
  let duplicateAutomataSkipped = 0;
  let candidateLimitReached = false;

  if (baselineMetrics.reachableSubsetStateCount !== null) {
    const seenAutomata = new Set<string>([fingerprint(baselineNfa)]);
    const subsetLimits = {
      maxDfaStates: limits.maxDfaStates,
      maxWorkUnits: limits.maxWorkUnitsPerCheck,
    };
    let stop = false;

    for (let depth = 1; depth <= Math.min(consideredEdges.length, limits.maxEditDepth) && !stop; depth++) {
      const chosen: CandidateEdgeId[] = [];
      const enumerate = (start: number): void => {
        if (stop) return;
        if (chosen.length === depth) {
          const edits = [...chosen];
          const candidateNfa = applyCandidateEdit(baselineNfa, { kind: "deleteEpsilonEdges", edges: edits });
          generatedCandidateCount++;
          const key = fingerprint(candidateNfa);
          if (seenAutomata.has(key)) {
            duplicateAutomataSkipped++;
            return;
          }
          if (evaluatedCandidateCount >= limits.maxCandidates) {
            candidateLimitReached = true;
            stop = true;
            return;
          }

          seenAutomata.add(key);
          evaluatedCandidateCount++;
          const verified = verifyCandidate(
            baselineNfa,
            { kind: "deleteEpsilonEdges", edges: edits },
            limits.maxProductStatePairs,
            subsetLimits,
          );
          const metrics = measureBoundedAutomaton(candidateNfa, limits);
          if (verified.equivalence.status === "equivalent") equivalentCandidateCount++;
          else if (verified.equivalence.status === "different") differentCandidateCount++;
          else inconclusiveCandidateCount++;

          candidates.push({
            id: candidateId(edits),
            edits,
            nfa: candidateNfa,
            metrics,
            equivalence: verified.equivalence,
            minimizedStateCountMatchesBaseline:
              verified.equivalence.status !== "equivalent" ||
              metrics.minimizedStateCount === null ||
              baselineMetrics.minimizedStateCount === null
                ? null
                : metrics.minimizedStateCount === baselineMetrics.minimizedStateCount,
          });
          return;
        }

        const remaining = depth - chosen.length;
        for (let index = start; index <= consideredEdges.length - remaining && !stop; index++) {
          chosen.push(consideredEdges[index]);
          enumerate(index + 1);
          chosen.pop();
        }
      };
      enumerate(0);
    }
  }

  const stopReasons: BoundedOptimizationResult["stopReasons"] = [];
  if (baselineMetrics.reachableSubsetStateCount === null) stopReasons.push("baseline-inconclusive");
  else {
    if (allEdges.length > consideredEdges.length) stopReasons.push("eligible-edge-limit");
    if (candidateLimitReached) stopReasons.push("candidate-limit");
  }

  return {
    limits,
    totalEligibleEdgeCount: allEdges.length,
    consideredEdgeCount: consideredEdges.length,
    searchSpaceCandidateCount,
    generatedCandidateCount,
    evaluatedCandidateCount,
    equivalentCandidateCount,
    differentCandidateCount,
    inconclusiveCandidateCount,
    duplicateAutomataSkipped,
    stopReasons,
    baselineMetrics,
    candidates,
    paretoFrontierIds: paretoFrontier(baselineMetrics, candidates),
  };
}
