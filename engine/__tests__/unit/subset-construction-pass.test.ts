import { describe, it, expect } from "vitest";
import { parse } from "../../passes/parser-pass.js";
import { thompsonConstruction } from "../../passes/thompson-pass.js";
import { subsetConstruction } from "../../passes/subset-construction-pass.js";
import type { Automaton } from "../../types.js";

/** Helper: run a pattern through the real pipeline up to the DFA. */
function dfaFor(pattern: string): Automaton {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error(`test pattern "${pattern}" failed to parse`);
  return subsetConstruction(thompsonConstruction(parsed.ast));
}

function flat(automaton: Automaton): Record<number, Record<string, number[]>> {
  const out: Record<number, Record<string, number[]>> = {};
  for (const [state, bySymbol] of automaton.transitions) {
    out[state] = Object.fromEntries(bySymbol);
  }
  return out;
}

describe("SubsetConstructionPass — already-deterministic input", () => {
  it("'a' stays a 2-state DFA (the NFA had no epsilons to fold)", () => {
    const dfa = dfaFor("a");
    expect(dfa.stateCount).toBe(2);
    expect(dfa.startState).toBe(0);
    expect(dfa.acceptStates).toEqual(new Set([1]));
    expect(flat(dfa)).toEqual({ 0: { a: [1] } });
  });
});

describe("SubsetConstructionPass — folds epsilon-branching from alternation", () => {
  it("'a|b' becomes a 3-state DFA: one dispatch state, two dead-end accept states", () => {
    const dfa = dfaFor("a|b");
    expect(dfa.stateCount).toBe(3);
    expect(dfa.startState).toBe(0);
    // both branches lead to acceptance
    expect(dfa.acceptStates).toEqual(new Set([1, 2]));
    expect(flat(dfa)).toEqual({
      0: { a: [1], b: [2] },
    });
  });
});

describe("SubsetConstructionPass — collapses a Kleene-star loop into a self-loop", () => {
  it("'a*' becomes a 2-state DFA where the accept state loops back to itself", () => {
    const dfa = dfaFor("a*");
    expect(dfa.stateCount).toBe(2);
    expect(dfa.startState).toBe(0);
    // start state itself accepts (matches empty string), and stays accepting after any 'a'
    expect(dfa.acceptStates).toEqual(new Set([0, 1]));
    expect(flat(dfa)).toEqual({
      0: { a: [1] },
      1: { a: [1] }, // self-loop: this is the fixpoint-termination case
    });
  });
});

describe("SubsetConstructionPass — determinism sanity check", () => {
  it("every DFA state has at most one destination per symbol", () => {
    const dfa = dfaFor("(a|b)*c");
    for (const bySymbol of dfa.transitions.values()) {
      for (const destinations of bySymbol.values()) {
        expect(destinations.length).toBe(1);
      }
    }
  });

  it("no DFA transition is ever labeled 'eps' — epsilons are fully folded away", () => {
    const dfa = dfaFor("(a|b)*c");
    for (const bySymbol of dfa.transitions.values()) {
      expect(bySymbol.has("eps")).toBe(false);
    }
  });
});