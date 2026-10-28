// tests/growth_analysis_test.cpp — issue #68 (Subset Growth / NFA
// Structure Lab, PR A). Mirrors
// engine/__tests__/unit/growth-analysis.test.ts case-for-case, so the
// two language tracks are provably testing the same scenarios.

#include <catch2/catch_test_macros.hpp>

#include "regexlab/automaton-metrics.hpp"
#include "regexlab/candidate.hpp"
#include "regexlab/equivalence.hpp"
#include "regexlab/growth-analysis.hpp"
#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"

using namespace regexlab;

namespace {
Automaton nfaFor(const std::string& pattern) {
    ParseResult parsed = parse(pattern);
    REQUIRE(parsed.ok);
    return thompsonConstruction(parsed.ast);
}
}  // namespace

TEST_CASE("subsetConstructionTraced matches subsetConstruction()'s own DFA output exactly", "[growth]") {
    Automaton nfa = nfaFor("(a|b)b");
    Automaton plain = subsetConstruction(nfa);
    TracedSubsetConstruction traced = subsetConstructionTraced(nfa);
    REQUIRE(traced.dfa == plain);
}

TEST_CASE("subsetConstructionTraced — every step is epsilonClosure(move(source, symbol))", "[growth]") {
    Automaton nfa = nfaFor("(a|b)b");
    TracedSubsetConstruction traced = subsetConstructionTraced(nfa);

    REQUIRE(traced.trace.subsetCount == traced.dfa.stateCount);
    REQUIRE(traced.trace.steps.front().sourceId == traced.dfa.startState);

    std::unordered_map<int, std::vector<int>> subsetsById;
    subsetsById[traced.trace.steps.front().sourceId] =
        traced.trace.steps.front().sourceNfaStates;
    for (const auto& step : traced.trace.steps) {
        REQUIRE(step.sourceNfaStates == subsetsById.at(step.sourceId));
        auto knownTargetSubset = subsetsById.find(step.targetId);
        if (knownTargetSubset != subsetsById.end()) {
            REQUIRE(step.closureNfaStates == knownTargetSubset->second);
        } else {
            subsetsById[step.targetId] = step.closureNfaStates;
        }

        bool shouldAccept = false;
        for (int s : step.closureNfaStates) {
            if (nfa.acceptStates.count(s)) { shouldAccept = true; break; }
        }
        REQUIRE(step.isAccepting == shouldAccept);
    }

    std::unordered_map<int, int> newCounts;
    for (const auto& step : traced.trace.steps) {
        if (step.isNew) newCounts[step.targetId]++;
    }
    for (const auto& [id, count] : newCounts) REQUIRE(count == 1);
}

TEST_CASE("bounded subset construction stops at state and work limits without returning a partial DFA", "[growth]") {
    Automaton nfa = nfaFor("a|b");

    std::optional<Automaton> workLimited =
        subsetConstructionBounded(nfa, SubsetConstructionLimits{100, 0});
    REQUIRE_FALSE(workLimited.has_value());

    std::optional<Automaton> stateLimited =
        subsetConstructionBounded(nfa, SubsetConstructionLimits{1, 1000000});
    REQUIRE_FALSE(stateLimited.has_value());
}

TEST_CASE("AutomatonMetrics — a charset edge is ONE consuming relation", "[growth]") {
    Automaton nfa = nfaFor("[a-z]");
    AutomatonMetrics metrics = computeAutomatonMetrics(nfa);
    REQUIRE(metrics.consumingEdgeCount == 1);
    REQUIRE(metrics.alphabetSize == 1);
}

TEST_CASE("AutomatonMetrics — trim excludes states that can't reach an accept state", "[growth]") {
    Automaton nfa = nfaFor("a|b");
    AutomatonMetrics metrics = computeAutomatonMetrics(nfa);
    REQUIRE(metrics.trimStateCount == metrics.reachableStateCount);
    REQUIRE(metrics.reachableStateCount == metrics.rawStateCount);
}

TEST_CASE("powerset ceiling is an exact arbitrary-precision decimal", "[growth]") {
    REQUIRE(computePowersetCeiling(10).exactDecimal == "1024");
    PowersetCeiling big = computePowersetCeiling(500);
    REQUIRE(big.exactDecimal.size() > 100);
    // Doubling is self-consistent: 2^20 computed directly must equal
    // 2^10 doubled 10 more times, digit for digit.
    REQUIRE(computePowersetCeiling(20).exactDecimal == "1048576");
}

TEST_CASE("Candidate immutability — baseline NFA is never mutated", "[growth]") {
    Automaton nfa = nfaFor("a*");
    Automaton before = nfa;

    std::vector<CandidateEdgeId> edges = listEligibleEpsilonEdges(nfa);
    REQUIRE_FALSE(edges.empty());

    CandidateEdit edit{CandidateEditKind::DeleteEpsilonEdge, edges[0]};
    Automaton candidate = applyCandidateEdit(nfa, edit);
    REQUIRE(nfa == before);

    checkEquivalence(nfa, candidate);
    REQUIRE(nfa == before);

    CandidateResult result = verifyCandidate(nfa, edit);
    REQUIRE(nfa == before);
    REQUIRE_FALSE(result.nfa == nfa);
}

