// tests/smoke_test.cpp
//
// This test doesn't validate any algorithm — there are no passes yet.
// Its only job is to prove the build pipeline itself works end to end:
// CMake -> FetchContent (Catch2, nlohmann/json) -> the ported §7 data
// contracts in types.hpp -> a running test binary.
//
// Once this passes, ParserPass is the next real piece of work.

#include <catch2/catch_test_macros.hpp>

#include "regexlab/types.hpp"

TEST_CASE("AST nodes construct and hold the right variant", "[smoke]") {
    using namespace regexlab;

    auto a = makeChar('a');
    REQUIRE(std::holds_alternative<CharNode>(a->node));
    REQUIRE(std::get<CharNode>(a->node).value == 'a');

    auto ab = makeConcat(makeChar('a'), makeChar('b'));
    REQUIRE(std::holds_alternative<ConcatNode>(ab->node));

    auto aOrB = makeAlt(makeChar('a'), makeChar('b'));
    REQUIRE(std::holds_alternative<AltNode>(aOrB->node));

    auto aStar = makeStar(makeChar('a'));
    REQUIRE(std::holds_alternative<StarNode>(aStar->node));
}

TEST_CASE("ParseError carries position and type", "[smoke]") {
    using namespace regexlab;

    ParseError err{ParseErrorType::UnmatchedParen, 3, std::string(")"), std::nullopt};
    REQUIRE(err.type == ParseErrorType::UnmatchedParen);
    REQUIRE(err.position == 3);
    REQUIRE(err.expected.has_value());
    REQUIRE(err.expected.value() == ")");
}

TEST_CASE("Automaton transitions are addressable by state and symbol", "[smoke]") {
    using namespace regexlab;

    Automaton nfa;
    nfa.stateCount = 2;
    nfa.startState = 0;
    nfa.acceptStates = {1};
    nfa.transitions[0]["a"] = {1};

    REQUIRE(nfa.stateCount == 2);
    REQUIRE(nfa.acceptStates.count(1) == 1);
    REQUIRE(nfa.transitions.at(0).at("a").at(0) == 1);
}

TEST_CASE("MatchTrace records steps and a result", "[smoke]") {
    using namespace regexlab;

    MatchTrace trace;
    trace.result = MatchResultType::Match;
    trace.steps.push_back(MatchStep{'a', {0, 1}});

    REQUIRE(trace.result == MatchResultType::Match);
    REQUIRE(trace.steps.size() == 1);
    REQUIRE(trace.steps[0].ch == 'a');
    REQUIRE(trace.steps[0].activeStates.size() == 2);
}
