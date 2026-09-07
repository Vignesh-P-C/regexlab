#pragma once
// regexlab/passes/thompson-pass.hpp
//
// ThompsonPass — CLAUDE.md v2 §8 (second stage of the pipeline).
// C++ port of thompson-pass.ts. Same four construction rules (char,
// concat, alt, star), same fragment invariant (exactly one start state,
// exactly one accept state per fragment) — see thompson-pass.cpp for
// the full algorithm notes, identical to the TS version.

#include "regexlab/types.hpp"

namespace regexlab {

/** ThompsonPass entry point: AST in, NFA (as an Automaton) out. Pure, no side effects. */
Automaton thompsonConstruction(const ASTNodePtr& ast);

}  // namespace regexlab
