// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { Automaton, CandidateResponse, GrowthAnalysisResult } from "../types/engine";
import { GrowthPanel } from "./GrowthPanel";

afterEach(cleanup);

const analysis: GrowthAnalysisResult = {
  ok: true,
  analysis: {
    nfaMetrics: {
      rawStateCount: 2,
      reachableStateCount: 2,
      trimStateCount: 2,
      epsilonEdgeCount: 0,
      consumingEdgeCount: 1,
      totalTransitionCount: 1,
      alphabetSize: 1,
    },
    subsetTrace: { steps: [], subsetCount: 2 },
    reachableSubsetStateCount: 2,
    minimizedStateCount: 2,
    powersetCeiling: { exponent: 2, exactDecimal: "4" },
    bound: { status: "not-computed", reason: "not available in this test" },
  },
};

const oneEdgeNfa: Automaton = {
  stateCount: 2,
  startState: 0,
  acceptStates: [1],
  transitions: { "0": { eps: [1] } },
};

const twoEdgeNfa: Automaton = {
  stateCount: 4,
  startState: 0,
  acceptStates: [3],
  transitions: {
    "0": { eps: [1, 2] },
    "1": { a: [3] },
    "2": { a: [3] },
  },
};

const differentCandidate: CandidateResponse = {
  ok: true,
  candidate: {
    nfa: oneEdgeNfa,
    metrics: {
      rawStateCount: 2,
      reachableStateCount: 1,
      trimStateCount: 0,
      epsilonEdgeCount: 0,
      consumingEdgeCount: 1,
      totalTransitionCount: 1,
      alphabetSize: 1,
    },
    equivalence: {
      status: "different",
      witness: { word: "a", isEmpty: false, baselineAccepts: true, candidateAccepts: false },
    },
  },
};

function renderPanel(
  pattern: string,
  nfa: Automaton = oneEdgeNfa,
  runGrowthAnalysis = vi.fn(() => analysis),
  verifyCandidate = vi.fn(() => differentCandidate),
) {
  const props = { pattern, nfa, runGrowthAnalysis, verifyCandidate };
  const view = render(createElement(GrowthPanel, props));
  return { ...view, runGrowthAnalysis, verifyCandidate };
}

describe("GrowthPanel source-pattern tracking (#68)", () => {
  it("hides old analysis and edge controls after the pattern changes until refreshed", () => {
    const runGrowthAnalysis = vi.fn(() => analysis);
    const view = renderPanel("a", oneEdgeNfa, runGrowthAnalysis);

    fireEvent.click(screen.getByRole("button", { name: /explore subset growth/i }));
    expect(screen.getByText("Reachable subset-DFA states")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify selected deletions" })).toHaveProperty("disabled", true);
    expect(runGrowthAnalysis).toHaveBeenCalledWith("a");

    view.rerender(
      createElement(GrowthPanel, {
        pattern: "b",
        nfa: oneEdgeNfa,
        runGrowthAnalysis,
        verifyCandidate: vi.fn(() => differentCandidate),
      }),
    );

    expect(screen.getByText(/pattern changed/i)).toBeTruthy();
    expect(screen.queryByText("Reachable subset-DFA states")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: /refresh analysis/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /refresh analysis/i }));
    expect(runGrowthAnalysis).toHaveBeenLastCalledWith("b");
    expect(screen.queryByText(/pattern changed/i)).toBeNull();
    expect(screen.getByText("Reachable subset-DFA states")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("verifies multiple selected epsilon deletions together and displays the witness", () => {
    const verifyCandidate = vi.fn(() => differentCandidate);
    renderPanel("a|a", twoEdgeNfa, vi.fn(() => analysis), verifyCandidate);

    fireEvent.click(screen.getByRole("button", { name: /explore subset growth/i }));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const verifyButton = screen.getByRole("button", { name: "Verify 2 deletions" });
    fireEvent.click(verifyButton);

    expect(verifyCandidate).toHaveBeenCalledWith("a|a", [
      { source: 0, target: 1 },
      { source: 0, target: 2 },
    ]);
    expect(screen.getByText(/Shortest distinguishing input:/)).toBeTruthy();
    expect(screen.getByText('"a"')).toBeTruthy();
  });
});
