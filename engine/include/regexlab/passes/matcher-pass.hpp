#pragma once
// regexlab/passes/matcher-pass.hpp
//
// MatcherPass — CLAUDE.md v2 §8 (fifth and final stage of the pipeline).
// C++ port of matcher-pass.ts. Same O(n) DFA-driven walk, no
// backtracking — see matcher-pass.cpp for the full algorithm notes,
// identical to the TS version.

#include <string>

#include "regexlab/types.hpp"

namespace regexlab {

/** MatcherPass entry point: a minimized DFA and an input string in, a MatchTrace out. */
MatchTrace match(const Automaton& dfa, const std::string& input);

}  // namespace regexlab
