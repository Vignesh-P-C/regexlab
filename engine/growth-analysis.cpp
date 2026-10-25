// engine/growth-analysis.cpp — issue #68. C++ port of
// engine/growth-analysis.ts.

#include "regexlab/growth-analysis.hpp"

#include "regexlab/automaton-metrics.hpp"
#include "regexlab/candidate.hpp"
#include "regexlab/passes/minimization-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"

namespace regexlab {

GrowthAnalysis computeGrowthAnalysis(const Automaton& nfa) {
    GrowthAnalysis result;
    result.nfaMetrics = computeAutomatonMetrics(nfa);

    TracedSubsetConstruction traced = subsetConstructionTraced(nfa);
    result.subsetTrace = traced.trace;
    result.reachableSubsetStateCount = traced.dfa.stateCount;

    Automaton minDfa = minimize(traced.dfa);
    result.minimizedStateCount = minDfa.stateCount;

    result.powersetCeiling = computePowersetCeiling(nfa.stateCount);

    result.bound.status = BoundStatus::NotComputed;
    result.bound.reason =
        "The subset-complexity upper bound (Baburin & Cotterell 2025) assumes an epsilon-free "
        "automaton. RegexLab's Thompson NFA has epsilon edges, and no semantics-preserving "
        "epsilon-free normalization has been designed and correctness-reviewed yet for this "
        "representation (see issue #68). Showing a number here without that work would risk "
        "presenting an unproven value as a guaranteed bound, which the feature's own design "
        "rules forbid.";

    return result;
}

CandidateResult verifyCandidate(
    const Automaton& baselineNfa, const CandidateEdit& edit, int budget,
    SubsetConstructionLimits subsetLimits) {
    Automaton candidateNfa = applyCandidateEdit(baselineNfa, edit);

    CandidateResult result;
    result.edits = {edit};
    result.nfa = candidateNfa;
    result.metrics = computeAutomatonMetrics(candidateNfa);
    result.equivalence = checkEquivalence(baselineNfa, candidateNfa, budget, subsetLimits);
    return result;
}

}  // namespace regexlab
