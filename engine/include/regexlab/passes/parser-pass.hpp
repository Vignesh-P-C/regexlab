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

/** ParserPass entry point: string in, ParseResult out. Pure, no side effects. */
ParseResult parse(const std::string& pattern);

}  // namespace regexlab
