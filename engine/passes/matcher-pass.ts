/**
 * MatcherPass — CLAUDE.md v2 §8 (fifth and final stage of the pipeline)
 *
 * Algorithm: straightforward DFA-driven matching — start at the DFA's
 * start state, consume the input string one character at a time,
 * following exactly one transition per character (the DFA is
 * deterministic by construction, so "one transition" is never ambiguous).
 *
 * This is the entire payoff of the pipeline's earlier stages: because
 * everything upstream (Thompson's construction, subset construction,
 * minimization) already resolved all the nondeterminism and epsilon
 * ambiguity into a single deterministic automaton, matching itself is
 * O(n) in the length of the input string with O(1) space (just "which
 * state am I in right now") — see CLAUDE.md §10. Contrast this with a
 * naive backtracking regex engine, which can blow up exponentially on
 * pathological patterns; a DFA never backtracks because it never has
 * more than one place to go.
 *
 * The MatchTrace this produces isn't just a boolean — it's a full
 * step-by-step record (which state was active after each character)
 * specifically so the frontend's playback controls can animate the walk
 * across the automaton diagram, one character at a time, rather than
 * just flashing a final yes/no.
 */

import type { Automaton, MatchTrace } from "../types.js";

/** MatcherPass entry point: a minimized DFA and an input string in, a MatchTrace out. */
export function match(dfa: Automaton, input: string): MatchTrace {
  const steps: MatchTrace["steps"] = [];
  let current = dfa.startState;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const destination = dfa.transitions.get(current)?.get(char)?.[0];

    if (destination === undefined) {
      // Dead end: no transition exists for this character from the current
      // state, so the string can never match no matter what follows. Stop
      // immediately rather than consuming the rest of the string — this is
      // exactly what "the DFA never backtracks" looks like in code.
      return { steps, result: "no-match", failurePosition: i };
    }

    current = destination;
    steps.push({ char, activeStates: [current] });
  }

  // Consumed the whole string without hitting a dead end — whether it's a
  // match depends only on whether the final state is an accept state.
  const result = dfa.acceptStates.has(current) ? "match" : "no-match";
  return { steps, result };
}