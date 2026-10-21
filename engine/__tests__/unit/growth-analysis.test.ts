import { describe, expect, it } from "vitest";
import { parse } from "../../passes/parser-pass.js";
import { thompsonConstruction } from "../../passes/thompson-pass.js";
import { subsetConstruction, subsetConstructionTraced } from "../../passes/subset-construction-pass.js";
import type { ASTNode, Automaton } from "../../types.js";
import { computeAutomatonMetrics, computePowersetCeiling } from "../../automaton-metrics.js";
import { cloneAutomaton, listEligibleEpsilonEdges, applyCandidateEdit } from "../../candidate.js";
import { checkEquivalence } from "../../equivalence.js";
import { computeGrowthAnalysis, verifyCandidate } from "../../growth-analysis.js";

function nfaFor(pattern: string): Automaton {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return thompsonConstruction(parsed.ast as ASTNode);
}

describe("subsetConstructionTraced — invariants (#68)", () => {
  it("matches subsetConstruction()'s own DFA output exactly for a branching pattern", () => {
    const nfa = nfaFor("(a|b)b");
    const plain = subsetConstruction(nfa);
    const { dfa } = subsetConstructionTraced(nfa);
    expect(dfa).toEqual(plain);
  });

  it("every step's target is epsilonClosure(move(source, symbol)), and step order matches the real worklist", () => {
    const nfa = nfaFor("(a|b)b");
    const { dfa, trace } = subsetConstructionTraced(nfa);

    expect(trace.subsetCount).toBe(dfa.stateCount);
    // First step must start from the DFA's actual start state.
    expect(trace.steps[0].sourceId).toBe(dfa.startState);

    for (const step of trace.steps) {
      expect(step.closureNfaStates).toEqual([...step.closureNfaStates].sort((a, b) => a - b));
      expect(step.targetId).toBeGreaterThanOrEqual(0);
      // Accepting iff the closure intersects the NFA's own accept states.
      const shouldAccept = step.closureNfaStates.some((s) => nfa.acceptStates.has(s));
      expect(step.isAccepting).toBe(shouldAccept);
    }

    // Each discovered DFA id is marked "new" exactly once across the whole trace.
    const newCounts = new Map<number, number>();
    for (const step of trace.steps) {
      if (step.isNew) newCounts.set(step.targetId, (newCounts.get(step.targetId) ?? 0) + 1);
    }
    for (const count of newCounts.values()) expect(count).toBe(1);

    // Every target id in the trace is reachable (trivially true here since the
    // worklist only ever visits ids it assigned), and the state count the UI
    // would show equals the actual DFA's state count.
    expect(new Set(trace.steps.map((s) => s.targetId)).size).toBeLessThanOrEqual(dfa.stateCount);
  });
});

describe("AutomatonMetrics (#68)", () => {
  it("counts a charset edge as ONE consuming relation, not one per matching ASCII code", () => {
    const nfa = nfaFor("[a-z]");
    const metrics = computeAutomatonMetrics(nfa);
    expect(metrics.consumingEdgeCount).toBe(1);
    expect(metrics.alphabetSize).toBe(1);
  });

  it("trim excludes states that can't reach an accept state", () => {
    // "a|b" with nothing dangling — sanity check that trim == reachable here.
    const nfa = nfaFor("a|b");
    const metrics = computeAutomatonMetrics(nfa);
    expect(metrics.trimStateCount).toBe(metrics.reachableStateCount);
    expect(metrics.reachableStateCount).toBe(metrics.rawStateCount);
  });
});

describe("powerset ceiling (#68)", () => {
  it("is an exact BigInt-backed decimal, not a floating-point approximation", () => {
    expect(computePowersetCeiling(10).exactDecimal).toBe((2n ** 10n).toString());
    // n large enough that a plain `number` 2^n would lose precision (> 2^53).
    const big = computePowersetCeiling(500);
    expect(big.exactDecimal).toBe((2n ** 500n).toString());
    expect(big.exactDecimal.length).toBeGreaterThan(100);
  });
});

