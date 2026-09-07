#pragma once
// regexlab/passes/subset-construction-pass.hpp
//
// SubsetConstructionPass — CLAUDE.md v2 §8 (third stage of the pipeline).
// C++ port of subset-construction-pass.ts. Same worklist/fixpoint over
// epsilon-closures (Rabin–Scott) — see subset-construction-pass.cpp for
// the full algorithm notes, identical to the TS version.

#include "regexlab/types.hpp"

namespace regexlab {

/** SubsetConstructionPass entry point: NFA in, DFA out (same Automaton shape, no "eps" transitions). */
Automaton subsetConstruction(const Automaton& nfa);

}  // namespace regexlab
