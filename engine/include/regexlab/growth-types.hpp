#pragma once
// regexlab/growth-types.hpp — issue #68 (Subset Growth / NFA Structure
// Lab, PR A). C++ port of engine/growth-types.ts — see that file's
// header comment for the full rationale; these are the same additive
// contracts, kept parallel field-for-field.

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "regexlab/types.hpp"

namespace regexlab {

struct SubsetConstructionStep {
    int sourceId = 0;
    std::vector<int> sourceNfaStates;  // sorted ascending
    std::string symbol;
    std::vector<int> moveNfaStates;     // sorted ascending, pre-closure
    std::vector<int> closureNfaStates;  // sorted ascending == target subset
    int targetId = 0;
    bool isNew = false;
    bool isAccepting = false;
};

struct SubsetTrace {
    std::vector<SubsetConstructionStep> steps;
    int subsetCount = 0;  // == the resulting DFA's stateCount
};

// Exact, arbitrary-precision 2^n as a base-10 string — see
// automaton-metrics.cpp's computePowersetCeiling() for why a plain int64
// is not safe here (n can be in the hundreds under the existing guards).
struct PowersetCeiling {
    int exponent = 0;
    std::string exactDecimal;
};

struct AutomatonMetrics {
    int rawStateCount = 0;
    int reachableStateCount = 0;
    int trimStateCount = 0;
    int epsilonEdgeCount = 0;
    int consumingEdgeCount = 0;
    int totalTransitionCount = 0;
    int alphabetSize = 0;
};

// See growth-types.ts's BoundResult for why PR A ships "not-computed"
// rather than attempting the subset-complexity theorem without a
// correctness-reviewed epsilon-free normalization.
enum class BoundStatus { NotComputed, Computed };

struct BoundResult {
    BoundStatus status = BoundStatus::NotComputed;
    std::string reason;          // meaningful iff status == NotComputed
    std::string representation;  // meaningful iff status == Computed
    std::string method;          // meaningful iff status == Computed
    std::string value;           // meaningful iff status == Computed
};

struct GrowthAnalysis {
    AutomatonMetrics nfaMetrics;
    SubsetTrace subsetTrace;
    int reachableSubsetStateCount = 0;
    int minimizedStateCount = 0;
    PowersetCeiling powersetCeiling;
    BoundResult bound;
};

// Stable, content-addressed edge identity — never an array index. See
// growth-types.ts's CandidateEdgeId for why.
struct CandidateEdgeId {
    int source = 0;
    // symbol is always "eps" for v1 (the only supported edit kind), kept
    // as a field (not hardcoded) so the shape matches the TS contract and
    // extends cleanly if a future PR adds other edit kinds.
    std::string symbol = "eps";
    int target = 0;
};

enum class CandidateEditKind { DeleteEpsilonEdge, DeleteEpsilonEdges };

struct CandidateEdit {
    CandidateEditKind kind = CandidateEditKind::DeleteEpsilonEdge;
    CandidateEdgeId edge;
    std::vector<CandidateEdgeId> edges;
};

struct EquivalenceWitness {
    std::string word;  // "" means the empty string — display as "ε" in the UI, not literally.
    bool isEmpty = true;
    bool baselineAccepts = false;
    bool candidateAccepts = false;
};

enum class EquivalenceStatus { Equivalent, Different, Inconclusive };

struct EquivalenceResult {
    EquivalenceStatus status = EquivalenceStatus::Inconclusive;
    std::string reason;              // meaningful iff status == Inconclusive
    EquivalenceWitness witness;      // meaningful iff status == Different
};

struct CandidateResult {
    std::vector<CandidateEdit> edits;
    Automaton nfa;
    AutomatonMetrics metrics;
    EquivalenceResult equivalence;
};


struct BoundedSearchLimits {
    std::size_t maxEligibleEdges = 12;
    std::size_t maxEditDepth = 2;
    std::size_t maxCandidates = 24;
    std::size_t maxDfaStates = 128;
    std::size_t maxWorkUnitsPerCheck = 100000;
    std::size_t maxProductStatePairs = 10000;
};

struct BoundedAutomatonMetrics {
    AutomatonMetrics nfa;
    std::optional<int> reachableSubsetStateCount;
    std::optional<int> minimizedStateCount;
    std::string subsetAnalysisReason;
    std::string minimizationReason;
};

struct BoundedOptimizationCandidate {
    std::string id;
    std::vector<CandidateEdgeId> edits;
    Automaton nfa;
    BoundedAutomatonMetrics metrics;
    EquivalenceResult equivalence;
    std::optional<bool> minimizedStateCountMatchesBaseline;
};

struct BoundedOptimizationResult {
    BoundedSearchLimits limits;
    std::size_t totalEligibleEdgeCount = 0;
    std::size_t consideredEdgeCount = 0;
    std::size_t searchSpaceCandidateCount = 0;
    std::size_t generatedCandidateCount = 0;
    std::size_t evaluatedCandidateCount = 0;
    std::size_t equivalentCandidateCount = 0;
    std::size_t differentCandidateCount = 0;
    std::size_t inconclusiveCandidateCount = 0;
    std::size_t duplicateAutomataSkipped = 0;
    std::vector<std::string> stopReasons;
    BoundedAutomatonMetrics baselineMetrics;
    std::vector<BoundedOptimizationCandidate> candidates;
    std::vector<std::string> paretoFrontierIds;
};
}  // namespace regexlab
