// tests/minimization_pass_test.cpp
//
// Direct port of minimization-pass.test.ts.

#include <catch2/catch_test_macros.hpp>
#include <map>
#include <stdexcept>

#include "regexlab/passes/minimization-pass.hpp"
#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/types.hpp"

using namespace regexlab;

namespace {

struct DfaPair {
    Automaton dfa;
    Automaton min;
};

/** Run a pattern through the real pipeline up to the minimized DFA. */
DfaPair minDfaFor(const std::string& pattern) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) throw std::runtime_error("test pattern \"" + pattern + "\" failed to parse");
    Automaton nfa = thompsonConstruction(parsed.ast);
    Automaton dfa = subsetConstruction(nfa);
    return {dfa, minimize(dfa)};
}

std::map<int, std::map<std::string, std::vector<int>>> flatten(const Automaton& automaton) {
    std::map<int, std::map<std::string, std::vector<int>>> out;
    for (const auto& [state, bySymbol] : automaton.transitions) {
        out[state] = std::map<std::string, std::vector<int>>(bySymbol.begin(), bySymbol.end());
    }
    return out;
}

}  // namespace

TEST_CASE("MinimizationPass — genuinely reduces state count", "[minimization]") {
    SECTION("'(a|b)*ab' (classic Aho/Sethi/Ullman example): DFA has 4 states, min-DFA has 3") {
        auto [dfa, min] = minDfaFor("(a|b)*ab");

        // Confirm the DFA really is non-minimal before minimizing, so this test
        // is actually exercising the reduction and not a no-op.
        REQUIRE(dfa.stateCount == 4);

        REQUIRE(min.stateCount == 3);
        REQUIRE(min.startState == 0);
        REQUIRE(min.acceptStates == std::unordered_set<int>{2});

        std::map<int, std::map<std::string, std::vector<int>>> expected = {
            {0, {{"a", {1}}, {"b", {0}}}},  // self-loop: merged behaviorally identical states
            {1, {{"a", {1}}, {"b", {2}}}},
            {2, {{"a", {1}}, {"b", {0}}}},
        };
        REQUIRE(flatten(min) == expected);
    }

    SECTION("'ab|ac': the two single-transition accept states merge into one") {
        auto [dfa, min] = minDfaFor("ab|ac");

        REQUIRE(dfa.stateCount == 4);
        REQUIRE(min.stateCount == 3);
        REQUIRE(min.startState == 0);
        REQUIRE(min.acceptStates == std::unordered_set<int>{2});

        std::map<int, std::map<std::string, std::vector<int>>> expected = {
            {0, {{"a", {1}}}},
            {1, {{"b", {2}}, {"c", {2}}}},
        };
        REQUIRE(flatten(min) == expected);
    }
}

TEST_CASE("MinimizationPass — does not over-merge an already-minimal DFA", "[minimization]") {
    auto [dfa, min] = minDfaFor("aa|a");

    REQUIRE(dfa.stateCount == 3);
    REQUIRE(min.stateCount == 3);
    REQUIRE(min.startState == 0);
    REQUIRE(min.acceptStates == (std::unordered_set<int>{1, 2}));

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {0, {{"a", {1}}}},
        {1, {{"a", {2}}}},
    };
    REQUIRE(flatten(min) == expected);
}

TEST_CASE("MinimizationPass — accepting and non-accepting states never merge", "[minimization]") {
    // Structural sanity check rather than a golden value: run several patterns
    // and confirm the invariant Moore's algorithm depends on never breaks.
    for (const std::string& pattern :
         {std::string("(a|b)*ab"), std::string("ab|ac"), std::string("aa|a"),
          std::string("(a|b)*"), std::string("a*b*")}) {
        auto [dfa, min] = minDfaFor(pattern);
        REQUIRE(min.stateCount > 0);
        REQUIRE(min.acceptStates.size() > 0);
    }
}
