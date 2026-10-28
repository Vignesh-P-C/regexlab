// Bounded verified epsilon-deletion search. Every candidate is checked
// through issue #68's verifyCandidate/checkEquivalence implementation.

#include "regexlab/bounded-optimization.hpp"

#include <algorithm>
#include <functional>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#include "regexlab/automaton-metrics.hpp"
#include "regexlab/candidate.hpp"
#include "regexlab/growth-analysis.hpp"
#include "regexlab/passes/minimization-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"

namespace regexlab {
namespace {

BoundedSearchLimits normalizeLimits(BoundedSearchLimits limits) {
    limits.maxEligibleEdges = std::clamp<std::size_t>(limits.maxEligibleEdges, 1, 12);
    limits.maxEditDepth = std::clamp<std::size_t>(limits.maxEditDepth, 1, 3);
    limits.maxCandidates = std::clamp<std::size_t>(limits.maxCandidates, 1, 64);
    limits.maxDfaStates = std::clamp<std::size_t>(limits.maxDfaStates, 1, 256);
    limits.maxWorkUnitsPerCheck = std::clamp<std::size_t>(limits.maxWorkUnitsPerCheck, 1, 200000);
    limits.maxProductStatePairs = std::clamp<std::size_t>(limits.maxProductStatePairs, 1, 20000);
    return limits;
}

std::size_t binomial(std::size_t n, std::size_t k) {
    std::size_t result = 1;
    for (std::size_t i = 1; i <= k; ++i) result = result * (n - k + i) / i;
    return result;
}

std::size_t searchSpaceSize(std::size_t edgeCount, std::size_t editDepth) {
    std::size_t count = 0;
    const std::size_t depthLimit = std::min(edgeCount, editDepth);
    for (std::size_t depth = 1; depth <= depthLimit; ++depth) count += binomial(edgeCount, depth);
    return count;
}

BoundedAutomatonMetrics measureBoundedAutomaton(const Automaton& automaton, const BoundedSearchLimits& limits) {
    BoundedAutomatonMetrics metrics;
    metrics.nfa = computeAutomatonMetrics(automaton);

    const auto dfa = subsetConstructionBounded(
        automaton, SubsetConstructionLimits{limits.maxDfaStates, limits.maxWorkUnitsPerCheck});
    if (!dfa) {
        metrics.subsetAnalysisReason = "Determinization reached its configured state or work limit.";
        return metrics;
    }

    metrics.reachableSubsetStateCount = dfa->stateCount;
    try {
        metrics.minimizedStateCount = minimize(*dfa).stateCount;
    } catch (const AutomatonTooComplexError& error) {
        metrics.minimizationReason = error.what();
    }
    return metrics;
}

std::string automatonFingerprint(const Automaton& automaton) {
    std::string result = std::to_string(automaton.stateCount) + ";" + std::to_string(automaton.startState) + ";";
    std::vector<int> accepts(automaton.acceptStates.begin(), automaton.acceptStates.end());
    std::sort(accepts.begin(), accepts.end());
    for (int state : accepts) result += "A" + std::to_string(state) + ";";

    std::vector<int> sources;
    for (const auto& [source, bySymbol] : automaton.transitions) sources.push_back(source);
    std::sort(sources.begin(), sources.end());
    for (int source : sources) {
        result += "S" + std::to_string(source) + ";";
        const auto& bySymbol = automaton.transitions.at(source);
        std::vector<std::string> symbols;
        for (const auto& [symbol, targets] : bySymbol) symbols.push_back(symbol);
        std::sort(symbols.begin(), symbols.end());
        for (const std::string& symbol : symbols) {
            const auto& targets = bySymbol.at(symbol);
            std::vector<int> sortedTargets = targets;
            std::sort(sortedTargets.begin(), sortedTargets.end());
            result += "L" + std::to_string(symbol.size()) + ":" + symbol + ";";
            for (int target : sortedTargets) result += "T" + std::to_string(target) + ";";
        }
    }
    return result;
}

std::string candidateId(const std::vector<CandidateEdgeId>& edges) {
    std::string id = "delete-eps:";
    for (std::size_t i = 0; i < edges.size(); ++i) {
        if (i > 0) id += ",";
        id += std::to_string(edges[i].source) + ">" + std::to_string(edges[i].target);
    }
    return id;
}

bool dominates(const BoundedAutomatonMetrics& a, const BoundedAutomatonMetrics& b) {
    if (!a.reachableSubsetStateCount || !b.reachableSubsetStateCount) return false;
    const int aValues[] = {
        a.nfa.epsilonEdgeCount, a.nfa.totalTransitionCount, *a.reachableSubsetStateCount};
    const int bValues[] = {
        b.nfa.epsilonEdgeCount, b.nfa.totalTransitionCount, *b.reachableSubsetStateCount};
    bool strictlyBetter = false;
    for (int i = 0; i < 3; ++i) {
        if (aValues[i] > bValues[i]) return false;
        if (aValues[i] < bValues[i]) strictlyBetter = true;
    }
    return strictlyBetter;
}

std::vector<std::string> computeParetoFrontier(
    const BoundedAutomatonMetrics& baseline,
    const std::vector<BoundedOptimizationCandidate>& candidates) {
    std::vector<std::pair<std::string, const BoundedAutomatonMetrics*>> points;
    if (baseline.reachableSubsetStateCount) points.emplace_back("baseline", &baseline);
    for (const auto& candidate : candidates) {
        if (candidate.equivalence.status == EquivalenceStatus::Equivalent &&
            candidate.metrics.reachableSubsetStateCount) {
            points.emplace_back(candidate.id, &candidate.metrics);
        }
    }

    std::vector<std::string> frontier;
    for (std::size_t i = 0; i < points.size(); ++i) {
        bool isDominated = false;
        for (std::size_t j = 0; j < points.size(); ++j) {
            if (i != j && dominates(*points[j].second, *points[i].second)) {
                isDominated = true;
                break;
            }
        }
        if (!isDominated) frontier.push_back(points[i].first);
    }
    return frontier;
}

}  // namespace

BoundedOptimizationResult searchBoundedEpsilonDeletions(
    const Automaton& baselineNfa, BoundedSearchLimits requestedLimits) {
    BoundedOptimizationResult result;
    result.limits = normalizeLimits(requestedLimits);

    const std::vector<CandidateEdgeId> allEdges = listEligibleEpsilonEdges(baselineNfa);
    const std::size_t consideredCount = std::min(allEdges.size(), result.limits.maxEligibleEdges);
    const std::vector<CandidateEdgeId> consideredEdges(allEdges.begin(), allEdges.begin() + consideredCount);
    result.totalEligibleEdgeCount = allEdges.size();
    result.consideredEdgeCount = consideredEdges.size();
    result.searchSpaceCandidateCount = searchSpaceSize(consideredEdges.size(), result.limits.maxEditDepth);
    result.baselineMetrics = measureBoundedAutomaton(baselineNfa, result.limits);

    bool candidateLimitReached = false;
    if (result.baselineMetrics.reachableSubsetStateCount) {
        std::unordered_set<std::string> seenAutomata{automatonFingerprint(baselineNfa)};
        const std::size_t depthLimit = std::min(consideredEdges.size(), result.limits.maxEditDepth);
        bool stop = false;

        for (std::size_t depth = 1; depth <= depthLimit && !stop; ++depth) {
            std::vector<CandidateEdgeId> chosen;
            std::function<void(std::size_t)> enumerate = [&](std::size_t start) {
                if (stop) return;
                if (chosen.size() == depth) {
                    const std::vector<CandidateEdgeId> edits = chosen;
                    CandidateEdit edit;
                    edit.kind = CandidateEditKind::DeleteEpsilonEdges;
                    edit.edges = edits;
                    Automaton candidateNfa = applyCandidateEdit(baselineNfa, edit);
                    ++result.generatedCandidateCount;

                    const std::string fingerprint = automatonFingerprint(candidateNfa);
                    if (seenAutomata.count(fingerprint)) {
                        ++result.duplicateAutomataSkipped;
                        return;
                    }
                    if (result.evaluatedCandidateCount >= result.limits.maxCandidates) {
                        candidateLimitReached = true;
                        stop = true;
                        return;
                    }

                    seenAutomata.insert(fingerprint);
                    ++result.evaluatedCandidateCount;
                    const CandidateResult verified = verifyCandidate(
                        baselineNfa,
                        edit,
                        static_cast<int>(result.limits.maxProductStatePairs),
                        SubsetConstructionLimits{result.limits.maxDfaStates, result.limits.maxWorkUnitsPerCheck});
                    const BoundedAutomatonMetrics metrics = measureBoundedAutomaton(candidateNfa, result.limits);

                    if (verified.equivalence.status == EquivalenceStatus::Equivalent) ++result.equivalentCandidateCount;
                    else if (verified.equivalence.status == EquivalenceStatus::Different) ++result.differentCandidateCount;
                    else ++result.inconclusiveCandidateCount;

                    BoundedOptimizationCandidate candidate;
                    candidate.id = candidateId(edits);
                    candidate.edits = edits;
                    candidate.nfa = std::move(candidateNfa);
                    candidate.metrics = metrics;
                    candidate.equivalence = verified.equivalence;
                    if (verified.equivalence.status == EquivalenceStatus::Equivalent &&
                        metrics.minimizedStateCount && result.baselineMetrics.minimizedStateCount) {
                        candidate.minimizedStateCountMatchesBaseline =
                            *metrics.minimizedStateCount == *result.baselineMetrics.minimizedStateCount;
                    }
                    result.candidates.push_back(std::move(candidate));
                    return;
                }

                const std::size_t remaining = depth - chosen.size();
                for (std::size_t index = start;
                     index <= consideredEdges.size() - remaining && !stop;
                     ++index) {
                    chosen.push_back(consideredEdges[index]);
                    enumerate(index + 1);
                    chosen.pop_back();
                }
            };
            enumerate(0);
        }
    }

    if (!result.baselineMetrics.reachableSubsetStateCount) {
        result.stopReasons.push_back("baseline-inconclusive");
    } else {
        if (allEdges.size() > consideredEdges.size()) result.stopReasons.push_back("eligible-edge-limit");
        if (candidateLimitReached) result.stopReasons.push_back("candidate-limit");
    }
    result.paretoFrontierIds = computeParetoFrontier(result.baselineMetrics, result.candidates);
    return result;
}

}  // namespace regexlab
