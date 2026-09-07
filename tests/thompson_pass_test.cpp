// tests/thompson_pass_test.cpp
//
// Direct port of thompson-pass.test.ts. Same patterns, same exact
// golden state numbers and transition shapes.

#include <catch2/catch_test_macros.hpp>
#include <map>
#include <stdexcept>

#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/types.hpp"

using namespace regexlab;

namespace {

/** Build the NFA straight from a pattern string via the real ParserPass. */
Automaton nfaFor(const std::string& pattern) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) throw std::runtime_error("test pattern \"" + pattern + "\" failed to parse");
    return thompsonConstruction(parsed.ast);
}

/** Read transitions as an ordered map of maps for easy, deterministic assertions. */
std::map<int, std::map<std::string, std::vector<int>>> flatten(const Automaton& automaton) {
    std::map<int, std::map<std::string, std::vector<int>>> out;
    for (const auto& [state, bySymbol] : automaton.transitions) {
        out[state] = std::map<std::string, std::vector<int>>(bySymbol.begin(), bySymbol.end());
    }
    return out;
}

}  // namespace

TEST_CASE("ThompsonPass — single char", "[thompson]") {
    Automaton nfa = nfaFor("a");
    REQUIRE(nfa.stateCount == 2);
    REQUIRE(nfa.startState == 0);
    REQUIRE(nfa.acceptStates == std::unordered_set<int>{1});

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {0, {{"a", {1}}}},
    };
    REQUIRE(flatten(nfa) == expected);
}

TEST_CASE("ThompsonPass — concatenation", "[thompson]") {
    Automaton nfa = nfaFor("ab");
    REQUIRE(nfa.stateCount == 4);
    REQUIRE(nfa.startState == 0);
    REQUIRE(nfa.acceptStates == std::unordered_set<int>{3});

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {0, {{"a", {1}}}},
        {1, {{"eps", {2}}}},
        {2, {{"b", {3}}}},
    };
    REQUIRE(flatten(nfa) == expected);
}

TEST_CASE("ThompsonPass — alternation", "[thompson]") {
    Automaton nfa = nfaFor("a|b");
    REQUIRE(nfa.stateCount == 6);
    REQUIRE(nfa.startState == 4);
    REQUIRE(nfa.acceptStates == std::unordered_set<int>{5});

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {4, {{"eps", {0, 2}}}},
        {0, {{"a", {1}}}},
        {1, {{"eps", {5}}}},
        {2, {{"b", {3}}}},
        {3, {{"eps", {5}}}},
    };
    REQUIRE(flatten(nfa) == expected);
}

TEST_CASE("ThompsonPass — Kleene star", "[thompson]") {
    Automaton nfa = nfaFor("a*");
    REQUIRE(nfa.stateCount == 4);
    REQUIRE(nfa.startState == 2);
    REQUIRE(nfa.acceptStates == std::unordered_set<int>{3});

    std::map<int, std::map<std::string, std::vector<int>>> expected = {
        {2, {{"eps", {0, 3}}}},
        {0, {{"a", {1}}}},
        {1, {{"eps", {0, 3}}}},
    };
    REQUIRE(flatten(nfa) == expected);
}

TEST_CASE("ThompsonPass — composition", "[thompson]") {
    Automaton nfa = nfaFor("(a|b)*");
    REQUIRE(nfa.stateCount == 8);
    REQUIRE(nfa.startState == 6);
    REQUIRE(nfa.acceptStates == std::unordered_set<int>{7});

    auto flat = flatten(nfa);
    std::map<std::string, std::vector<int>> expectedState6 = {{"eps", {4, 7}}};
    REQUIRE(flat.at(6) == expectedState6);
}
