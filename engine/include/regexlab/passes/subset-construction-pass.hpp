#pragma once
// regexlab/passes/subset-construction-pass.hpp
//
// SubsetConstructionPass — CLAUDE.md v2 §8 (third stage of the pipeline).
// C++ port of subset-construction-pass.ts. Same worklist/fixpoint over
// epsilon-closures (Rabin–Scott) — see subset-construction-pass.cpp for
// the full algorithm notes, identical to the TS version.

#include <cstddef>
#include <optional>

#include "regexlab/growth-types.hpp"
#include "regexlab/types.hpp"

namespace regexlab {

/** Deterministic state/work caps shared by ordinary and opt-in construction. */
struct SubsetConstructionLimits {
    std::size_t maxDfaStates = 20000;
    std::size_t maxWorkUnits = 1000000;
};

/** SubsetConstructionPass entry point: NFA in, safety-bounded DFA out. */
Automaton subsetConstruction(
    const Automaton& nfa, const SubsetConstructionLimits& limits = {});

/**
 * Bounded subset construction. Returns nullopt if either cap is exceeded.
 */
std::optional<Automaton> subsetConstructionBounded(
    const Automaton& nfa, const SubsetConstructionLimits& limits);

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
TracedSubsetConstruction subsetConstructionTraced(
    const Automaton& nfa, const SubsetConstructionLimits& limits = {},
    std::size_t maxTraceSteps = 50000);

}  // namespace regexlab
