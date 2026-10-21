#pragma once
// regexlab/passes/minimization-pass.hpp
//
// MinimizationPass — CLAUDE.md v2 §8 (fourth stage of the pipeline).
// C++ port of minimization-pass.ts. Same Moore's-algorithm partition
// refinement — see minimization-pass.cpp for the full algorithm notes,
// identical to the TS version.

#include <exception>

#include "regexlab/types.hpp"

namespace regexlab {

// Thrown by minimize() when its work-budget safety net trips (see
// minimization-pass.cpp for the threshold and its derivation). Mirrors
// parser-pass.cpp's internal ParseFailure pattern, but is exposed here
// (rather than kept in an anonymous namespace) because pipeline.cpp needs
// to catch it across the call.
class MinimizationTooComplex : public std::exception {
public:
    explicit MinimizationTooComplex(ParseError error) : error_(std::move(error)) {}
    const ParseError& error() const { return error_; }
    const char* what() const noexcept override { return "minimization work budget exceeded"; }

private:
    ParseError error_;
};

/**
 * MinimizationPass entry point: DFA in, minimal DFA out (Moore's algorithm).
 * Throws MinimizationTooComplex if the estimated refinement work
 * (stateCount^2 * post-compression alphabet size) exceeds the safety-net
 * budget — see minimization-pass.cpp.
 */
Automaton minimize(const Automaton& dfa);

}  // namespace regexlab
