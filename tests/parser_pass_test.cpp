// tests/parser_pass_test.cpp
//
// Direct port of parser-pass.test.ts. Same patterns, same golden AST/error
// shapes — TS's `toEqual` is replaced here by the operator== defined in
// types.hpp specifically for this purpose.

#include <catch2/catch_test_macros.hpp>

#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/types.hpp"

using namespace regexlab;

namespace {

ParseResult ok(ASTNodePtr ast) {
    return ParseResult{true, ast, ParseError{}};
}
ParseResult err(ParseErrorType type, int position, std::optional<std::string> expected,
                std::optional<std::string> found) {
    return ParseResult{false, nullptr, ParseError{type, position, expected, found}};
}

}  // namespace

TEST_CASE("ParserPass — valid patterns (golden AST shapes)", "[parser]") {
    SECTION("single char") {
        REQUIRE(parse("a") == ok(makeChar('a')));
    }

    SECTION("concatenation is left-associative") {
        REQUIRE(parse("abc") ==
                ok(makeConcat(makeConcat(makeChar('a'), makeChar('b')), makeChar('c'))));
    }

    SECTION("alternation is left-associative") {
        REQUIRE(parse("a|b|c") ==
                ok(makeAlt(makeAlt(makeChar('a'), makeChar('b')), makeChar('c'))));
    }

    SECTION("star binds tighter than concatenation") {
        // "ab*" means a, then (b)* — NOT (ab)*
        REQUIRE(parse("ab*") == ok(makeConcat(makeChar('a'), makeStar(makeChar('b')))));
    }

    SECTION("concatenation binds tighter than alternation") {
        // "ab|c" means (ab)|c — NOT a(b|c)
        REQUIRE(parse("ab|c") == ok(makeAlt(makeConcat(makeChar('a'), makeChar('b')), makeChar('c'))));
    }

    SECTION("parentheses override precedence") {
        REQUIRE(parse("(a|b)*") == ok(makeStar(makeAlt(makeChar('a'), makeChar('b')))));
    }

    SECTION("nested groups") {
        REQUIRE(parse("((a))") == ok(makeChar('a')));
    }

    SECTION("backslash-escapes a metacharacter into a literal char") {
        REQUIRE(parse("\\(") == ok(makeChar('(')));
    }
}

TEST_CASE("ParserPass — malformed patterns (golden ParseError shapes)", "[parser]") {
    SECTION("empty pattern") {
        REQUIRE(parse("") == err(ParseErrorType::UnexpectedToken, 0,
                                  std::string("a character or '('"), std::string("end of input")));
    }

    SECTION("unmatched opening paren") {
        REQUIRE(parse("(a") == err(ParseErrorType::UnmatchedParen, 0, std::string("')'"),
                                    std::string("end of input")));
    }

    SECTION("unmatched closing paren") {
        REQUIRE(parse("a)") == err(ParseErrorType::UnmatchedParen, 1, std::string("end of input"),
                                    std::string(")")));
    }

    SECTION("empty group") {
        REQUIRE(parse("()") == err(ParseErrorType::EmptyGroup, 1, std::string("a pattern before ')'"),
                                    std::string(")")));
    }

    SECTION("leading star has nothing to repeat") {
        REQUIRE(parse("*a") == err(ParseErrorType::DanglingOperator, 0,
                                    std::string("a character or '('"), std::string("*")));
    }

    SECTION("double alternation operator") {
        REQUIRE(parse("a||b") == err(ParseErrorType::DanglingOperator, 2,
                                      std::string("a character or '('"), std::string("|")));
    }

    SECTION("trailing backslash with nothing to escape") {
        REQUIRE(parse("a\\") == err(ParseErrorType::UnexpectedToken, 1,
                                     std::string("a character after '\\'"), std::string("end of input")));
    }
}

TEST_CASE("ParserPass — nesting depth guard", "[parser]") {
    // The 500-char length cap would trip first on these long patterns, so
    // lift it: these tests target the depth guard specifically.
    ParseLimits liftedLength;
    liftedLength.maxPatternLength = 1000000;

    auto nested = [](int depth) {
        std::string pattern(static_cast<size_t>(depth), '(');
        pattern += "a";
        pattern += std::string(static_cast<size_t>(depth), ')');
        return pattern;
    };

    SECTION("nesting well under the limit still parses normally") {
        REQUIRE(parse(nested(500), liftedLength).ok);
    }

    SECTION("nesting exactly at the limit parses") {
        REQUIRE(parse(nested(1000), liftedLength).ok);
    }

    SECTION("one level past the limit is rejected by the depth guard") {
        ParseResult result = parse(nested(1001), liftedLength);
        REQUIRE_FALSE(result.ok);
        REQUIRE(result.error.type == ParseErrorType::PatternTooComplex);
        REQUIRE(result.error.position == 1000);
        REQUIRE(result.error.expected == std::string("nesting depth <= 1000"));
    }

    SECTION("far past the limit fails gracefully instead of crashing") {
        ParseResult result = parse(nested(1500), liftedLength);
        REQUIRE_FALSE(result.ok);
        REQUIRE(result.error.type == ParseErrorType::PatternTooComplex);
    }
}

TEST_CASE("ParserPass — pattern length guard", "[parser]") {
    SECTION("a pattern exactly at the cap parses") {
        REQUIRE(parse(std::string(500, 'a')).ok);
    }

    SECTION("one character past the cap is rejected with a length error") {
        REQUIRE(parse(std::string(501, 'a')) ==
                err(ParseErrorType::PatternTooComplex, 500,
                    std::string("pattern length <= 500"), std::string("longer pattern")));
    }

    SECTION("applies to every shape, not just plain literals") {
        std::string alternation;  // a|a|a|... (501 chars)
        for (int i = 0; i < 251; ++i) alternation += (i ? "|a" : "a");
        REQUIRE(alternation.size() == 501);
        REQUIRE(parse(alternation).error.type == ParseErrorType::PatternTooComplex);

        std::string stars;  // a*a*a*... (502 chars)
        for (int i = 0; i < 251; ++i) stars += "a*";
        REQUIRE(stars.size() == 502);
        REQUIRE(parse(stars).error.type == ParseErrorType::PatternTooComplex);
    }

    SECTION("the length cap is checked before anything else") {
        // 501 chars that would otherwise be a syntax error at position 0.
        std::string pattern = ")" + std::string(500, 'a');
        REQUIRE(parse(pattern).error.type == ParseErrorType::PatternTooComplex);
    }

    SECTION("max nesting reachable under the default cap stays far below the depth limit") {
        // 249 pairs + 'a' = 499 chars: parses fine, and 249 << 1000, which is
        // why the depth guard is unreachable through default limits.
        std::string pattern(249, '(');
        pattern += "a";
        pattern += std::string(249, ')');
        REQUIRE(pattern.size() == 499);
        REQUIRE(parse(pattern).ok);
    }

    SECTION("custom limits are honored") {
        ParseLimits tiny;
        tiny.maxPatternLength = 5;
        REQUIRE(parse("abcde", tiny).ok);
        ParseResult result = parse("abcdef", tiny);
        REQUIRE_FALSE(result.ok);
        REQUIRE(result.error.position == 5);
        REQUIRE(result.error.expected == std::string("pattern length <= 5"));
    }
}
