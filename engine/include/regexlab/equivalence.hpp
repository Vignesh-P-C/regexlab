#pragma once
// regexlab/equivalence.hpp — issue #68. C++ port of engine/equivalence.ts
// — see that file's header comment for the full algorithm explanation.
// THIS is the reusable entry point PR B's bounded search should call.

#include "regexlab/growth-types.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/types.hpp"

namespace regexlab {

// See equivalence.ts's DEFAULT_EQUIVALENCE_BUDGET for the derivation.
inline constexpr int kDefaultEquivalenceBudget = 20000;

EquivalenceResult checkEquivalence(
    const Automaton& baselineNfa, const Automaton& candidateNfa,
    int budget = kDefaultEquivalenceBudget,
    SubsetConstructionLimits subsetLimits = {});

}  // namespace regexlab
