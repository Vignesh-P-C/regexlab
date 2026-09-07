#pragma once
// regexlab/passes/minimization-pass.hpp
//
// MinimizationPass — CLAUDE.md v2 §8 (fourth stage of the pipeline).
// C++ port of minimization-pass.ts. Same Moore's-algorithm partition
// refinement — see minimization-pass.cpp for the full algorithm notes,
// identical to the TS version.

#include "regexlab/types.hpp"

namespace regexlab {

/** MinimizationPass entry point: DFA in, minimal DFA out (Moore's algorithm). */
Automaton minimize(const Automaton& dfa);

}  // namespace regexlab