TEST_CASE("'a|a' — deleting one redundant alternation-branch entry edge is SAFE (equivalent)", "[growth]") {
    Automaton nfa = nfaFor("a|a");
    std::vector<CandidateEdgeId> edges = listEligibleEpsilonEdges(nfa);

    std::vector<CandidateEdgeId> altStartOutEdges;
    for (const auto& e : edges) {
        if (e.source == nfa.startState) altStartOutEdges.push_back(e);
    }
    REQUIRE(altStartOutEdges.size() == 2);

    CandidateEdit edit{CandidateEditKind::DeleteEpsilonEdge, altStartOutEdges[0]};
    CandidateResult result = verifyCandidate(nfa, edit);
    REQUIRE(result.equivalence.status == EquivalenceStatus::Equivalent);
}

TEST_CASE("'a|a' — deleting both duplicate branch-entry edges together is UNSAFE", "[growth]") {
    Automaton nfa = nfaFor("a|a");
    std::vector<CandidateEdgeId> edges;
    for (const auto& edge : listEligibleEpsilonEdges(nfa)) {
        if (edge.source == nfa.startState) edges.push_back(edge);
    }
    REQUIRE(edges.size() == 2);

    CandidateEdit edit;
    edit.kind = CandidateEditKind::DeleteEpsilonEdges;
    edit.edges = edges;
    CandidateResult result = verifyCandidate(nfa, edit);
    REQUIRE(result.equivalence.status == EquivalenceStatus::Different);
    REQUIRE(result.equivalence.witness.word == "a");
    REQUIRE(result.equivalence.witness.baselineAccepts);
    REQUIRE_FALSE(result.equivalence.witness.candidateAccepts);
}

TEST_CASE("'a*' — deleting the star's skip edge is UNSAFE, shortest witness is the empty string", "[growth]") {
    Automaton nfa = nfaFor("a*");
    std::vector<CandidateEdgeId> edges = listEligibleEpsilonEdges(nfa);
    int acceptState = *nfa.acceptStates.begin();

    std::optional<CandidateEdgeId> skipEdge;
    for (const auto& e : edges) {
        if (e.source == nfa.startState && e.target == acceptState) { skipEdge = e; break; }
    }
    REQUIRE(skipEdge.has_value());

    CandidateEdit edit{CandidateEditKind::DeleteEpsilonEdge, *skipEdge};
    CandidateResult result = verifyCandidate(nfa, edit);
    REQUIRE(result.equivalence.status == EquivalenceStatus::Different);
    REQUIRE(result.equivalence.witness.word.empty());
    REQUIRE(result.equivalence.witness.isEmpty);
    REQUIRE(result.equivalence.witness.baselineAccepts);
    REQUIRE_FALSE(result.equivalence.witness.candidateAccepts);
}

TEST_CASE("Equivalence — determinization limit returns inconclusive before product search", "[growth]") {
    Automaton nfa = nfaFor("a|b");
    EquivalenceResult result = checkEquivalence(
        nfa, nfa, kDefaultEquivalenceBudget, SubsetConstructionLimits{1, 1000000});
    REQUIRE(result.status == EquivalenceStatus::Inconclusive);
    REQUIRE(result.reason.find("DFA-state limit") != std::string::npos);
}

TEST_CASE("Equivalence — a budget of zero returns inconclusive, never a guess", "[growth]") {
    Automaton nfa = nfaFor("a|a");
    std::vector<CandidateEdgeId> edges = listEligibleEpsilonEdges(nfa);
    CandidateEdit edit{CandidateEditKind::DeleteEpsilonEdge, edges[0]};
    CandidateResult result = verifyCandidate(nfa, edit, /*budget=*/0);
    REQUIRE(result.equivalence.status == EquivalenceStatus::Inconclusive);
}

TEST_CASE("computeGrowthAnalysis — distinct counts, bound honestly not-computed", "[growth]") {
    Automaton nfa = nfaFor("(a|b)*c");
    GrowthAnalysis analysis = computeGrowthAnalysis(nfa);

    REQUIRE(analysis.nfaMetrics.rawStateCount == nfa.stateCount);
    REQUIRE(analysis.subsetTrace.subsetCount == analysis.reachableSubsetStateCount);
    REQUIRE(analysis.minimizedStateCount <= analysis.reachableSubsetStateCount);
    REQUIRE(analysis.bound.status == BoundStatus::NotComputed);
    REQUIRE(analysis.powersetCeiling.exponent == nfa.stateCount);
}

TEST_CASE("Growth Lab trace generation enforces a row cap", "[growth][limits]") {
    const Automaton nfa = nfaFor("a");
    REQUIRE_THROWS_AS(
        subsetConstructionTraced(nfa, SubsetConstructionLimits{100, 1000}, 0),
        AutomatonTooComplexError);
}
