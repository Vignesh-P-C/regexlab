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

/** Deterministic state/work caps for Moore refinement. */
struct MinimizationLimits {
    std::size_t maxDfaStates = 20000;
    std::size_t maxWorkUnits = 5000000;
};

/** MinimizationPass entry point: DFA in, minimal DFA out (Moore's algorithm). */
Automaton minimize(const Automaton& dfa, const MinimizationLimits& limits = {});

}  // namespace regexlab
