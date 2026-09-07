// tests/pipeline_test.cpp
//
// Tests the single wired-together entry point. Three things worth
// covering: it matches correctly, it propagates parse errors without
// running the rest of the chain, and — the real point of trusting this
// file — its output is provably identical to manually chaining the 5
// passes yourself.

#include <catch2/catch_test_macros.hpp>

#include "regexlab/passes/matcher-pass.hpp"
#include "regexlab/passes/minimization-pass.hpp"
#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/pipeline.hpp"

using namespace regexlab;

TEST_CASE("Pipeline — valid pattern matches correctly", "[pipeline]") {
    PipelineResult result = runPipeline("(a|b)*ab", "aab");
    REQUIRE(result.ok);
    REQUIRE(result.trace.result == MatchResultType::Match);
}

TEST_CASE("Pipeline — valid pattern correctly rejects a non-matching string", "[pipeline]") {
    PipelineResult result = runPipeline("ab", "ac");
    REQUIRE(result.ok);
    REQUIRE(result.trace.result == MatchResultType::NoMatch);
    REQUIRE(result.trace.failurePosition.has_value());
    REQUIRE(result.trace.failurePosition.value() == 1);
}

TEST_CASE("Pipeline — invalid pattern short-circuits with the ParseError", "[pipeline]") {
    PipelineResult result = runPipeline("(a", "a");
    REQUIRE_FALSE(result.ok);
    REQUIRE(result.error.type == ParseErrorType::UnmatchedParen);
    REQUIRE(result.error.position == 0);
}

TEST_CASE("Pipeline — output is identical to manually chaining all 5 passes", "[pipeline]") {
    // This is the real point of this test file: prove runPipeline() isn't
    // doing anything different from what you'd get calling each pass
    // yourself, for a spread of patterns and inputs.
    struct Case { std::string pattern; std::string input; };
    std::vector<Case> cases = {
        {"a", "a"}, {"a", "b"}, {"(a|b)*ab", "bbab"}, {"(a|b)*ab", "ba"},
        {"ab|ac", "ac"}, {"a*", ""}, {"a*", "aaaa"}, {"aa|a", "aa"},
    };

    for (const auto& c : cases) {
        PipelineResult viaPipeline = runPipeline(c.pattern, c.input);

        ParseResult parsed = parse(c.pattern);
        REQUIRE(parsed.ok);  // every pattern in this table is valid by construction
        Automaton nfa = thompsonConstruction(parsed.ast);
        Automaton dfa = subsetConstruction(nfa);
        Automaton minDfa = minimize(dfa);
        MatchTrace viaManualChain = match(minDfa, c.input);

        REQUIRE(viaPipeline.ok);
        REQUIRE(viaPipeline.trace == viaManualChain);
    }
}
