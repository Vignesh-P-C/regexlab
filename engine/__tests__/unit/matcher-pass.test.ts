import { describe, it, expect } from "vitest";
import { parse } from "../../passes/parser-pass.js";
import { thompsonConstruction } from "../../passes/thompson-pass.js";
import { subsetConstruction } from "../../passes/subset-construction-pass.js";
import { minimize } from "../../passes/minimization-pass.js";
import { match } from "../../passes/matcher-pass.js";
import type { Automaton } from "../../types.js";

/** Helper: run a pattern through the entire real pipeline down to a minimized DFA. */
function pipelineFor(pattern: string): Automaton {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error(`test pattern "${pattern}" failed to parse`);
  return minimize(subsetConstruction(thompsonConstruction(parsed.ast)));
}

describe("MatcherPass — 'ab' (exact literal match)", () => {
  const dfa = pipelineFor("ab");

  it("matches the exact string, with one step per character", () => {
    const trace = match(dfa, "ab");
    expect(trace.result).toBe("match");
    expect(trace.steps).toEqual([
      { char: "a", activeStates: [1] },
      { char: "b", activeStates: [2] },
    ]);
    expect(trace.failurePosition).toBeUndefined();
  });

  it("hits a dead end mid-string and stops immediately (no backtracking)", () => {
    const trace = match(dfa, "ac");
    expect(trace.result).toBe("no-match");
    expect(trace.failurePosition).toBe(1); // 'c' has nowhere to go from state 1
    expect(trace.steps).toEqual([{ char: "a", activeStates: [1] }]); // stopped before consuming 'c'
  });

  it("runs out of input in a non-accepting state — no-match, but not a dead end", () => {
    const trace = match(dfa, "a");
    expect(trace.result).toBe("no-match");
    expect(trace.failurePosition).toBeUndefined(); // every character it saw had somewhere to go
    expect(trace.steps).toEqual([{ char: "a", activeStates: [1] }]);
  });
});

describe("MatcherPass — 'a*' (minimizes to a single self-looping state)", () => {
  const dfa = pipelineFor("a*");

  it("matches the empty string with zero steps (start state is itself accepting)", () => {
    const trace = match(dfa, "");
    expect(trace.result).toBe("match");
    expect(trace.steps).toEqual([]);
  });

  it("matches an arbitrarily long run of 'a', looping on the same state", () => {
    const trace = match(dfa, "aaaa");
    expect(trace.result).toBe("match");
    expect(trace.steps).toEqual([
      { char: "a", activeStates: [0] },
      { char: "a", activeStates: [0] },
      { char: "a", activeStates: [0] },
      { char: "a", activeStates: [0] },
    ]);
  });

  it("dead-ends immediately on any character outside the alphabet", () => {
    const trace = match(dfa, "b");
    expect(trace.result).toBe("no-match");
    expect(trace.failurePosition).toBe(0);
    expect(trace.steps).toEqual([]);
  });
});

describe("MatcherPass — '(a|b)*ab' (strings ending in 'ab')", () => {
  const dfa = pipelineFor("(a|b)*ab");

  it("matches strings that end in 'ab'", () => {
    expect(match(dfa, "ab").result).toBe("match");
    expect(match(dfa, "aab").result).toBe("match");
    expect(match(dfa, "bbab").result).toBe("match");
  });

  it("rejects strings that don't end in 'ab', with a full step trace (no dead end — every char had somewhere to go)", () => {
    const trace = match(dfa, "ba");
    expect(trace.result).toBe("no-match");
    expect(trace.failurePosition).toBeUndefined();
    expect(trace.steps).toHaveLength(2); // both characters were consumed, it just landed wrong
  });
});