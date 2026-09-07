// tests/differential_test.cpp
//
// Property-based / differential testing: generate random-but-valid
// patterns directly from the engine's own AST building blocks (never
// random strings, which would mostly fail to parse and test nothing
// useful — see the design discussion this is built from), then check
// that this engine's match result agrees with std::regex on random
// test strings, for many random (pattern, input) pairs.
//
// This is Core scope (CLAUDE.md v2 §5), not a stretch goal — the
// strongest correctness signal in the project, since it checks
// thousands of combinations no one would have thought to hand-write
// as a golden test.

#include <catch2/catch_test_macros.hpp>
#include <random>
#include <regex>
#include <string>
#include <type_traits>

#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/pipeline.hpp"
#include "regexlab/types.hpp"

using namespace regexlab;

namespace {

std::mt19937& rng() {
    static std::mt19937 generator(std::random_device{}());
    return generator;
}

// Small alphabet, deliberately — increases the odds random strings
// actually share prefixes/structure with random patterns, which is
// where interesting DFA behavior (and bugs) tends to hide. A large
// alphabet would mostly generate strings that trivially fail to match
// anything.
constexpr const char* kAlphabet = "abcd";

char randomChar() {
    static const std::string alphabet(kAlphabet);
    std::uniform_int_distribution<size_t> dist(0, alphabet.size() - 1);
    return alphabet[dist(rng())];
}

/**
 * Builds a random AST directly from the engine's own grammar pieces —
 * char, concat, alt, star — so every generated pattern is guaranteed
 * parseable by construction, unlike generating random strings (which
 * would mostly be invalid and test nothing useful). maxDepth bounds
 * recursion so patterns stay a reasonable size.
 */
ASTNodePtr randomAST(int maxDepth) {
    if (maxDepth <= 0) return makeChar(randomChar());

    std::uniform_int_distribution<int> choice(0, 3);
    switch (choice(rng())) {
        case 0:
            return makeChar(randomChar());
        case 1:
            return makeConcat(randomAST(maxDepth - 1), randomAST(maxDepth - 1));
        case 2:
            return makeAlt(randomAST(maxDepth - 1), randomAST(maxDepth - 1));
        default:
            return makeStar(randomAST(maxDepth - 1));
    }
}

std::string escapeIfMeta(char c) {
    static const std::string metachars = "|*()\\";
    if (metachars.find(c) != std::string::npos) return std::string("\\") + c;
    return std::string(1, c);
}

std::string serialize(const ASTNodePtr& node);

/** Operand of concat: only an AltNode needs wrapping — concat binds
 *  tighter than alt, so "a|b" concatenated with "c" must serialize as
 *  "(a|b)c", never the bare "a|bc" (which would silently mean
 *  alt(a, concat(b,c)) instead). */
std::string serializeConcatChild(const ASTNodePtr& child) {
    if (std::holds_alternative<AltNode>(child->node)) {
        return "(" + serialize(child) + ")";
    }
    return serialize(child);
}

/** Operand of star: the grammar's atom is CHAR | '(' regex ')', so only
 *  a bare CharNode qualifies without wrapping — everything else,
 *  including another StarNode (this grammar has no "a**"), must be
 *  parenthesized to become a valid atom first. */
std::string serializeStarChild(const ASTNodePtr& child) {
    if (std::holds_alternative<CharNode>(child->node)) {
        return serialize(child);
    }
    return "(" + serialize(child) + ")";
}

std::string serialize(const ASTNodePtr& node) {
    return std::visit(
        [&](auto&& n) -> std::string {
            using T = std::decay_t<decltype(n)>;
            if constexpr (std::is_same_v<T, CharNode>) {
                return escapeIfMeta(n.value);
            } else if constexpr (std::is_same_v<T, ConcatNode>) {
                return serializeConcatChild(n.left) + serializeConcatChild(n.right);
            } else if constexpr (std::is_same_v<T, AltNode>) {
                // alt is the loosest operator — neither operand ever needs wrapping
                return serialize(n.left) + "|" + serialize(n.right);
            } else if constexpr (std::is_same_v<T, StarNode>) {
                return serializeStarChild(n.child) + "*";
            }
        },
        node->node);
}

std::string randomTestString(int maxLength) {
    std::uniform_int_distribution<int> lenDist(0, maxLength);
    int len = lenDist(rng());
    std::string s;
    s.reserve(len);
    for (int i = 0; i < len; ++i) s += randomChar();
    return s;
}

}  // namespace

TEST_CASE("Differential — random patterns agree with std::regex", "[differential]") {
    constexpr int kNumPatterns = 200;
    constexpr int kStringsPerPattern = 10;
    constexpr int kMaxDepth = 3;
    constexpr int kMaxStringLength = 6;

    int casesChecked = 0;

    for (int p = 0; p < kNumPatterns; ++p) {
        ASTNodePtr ast = randomAST(kMaxDepth);
        std::string pattern = serialize(ast);

        // The pattern we just built must be parseable by our own engine
        // — if it isn't, the serializer has a bug, which is a more
        // fundamental problem than anything the differential check
        // below is testing for.
        ParseResult reparsed = parse(pattern);
        REQUIRE(reparsed.ok);

        std::regex oracle;
        try {
            oracle = std::regex(pattern);
        } catch (const std::regex_error&) {
            // Defensive only: should be unreachable, since the serializer
            // only emits constructs both engines support. Skip rather
            // than fail here so a std::regex quirk can't mask a real
            // engine bug found elsewhere in the same run.
            continue;
        }

        for (int s = 0; s < kStringsPerPattern; ++s) {
            std::string input = randomTestString(kMaxStringLength);

            PipelineResult result = runPipeline(pattern, input);
            REQUIRE(result.ok);  // pattern already confirmed parseable above

            bool ourMatch = result.trace.result == MatchResultType::Match;
            bool oracleMatch = std::regex_match(input, oracle);

            INFO("pattern: " << pattern << "  input: \"" << input << "\"");
            REQUIRE(ourMatch == oracleMatch);

            ++casesChecked;
        }
    }

    INFO("Total (pattern, input) pairs checked: " << casesChecked);
    REQUIRE(casesChecked == kNumPatterns * kStringsPerPattern);
}
