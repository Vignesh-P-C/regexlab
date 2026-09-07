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
