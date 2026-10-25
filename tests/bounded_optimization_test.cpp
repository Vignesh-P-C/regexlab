#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include "regexlab/bounded-optimization.hpp"
#include "regexlab/json_bridge.hpp"
#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"

using namespace regexlab;

namespace {
Automaton nfaFor(const std::string& pattern) {
    ParseResult parsed = parse(pattern);
    REQUIRE(parsed.ok);
    return thompsonConstruction(parsed.ast);
}
}  // namespace

TEST_CASE("bounded search deterministically finds equivalent and different candidates", "[bounded-optimization]") {
    const Automaton nfa = nfaFor("a|a");
    const BoundedOptimizationResult result = searchBoundedEpsilonDeletions(
        nfa, BoundedSearchLimits{12, 2, 64, 128, 100000, 10000});

    REQUIRE(result.stopReasons.empty());
    REQUIRE(result.searchSpaceCandidateCount == 10);
    REQUIRE(result.evaluatedCandidateCount == 10);
    REQUIRE(result.equivalentCandidateCount == 6);
    REQUIRE(result.differentCandidateCount == 4);
    const std::vector<std::string> expectedFrontier{
        "delete-eps:1>5,4>0", "delete-eps:3>5,4>2"};
    REQUIRE(result.paretoFrontierIds == expectedFrontier);
    for (const auto& candidate : result.candidates) {
        if (candidate.equivalence.status == EquivalenceStatus::Equivalent) {
            REQUIRE(candidate.minimizedStateCountMatchesBaseline.has_value());
            CHECK(candidate.minimizedStateCountMatchesBaseline.value());
        } else {
            CHECK_FALSE(candidate.minimizedStateCountMatchesBaseline.has_value());
            CHECK(std::find(result.paretoFrontierIds.begin(), result.paretoFrontierIds.end(), candidate.id)
                  == result.paretoFrontierIds.end());
        }
    }

    const BoundedOptimizationResult repeated = searchBoundedEpsilonDeletions(
        nfa, BoundedSearchLimits{12, 2, 64, 128, 100000, 10000});
    REQUIRE(repeated.candidates.size() == result.candidates.size());
    for (std::size_t i = 0; i < result.candidates.size(); ++i) {
        CHECK(repeated.candidates[i].id == result.candidates[i].id);
    }
}

TEST_CASE("bounded search exposes candidate, edge, and baseline resource limits", "[bounded-optimization]") {
    const Automaton branching = nfaFor("a|b");
    const BoundedOptimizationResult candidateCapped = searchBoundedEpsilonDeletions(
        branching, BoundedSearchLimits{12, 2, 1, 128, 100000, 10000});
    CHECK(candidateCapped.evaluatedCandidateCount == 1);
    CHECK(std::find(candidateCapped.stopReasons.begin(), candidateCapped.stopReasons.end(), "candidate-limit")
          != candidateCapped.stopReasons.end());

    const BoundedOptimizationResult edgeCapped = searchBoundedEpsilonDeletions(
        branching, BoundedSearchLimits{1, 2, 24, 128, 100000, 10000});
    CHECK(edgeCapped.totalEligibleEdgeCount > edgeCapped.consideredEdgeCount);
    CHECK(std::find(edgeCapped.stopReasons.begin(), edgeCapped.stopReasons.end(), "eligible-edge-limit")
          != edgeCapped.stopReasons.end());

    const BoundedOptimizationResult baselineCapped = searchBoundedEpsilonDeletions(
        nfaFor("a"), BoundedSearchLimits{12, 2, 24, 1, 100000, 10000});
    REQUIRE(baselineCapped.stopReasons.size() == 1);
    CHECK(baselineCapped.stopReasons.front() == "baseline-inconclusive");
    CHECK(baselineCapped.evaluatedCandidateCount == 0);
    CHECK_FALSE(baselineCapped.baselineMetrics.reachableSubsetStateCount.has_value());
}

TEST_CASE("bounded optimization JSON returns the same explicit result shape", "[bounded-optimization]") {
    const nlohmann::json result = nlohmann::json::parse(runBoundedOptimizationJson("a|a", 1, 24));
    REQUIRE(result.at("ok").get<bool>());
    const auto& search = result.at("search");
    CHECK(search.at("evaluatedCandidateCount").get<int>() > 0);
    CHECK(search.at("limits").at("maxEditDepth").get<int>() == 1);
    CHECK(search.at("baselineMetrics").at("nfa").at("rawStateCount").get<int>() == 6);
    CHECK(search.at("candidates").front().at("edits").is_array());
}

TEST_CASE("product-state limits keep candidates inconclusive and off the Pareto frontier", "[bounded-optimization]") {
    const BoundedOptimizationResult result = searchBoundedEpsilonDeletions(
        nfaFor("a|a"), BoundedSearchLimits{12, 1, 24, 128, 100000, 1});
    REQUIRE(result.inconclusiveCandidateCount > 0);
    for (const auto& candidate : result.candidates) {
        if (candidate.equivalence.status == EquivalenceStatus::Inconclusive) {
            CHECK(std::find(result.paretoFrontierIds.begin(), result.paretoFrontierIds.end(), candidate.id)
                  == result.paretoFrontierIds.end());
        }
    }
}
