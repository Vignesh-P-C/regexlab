#pragma once
// regexlab/passes/parser-pass.hpp
//
// ParserPass — CLAUDE.md v2 §8 (first stage of the pipeline).
// C++ port of parser-pass.ts. See parser-pass.cpp for the full algorithm
// notes (recursive-descent, precedence-via-call-chain, left-associative
// alt/concat, backslash-escape addition) — all identical to the TS version.

#include <string>

#include "regexlab/types.hpp"

namespace regexlab {

/**
 * Safety limits on what the parser will accept. Both exist to keep recursion
 * (parser, AST destructor, Thompson, minimization) bounded; both report
 * through the ordinary ParseError path (PatternTooComplex), never a crash.
 *
 * Production code uses the defaults. The parameter exists so tests can lift
 * one limit to exercise the other: with the default 500-char length cap a
 * pattern can nest at most 499 levels, so the depth guard is unreachable
 * through default limits (it stays as defense in depth if the length cap is
 * ever raised, e.g. after a faster minimization algorithm lands).
 */
constexpr int kDefaultMaxPatternLength = 500;
constexpr int kDefaultMaxNestingDepth = 1000;

struct ParseLimits {
    int maxPatternLength = kDefaultMaxPatternLength;
    int maxNestingDepth = kDefaultMaxNestingDepth;
};

/** ParserPass entry point: string in, ParseResult out. Pure, no side effects. */
ParseResult parse(const std::string& pattern, const ParseLimits& limits = ParseLimits{});

}  // namespace regexlab
