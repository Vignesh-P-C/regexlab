// tests/subset_construction_pass_test.cpp
//
// Direct port of subset-construction-pass.test.ts.

#include <catch2/catch_test_macros.hpp>
#include <map>
#include <stdexcept>

#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/types.hpp"

using namespace regexlab;

namespace {

/** Run a pattern through the real pipeline up to the DFA. */
Automaton dfaFor(const std::string& pattern) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) throw std::runtime_error("test pattern \"" + pattern + "\" failed to parse");
    return subsetConstruction(thompsonConstruction(parsed.ast));
}

std::map<int, std::map<std::string, std::vector<int>>> flatten(const Automaton& automaton) {
    std::map<int, std::map<std::string, std::vector<int>>> out;
    for (const auto& [state, bySymbol] : automaton.transitions) {
        out[state] = std::map<std::string, std::vector<int>>(bySymbol.begin(), bySymbol.end());
    }
    return out;
}

}  // namespace

TEST_CASE("SubsetConstructionPass — already-deterministic input", "[subset]") {
    Automaton dfa = dfaFor("a");
    REQUIRE(dfa.stateCount == 2);
    REQUIRE(dfa.startState == 0);
    REQUIRE(dfa.acceptStates == std::unordered_set<int>{1});

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {0, {{"a", {1}}}},
    };
    REQUIRE(flatten(dfa) == expected);
}

TEST_CASE("SubsetConstructionPass — folds epsilon-branching from alternation", "[subset]") {
    Automaton dfa = dfaFor("a|b");
    REQUIRE(dfa.stateCount == 3);
    REQUIRE(dfa.startState == 0);
    REQUIRE(dfa.acceptStates == (std::unordered_set<int>{1, 2}));

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {0, {{"a", {1}}, {"b", {2}}}},
    };
    REQUIRE(flatten(dfa) == expected);
}

TEST_CASE("SubsetConstructionPass — collapses a Kleene-star loop into a self-loop", "[subset]") {
    Automaton dfa = dfaFor("a*");
    REQUIRE(dfa.stateCount == 2);
    REQUIRE(dfa.startState == 0);
    REQUIRE(dfa.acceptStates == (std::unordered_set<int>{0, 1}));

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {0, {{"a", {1}}}},
        {1, {{"a", {1}}}},
    };
    REQUIRE(flatten(dfa) == expected);
}

TEST_CASE("SubsetConstructionPass — determinism sanity check", "[subset]") {
    Automaton dfa = dfaFor("(a|b)*c");

    SECTION("every DFA state has at most one destination per symbol") {
        for (const auto& [state, bySymbol] : dfa.transitions) {
            for (const auto& [symbol, destinations] : bySymbol) {
                REQUIRE(destinations.size() == 1);
            }
        }
    }

    SECTION("no DFA transition is ever labeled 'eps' — epsilons are fully folded away") {
        for (const auto& [state, bySymbol] : dfa.transitions) {
            REQUIRE(bySymbol.find("eps") == bySymbol.end());
        }
    }
}
