#pragma once
// regexlab/automaton-metrics.hpp — issue #68. C++ port of
// engine/automaton-metrics.ts — see that file for the precise
// definitions of "reachable", "trim", and "alphabet size" used here.

#include "regexlab/growth-types.hpp"
#include "regexlab/types.hpp"

namespace regexlab {

AutomatonMetrics computeAutomatonMetrics(const Automaton& automaton);

// Exact 2^n via manual decimal-digit doubling (no native bignum in
// C++'s standard library) — see automaton-metrics.cpp for the algorithm.
PowersetCeiling computePowersetCeiling(int nfaStateCount);

}  // namespace regexlab
