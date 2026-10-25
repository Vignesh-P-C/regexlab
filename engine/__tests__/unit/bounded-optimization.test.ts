import { describe, expect, it } from "vitest";
import { searchBoundedEpsilonDeletions } from "../../bounded-optimization.js";
import { listEligibleEpsilonEdges } from "../../candidate.js";
import { parse } from "../../passes/parser-pass.js";
import { thompsonConstruction } from "../../passes/thompson-pass.js";

function nfaFor(pattern: string) {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error("Expected valid pattern: " + pattern);
  return thompsonConstruction(parsed.ast);
}

describe("bounded epsilon-deletion search", () => {
  it("enumerates deterministic edit sets and keeps unsafe candidates out of the Pareto frontier", () => {
    const nfa = nfaFor("a|a");
    const limits = { maxEditDepth: 2, maxCandidates: 64 };
    const first = searchBoundedEpsilonDeletions(nfa, limits);
    const second = searchBoundedEpsilonDeletions(nfa, limits);

    expect(first.stopReasons).toEqual([]);
    expect(first.searchSpaceCandidateCount).toBe(10);
    expect(first.evaluatedCandidateCount).toBe(10);
    expect(first.equivalentCandidateCount).toBe(6);
    expect(first.differentCandidateCount).toBe(4);
    expect(first.paretoFrontierIds).toEqual([
      "delete-eps:1>5,4>0",
      "delete-eps:3>5,4>2",
    ]);
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(
      second.candidates.map((candidate) => candidate.id),
    );
    expect(first.candidates.every((candidate) =>
      candidate.equivalence.status === "equivalent" || !first.paretoFrontierIds.includes(candidate.id),
    )).toBe(true);
    expect(first.candidates.filter((candidate) => candidate.equivalence.status === "equivalent")
      .every((candidate) => candidate.minimizedStateCountMatchesBaseline === true)).toBe(true);
    expect(first.candidates.filter((candidate) => candidate.equivalence.status !== "equivalent")
      .every((candidate) => candidate.minimizedStateCountMatchesBaseline === null)).toBe(true);
  });

  it("reports an evaluation cap and an eligible-edge cap explicitly", () => {
    const branching = nfaFor("a|b");
    const capped = searchBoundedEpsilonDeletions(branching, { maxEditDepth: 2, maxCandidates: 1 });
    expect(capped.evaluatedCandidateCount).toBe(1);
    expect(capped.stopReasons).toContain("candidate-limit");
    expect(capped.searchSpaceCandidateCount).toBeGreaterThan(1);

    const edgeLimited = searchBoundedEpsilonDeletions(branching, { maxEligibleEdges: 1 });
    expect(edgeLimited.totalEligibleEdgeCount).toBeGreaterThan(1);
    expect(edgeLimited.consideredEdgeCount).toBe(1);
    expect(edgeLimited.stopReasons).toContain("eligible-edge-limit");
  });

  it("does not label a search complete when the baseline cannot be determinized under its cap", () => {
    const result = searchBoundedEpsilonDeletions(nfaFor("a"), { maxDfaStates: 1 });
    expect(result.stopReasons).toEqual(["baseline-inconclusive"]);
    expect(result.evaluatedCandidateCount).toBe(0);
    expect(result.baselineMetrics.reachableSubsetStateCount).toBeNull();
  });

  it("keeps candidates inconclusive when the product-state cap is reached", () => {
    const result = searchBoundedEpsilonDeletions(nfaFor("a|a"), {
      maxEditDepth: 1,
      maxProductStatePairs: 1,
    });
    expect(result.inconclusiveCandidateCount).toBeGreaterThan(0);
    expect(result.candidates.filter((candidate) => candidate.equivalence.status === "inconclusive")
      .every((candidate) => !result.paretoFrontierIds.includes(candidate.id))).toBe(true);
  });

  it("returns a complete empty search for a literal with no epsilon edges", () => {
    const nfa = nfaFor("a");
    expect(listEligibleEpsilonEdges(nfa)).toHaveLength(0);
    const result = searchBoundedEpsilonDeletions(nfa);
    expect(result.searchSpaceCandidateCount).toBe(0);
    expect(result.stopReasons).toEqual([]);
  });
});
