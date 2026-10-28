#pragma once
// regexlab/passes/minimization-pass.hpp
//
// MinimizationPass — CLAUDE.md v2 §8 (fourth stage of the pipeline).
// C++ port of minimization-pass.ts. Same Moore's-algorithm partition
// refinement — see minimization-pass.cpp for the full algorithm notes,
// identical to the TS version.

#include <cstddef>

#include "regexlab/types.hpp"

namespace regexlab {

/**
 * Deterministic state/work caps for Moore refinement. maxDfaStates is a
 * cheap up-front size guard; maxWorkUnits backstops the refinement cost
 * itself (stateCount^2 * alphabetSize AFTER alphabet-equivalence-class
 * compression — see minimization-pass.cpp's comment above that check for
 * the full derivation). minimize() throws AutomatonTooComplexError if
 * either limit is exceeded.
 */
struct MinimizationLimits {
    std::size_t maxDfaStates = 20000;
    // ~9.27M measured pre-compression, rounded down to 10M for margin — see
    // minimization-pass.cpp's work-budget comment for the full derivation.
    std::size_t maxWorkUnits = 10000000;
};

/**
 * MinimizationPass entry point: DFA in, minimal DFA out (Moore's
 * algorithm), subject to the explicit limits (default-constructed
 * MinimizationLimits if the caller doesn't need to override them).
 */
Automaton minimize(const Automaton& dfa, const MinimizationLimits& limits = {});

}  // namespace regexlab
