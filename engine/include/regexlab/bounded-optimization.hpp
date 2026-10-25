#pragma once

#include "regexlab/growth-types.hpp"
#include "regexlab/types.hpp"

namespace regexlab {

/** Search a deterministic, capped neighborhood of epsilon-edge deletions. */
BoundedOptimizationResult searchBoundedEpsilonDeletions(
    const Automaton& baselineNfa, BoundedSearchLimits limits = {});

}  // namespace regexlab
