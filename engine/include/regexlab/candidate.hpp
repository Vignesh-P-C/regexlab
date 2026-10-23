#pragma once
// regexlab/candidate.hpp — issue #68. C++ port of engine/candidate.ts —
// see that file's header comment for the "copy on write" rationale.

#include <vector>

#include "regexlab/growth-types.hpp"
#include "regexlab/types.hpp"

namespace regexlab {

Automaton cloneAutomaton(const Automaton& automaton);
std::vector<CandidateEdgeId> listEligibleEpsilonEdges(const Automaton& nfa);
Automaton applyCandidateEdit(const Automaton& nfa, const CandidateEdit& edit);

}  // namespace regexlab
