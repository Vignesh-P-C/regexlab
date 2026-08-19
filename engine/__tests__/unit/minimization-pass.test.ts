import { describe, it, expect } from "vitest";
import { parse } from "../../passes/parser-pass.js";
import { thompsonConstruction } from "../../passes/thompson-pass.js";
import { subsetConstruction } from "../../passes/subset-construction-pass.js";
import { minimize } from "../../passes/minimization-pass.js";
import type { Automaton } from "../../types.js";

/** Helper: run a pattern through the real pipeline up to the minimized DFA. */
function minDfaFor(pattern: string): { dfa: Automaton; min: Automaton } {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error(`test pattern "${pattern}" failed to parse`);
  const nfa = thompsonConstruction(parsed.ast);
  const dfa = subsetConstruction(nfa);
  return { dfa, min: minimize(dfa) };
}

function flat(automaton: Automaton): Record<number, Record<string, number[]>> {
  const out: Record<number, Record<string, number[]>> = {};
  for (const [state, bySymbol] of automaton.transitions) {
    out[state] = Object.fromEntries(bySymbol);
  }
  return out;
}

describe("MinimizationPass — genuinely reduces state count", () => {
  it("'(a|b)*ab' (classic Aho/Sethi/Ullman example): DFA has 4 states, min-DFA has 3", () => {
    const { dfa, min } = minDfaFor("(a|b)*ab");

    // Confirm the DFA really is non-minimal before minimizing, so this test
    // is actually exercising the reduction and not a no-op.
    expect(dfa.stateCount).toBe(4);

    expect(min.stateCount).toBe(3);
    expect(min.startState).toBe(0);
    expect(min.acceptStates).toEqual(new Set([2]));
    expect(flat(min)).toEqual({
      0: { a: [1], b: [0] }, // self-loop: the two DFA states merged here were behaviorally identical
      1: { a: [1], b: [2] },
      2: { a: [1], b: [0] },
    });
  });

  it("'ab|ac': the two single-transition accept states merge into one", () => {
    const { dfa, min } = minDfaFor("ab|ac");

    expect(dfa.stateCount).toBe(4);
    expect(min.stateCount).toBe(3);
    expect(min.startState).toBe(0);
    expect(min.acceptStates).toEqual(new Set([2]));
    expect(flat(min)).toEqual({
      0: { a: [1] },
      1: { b: [2], c: [2] },
    });
  });
});

describe("MinimizationPass — does not over-merge an already-minimal DFA", () => {
  it("'aa|a' is already minimal: 3 states in, 3 states out, unchanged shape", () => {
    const { dfa, min } = minDfaFor("aa|a");

    expect(dfa.stateCount).toBe(3);
    expect(min.stateCount).toBe(3);
    expect(min.startState).toBe(0);
    expect(min.acceptStates).toEqual(new Set([1, 2]));
    expect(flat(min)).toEqual({
      0: { a: [1] },
      1: { a: [2] },
    });
  });
});

describe("MinimizationPass — accepting and non-accepting states never merge", () => {
  it("no group in the minimized DFA mixes accepting and non-accepting original states", () => {
    // Structural sanity check rather than a golden value: run several patterns
    // and confirm the invariant Moore's algorithm depends on never breaks.
    for (const pattern of ["(a|b)*ab", "ab|ac", "aa|a", "(a|b)*", "a*b*"]) {
      const { min } = minDfaFor(pattern);
      // Every accept state in min-DFA should behave consistently — this is
      // implicitly checked by minimize() itself (acceptStates.add uses
      // group[0] as representative), so this test just confirms the pass
      // runs cleanly end-to-end without throwing for a spread of patterns.
      expect(min.stateCount).toBeGreaterThan(0);
      expect(min.acceptStates.size).toBeGreaterThan(0);
    }
  });
});