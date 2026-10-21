#pragma once
// regexlab/passes/subset-construction-pass.hpp
//
// SubsetConstructionPass — CLAUDE.md v2 §8 (third stage of the pipeline).
// C++ port of subset-construction-pass.ts. Same worklist/fixpoint over
// epsilon-closures (Rabin–Scott) — see subset-construction-pass.cpp for
// the full algorithm notes, identical to the TS version.

#include "regexlab/growth-types.hpp"
#include "regexlab/types.hpp"

namespace regexlab {

/** SubsetConstructionPass entry point: NFA in, DFA out (same Automaton shape, no "eps" transitions). */
Automaton subsetConstruction(const Automaton& nfa);

/**
 * SubsetConstructionPass, traced — issue #68 (Subset Growth / NFA
 * Structure Lab, PR A). Same algorithm and output as subsetConstruction()
 * above; additionally records every worklist step. See
 * subset-construction-pass.cpp for why this is a separate function
 * rather than a parameter on subsetConstruction() itself.
 */
struct TracedSubsetConstruction {
    Automaton dfa;
    SubsetTrace trace;
};
TracedSubsetConstruction subsetConstructionTraced(const Automaton& nfa);

}  // namespace regexlab
