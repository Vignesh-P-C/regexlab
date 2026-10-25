// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  Automaton,
  BoundedAutomatonMetrics,
  BoundedOptimizationResponse,
} from "../types/engine";
import { BoundedOptimizationExplorer } from "./BoundedOptimizationExplorer";

afterEach(cleanup);

const baselineNfa: Automaton = {
  stateCount: 3,
  startState: 0,
  acceptStates: [2],
  transitions: { "0": { eps: [1] }, "1": { a: [2] } },
};

function metrics(epsilonEdgeCount: number, subsetCount: number): BoundedAutomatonMetrics {
  return {
    nfa: {
      rawStateCount: 3,
      reachableStateCount: 3,
      trimStateCount: 3,
      epsilonEdgeCount,
      consumingEdgeCount: 1,
      totalTransitionCount: epsilonEdgeCount + 1,
      alphabetSize: 1,
    },
    reachableSubsetStateCount: subsetCount,
    minimizedStateCount: 2,
    subsetAnalysisReason: null,
    minimizationReason: null,
  };
}

const searchResponse: BoundedOptimizationResponse = {
  ok: true,
  search: {
    limits: {
      maxEligibleEdges: 12,
      maxEditDepth: 2,
      maxCandidates: 24,
      maxDfaStates: 128,
      maxWorkUnitsPerCheck: 100000,
      maxProductStatePairs: 10000,
    },
    totalEligibleEdgeCount: 1,
    consideredEdgeCount: 1,
    searchSpaceCandidateCount: 1,
    generatedCandidateCount: 1,
    evaluatedCandidateCount: 1,
    equivalentCandidateCount: 1,
    differentCandidateCount: 0,
    inconclusiveCandidateCount: 0,
    duplicateAutomataSkipped: 0,
    stopReasons: [],
    baselineMetrics: metrics(1, 2),
    candidates: [{
      id: "delete-eps:0>1",
      edits: [{ source: 0, symbol: "eps", target: 1 }],
      nfa: { ...baselineNfa, transitions: { "1": { a: [2] } } },
      metrics: metrics(0, 2),
      equivalence: { status: "equivalent" },
      minimizedStateCountMatchesBaseline: true,
    }],
    paretoFrontierIds: ["delete-eps:0>1"],
  },
};

describe("BoundedOptimizationExplorer", () => {
  it("runs within selected limits and clearly labels verified variants and their preview", () => {
    const runBoundedOptimization = vi.fn(() => searchResponse);
    render(
      <BoundedOptimizationExplorer
        pattern="a"
        baselineNfa={baselineNfa}
        runBoundedOptimization={runBoundedOptimization}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run bounded search" }));

    expect(runBoundedOptimization).toHaveBeenCalledWith("a", 2, 24);
    expect(screen.getByText(/declared search space was exhausted/i)).toBeTruthy();
    expect(screen.getAllByText("Verified equivalent")).toHaveLength(2);
    expect(screen.getByText("Pareto frontier")).toBeTruthy();
    expect(screen.getByText("Automaton preview only; this experiment never changes the pipeline's original NFA.")).toBeTruthy();
  });
});
