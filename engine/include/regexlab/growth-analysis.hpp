#pragma once
// regexlab/growth-analysis.hpp — issue #68. C++ port of
// engine/growth-analysis.ts — top-level entry points for the opt-in
// Growth/What-If feature. See that file's header comment: nothing here
// runs as part of runPipeline().

#include "regexlab/equivalence.hpp"
#include "regexlab/growth-types.hpp"
#include "regexlab/types.hpp"

namespace regexlab {

GrowthAnalysis computeGrowthAnalysis(const Automaton& nfa);

CandidateResult verifyCandidate(const Automaton& baselineNfa, const CandidateEdit& edit,
                                 int budget = kDefaultEquivalenceBudget);

}  // namespace regexlab
