import { describe, it, expect } from "vitest";
import { thompsonConstruction } from "../../passes/thompson-pass.js";
import { parse } from "../../passes/parser-pass.js";
import type { Automaton } from "../../types.js";

/** Helper: build the NFA straight from a pattern string via the real ParserPass. */
function nfaFor(pattern: string): Automaton {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error(`test pattern "${pattern}" failed to parse`);
  return thompsonConstruction(parsed.ast);
}

/** Helper: read transitions as a plain object of arrays for easy assertions. */
function flat(automaton: Automaton): Record<number, Record<string, number[]>> {
  const out: Record<number, Record<string, number[]>> = {};
  for (const [state, bySymbol] of automaton.transitions) {
    out[state] = Object.fromEntries(bySymbol);
  }
  return out;
}

describe("ThompsonPass — single char", () => {
  it("'a' produces a 2-state fragment: (0) --a--> (1)", () => {
    const nfa = nfaFor("a");
    expect(nfa.stateCount).toBe(2);
    expect(nfa.startState).toBe(0);
    expect(nfa.acceptStates).toEqual(new Set([1]));
    expect(flat(nfa)).toEqual({ 0: { a: [1] } });
  });
});

describe("ThompsonPass — concatenation", () => {
  it("'ab' chains two char fragments with one epsilon transition", () => {
    const nfa = nfaFor("ab");
    // fragment 'a': states 0,1 (0--a-->1); fragment 'b': states 2,3 (2--b-->3)
    // concat rule: left.accept --eps--> right.start, i.e. 1 --eps--> 2
    expect(nfa.stateCount).toBe(4);
    expect(nfa.startState).toBe(0);
    expect(nfa.acceptStates).toEqual(new Set([3]));
    expect(flat(nfa)).toEqual({
      0: { a: [1] },
      1: { eps: [2] },
      2: { b: [3] },
    });
  });
});

describe("ThompsonPass — alternation", () => {
  it("'a|b' adds a new start/accept pair with 4 epsilon transitions", () => {
    const nfa = nfaFor("a|b");
    // fragment 'a': 0--a-->1; fragment 'b': 2--b-->3; new start=4, new accept=5
    expect(nfa.stateCount).toBe(6);
    expect(nfa.startState).toBe(4);
    expect(nfa.acceptStates).toEqual(new Set([5]));
    expect(flat(nfa)).toEqual({
      4: { eps: [0, 2] },
      0: { a: [1] },
      1: { eps: [5] },
      2: { b: [3] },
      3: { eps: [5] },
    });
  });
});

describe("ThompsonPass — Kleene star", () => {
  it("'a*' adds a skip path and a loop-back path", () => {
    const nfa = nfaFor("a*");
    // fragment 'a': 0--a-->1; new start=2, new accept=3
    expect(nfa.stateCount).toBe(4);
    expect(nfa.startState).toBe(2);
    expect(nfa.acceptStates).toEqual(new Set([3]));
    expect(flat(nfa)).toEqual({
      2: { eps: [0, 3] }, // skip (zero reps) or enter the loop
      0: { a: [1] },
      1: { eps: [0, 3] }, // loop back (repeat) or exit
    });
  });
});

describe("ThompsonPass — composition", () => {
  it("'(a|b)*' composes star around alt correctly (structural sanity check)", () => {
    const nfa = nfaFor("(a|b)*");
    // alt(a,b) alone would be 6 states (0-5); star wraps it in 2 more => 8 total
    expect(nfa.stateCount).toBe(8);
    // outermost fragment is the star's new start/accept: states 6 and 7
    expect(nfa.startState).toBe(6);
    expect(nfa.acceptStates).toEqual(new Set([7]));
    // star's start epsilon-branches to the alt's start (4) and to star's own accept (7)
    expect(flat(nfa)[6]).toEqual({ eps: [4, 7] });
  });
});
