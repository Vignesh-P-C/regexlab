// tests/matcher_pass_test.cpp
//
// Direct port of matcher-pass.test.ts.

#include <catch2/catch_test_macros.hpp>
#include <stdexcept>

#include "regexlab/passes/matcher-pass.hpp"
#include "regexlab/passes/minimization-pass.hpp"
#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/types.hpp"

using namespace regexlab;

namespace {

/** Run a pattern through the entire real pipeline down to a minimized DFA. */
Automaton pipelineFor(const std::string& pattern) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) throw std::runtime_error("test pattern \"" + pattern + "\" failed to parse");
    return minimize(subsetConstruction(thompsonConstruction(parsed.ast)));
}

}  // namespace

TEST_CASE("MatcherPass — 'ab' (exact literal match)", "[matcher]") {
    Automaton dfa = pipelineFor("ab");

    SECTION("matches the exact string, with one step per character") {
        MatchTrace trace = match(dfa, "ab");
        REQUIRE(trace.result == MatchResultType::Match);
        REQUIRE(trace.steps.size() == 2);
        REQUIRE(trace.steps[0].ch == 'a');
        REQUIRE(trace.steps[0].activeStates == std::vector<int>{1});
        REQUIRE(trace.steps[1].ch == 'b');
        REQUIRE(trace.steps[1].activeStates == std::vector<int>{2});
        REQUIRE_FALSE(trace.failurePosition.has_value());
    }

    SECTION("hits a dead end mid-string and stops immediately (no backtracking)") {
        MatchTrace trace = match(dfa, "ac");
        REQUIRE(trace.result == MatchResultType::NoMatch);
        REQUIRE(trace.failurePosition.has_value());
        REQUIRE(trace.failurePosition.value() == 1);  // 'c' has nowhere to go from state 1
        REQUIRE(trace.steps.size() == 1);              // stopped before consuming 'c'
    }

    SECTION("runs out of input in a non-accepting state — no-match, but not a dead end") {
        MatchTrace trace = match(dfa, "a");
        REQUIRE(trace.result == MatchResultType::NoMatch);
        REQUIRE_FALSE(trace.failurePosition.has_value());  // every character it saw had somewhere to go
        REQUIRE(trace.steps.size() == 1);
    }
}

TEST_CASE("MatcherPass — 'a*' (minimizes to a single self-looping state)", "[matcher]") {
    Automaton dfa = pipelineFor("a*");

    SECTION("matches the empty string with zero steps (start state is itself accepting)") {
        MatchTrace trace = match(dfa, "");
        REQUIRE(trace.result == MatchResultType::Match);
        REQUIRE(trace.steps.empty());
    }

    SECTION("matches an arbitrarily long run of 'a', looping on the same state") {
        MatchTrace trace = match(dfa, "aaaa");
        REQUIRE(trace.result == MatchResultType::Match);
        REQUIRE(trace.steps.size() == 4);
        for (const auto& step : trace.steps) {
            REQUIRE(step.ch == 'a');
            REQUIRE(step.activeStates == std::vector<int>{0});
        }
    }

    SECTION("dead-ends immediately on any character outside the alphabet") {
        MatchTrace trace = match(dfa, "b");
        REQUIRE(trace.result == MatchResultType::NoMatch);
        REQUIRE(trace.failurePosition.has_value());
        REQUIRE(trace.failurePosition.value() == 0);
        REQUIRE(trace.steps.empty());
    }
}

TEST_CASE("MatcherPass — '(a|b)*ab' (strings ending in 'ab')", "[matcher]") {
    Automaton dfa = pipelineFor("(a|b)*ab");

    SECTION("matches strings that end in 'ab'") {
        REQUIRE(match(dfa, "ab").result == MatchResultType::Match);
        REQUIRE(match(dfa, "aab").result == MatchResultType::Match);
        REQUIRE(match(dfa, "bbab").result == MatchResultType::Match);
    }

    SECTION("rejects strings that don't end in 'ab', with a full step trace (no dead end)") {
        MatchTrace trace = match(dfa, "ba");
        REQUIRE(trace.result == MatchResultType::NoMatch);
        REQUIRE_FALSE(trace.failurePosition.has_value());
        REQUIRE(trace.steps.size() == 2);  // both characters were consumed, it just landed wrong
    }
}