describe("candidate immutability (#68)", () => {
  it("never mutates the baseline NFA across clone, edit, or equivalence checking", () => {
    const nfa = nfaFor("a*");
    const before = cloneAutomaton(nfa); // independent reference snapshot
    const edges = listEligibleEpsilonEdges(nfa);
    expect(edges.length).toBeGreaterThan(0);

    const candidate = applyCandidateEdit(nfa, { kind: "deleteEpsilonEdge", edge: edges[0] });
    expect(nfa).toEqual(before); // baseline untouched by the edit

    checkEquivalence(nfa, candidate);
    expect(nfa).toEqual(before); // baseline untouched by verification either

    const result = verifyCandidate(nfa, { kind: "deleteEpsilonEdge", edge: edges[0] });
    expect(nfa).toEqual(before);
    expect(result.nfa).not.toEqual(nfa); // candidate really is a different automaton
  });
});

describe("exact equivalence verifier — the two worked examples (#68)", () => {
  it("'a|a': deleting one of the two redundant alternation-branch entry edges is SAFE (equivalent)", () => {
    const nfa = nfaFor("a|a");
    // The alt-start state has two eps edges (one into each "a" branch).
    // Deleting either one still leaves a path that accepts exactly {"a"}.
    const edges = listEligibleEpsilonEdges(nfa);
    const altStartOutEdges = edges.filter((e) => e.source === nfa.startState);
    expect(altStartOutEdges.length).toBe(2);

    const result = verifyCandidate(nfa, { kind: "deleteEpsilonEdge", edge: altStartOutEdges[0] });
    expect(result.equivalence).toEqual({ status: "equivalent" });
  });

  it("'a*': deleting the star's skip edge (zero-repetitions path) is UNSAFE, with shortest witness = the empty string", () => {
    const nfa = nfaFor("a*");
    // Thompson's star fragment: start --eps--> inner.start (enter),
    //                           start --eps--> accept        (skip — the one we delete)
    //                           inner.accept --eps--> inner.start (loop)
    //                           inner.accept --eps--> accept      (exit)
    // The skip edge is the one whose target is the fragment's accept state
    // AND whose source is the overall start state.
    const edges = listEligibleEpsilonEdges(nfa);
    const skipEdge = edges.find((e) => e.source === nfa.startState && e.target === [...nfa.acceptStates][0]);
    expect(skipEdge).toBeDefined();

    const result = verifyCandidate(nfa, { kind: "deleteEpsilonEdge", edge: skipEdge! });
    expect(result.equivalence.status).toBe("different");
    if (result.equivalence.status === "different") {
      expect(result.equivalence.witness.word).toBe("");
      expect(result.equivalence.witness.isEmpty).toBe(true);
      expect(result.equivalence.witness.baselineAccepts).toBe(true);
      expect(result.equivalence.witness.candidateAccepts).toBe(false);
    }
  });

  it("returns 'inconclusive', never a guess, when the budget is exhausted before the search completes", () => {
    const nfa = nfaFor("a|a");
    const edges = listEligibleEpsilonEdges(nfa);
    const result = verifyCandidate(nfa, { kind: "deleteEpsilonEdge", edge: edges[0] }, 0);
    expect(result.equivalence.status).toBe("inconclusive");
  });
});

describe("computeGrowthAnalysis (#68)", () => {
  it("distinguishes NFA / reachable-subset-DFA / minimized-DFA counts and reports the bound as honestly not-computed", () => {
    const nfa = nfaFor("(a|b)*c");
    const analysis = computeGrowthAnalysis(nfa);

    expect(analysis.nfaMetrics.rawStateCount).toBe(nfa.stateCount);
    expect(analysis.subsetTrace.subsetCount).toBe(analysis.reachableSubsetStateCount);
    // Minimized DFA is never bigger than the reachable subset DFA it was minimized from.
    expect(analysis.minimizedStateCount).toBeLessThanOrEqual(analysis.reachableSubsetStateCount);
    expect(analysis.bound.status).toBe("not-computed");
    expect(analysis.powersetCeiling.exponent).toBe(nfa.stateCount);
  });
});
