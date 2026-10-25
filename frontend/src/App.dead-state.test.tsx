// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { PipelineSnapshot } from "./types/engine";

const mockEngine = vi.hoisted(() => ({
  value: {
    state: { status: "ready" as const },
    runPipeline: vi.fn(),
    runGrowthAnalysis: vi.fn(),
    verifyCandidateEdges: vi.fn(),
    runBoundedOptimization: vi.fn(),
  },
}));

vi.mock("./hooks/useRegexEngine", () => ({
  useRegexEngine: () => mockEngine.value,
}));

import App from "./App";

afterEach(cleanup);

const snapshot: PipelineSnapshot = {
  ok: true,
  ast: {
    kind: "star",
    child: {
      kind: "alt",
      left: { kind: "char", value: "a" },
      right: { kind: "plus", child: { kind: "char", value: "b" } },
    },
  },
  nfa: {
    stateCount: 2,
    startState: 0,
    acceptStates: [1],
    transitions: { "0": { eps: [1] } },
  },
  dfa: {
    stateCount: 2,
    startState: 0,
    acceptStates: [0, 1],
    transitions: { "0": { a: [1], b: [1] }, "1": { a: [1], b: [1] } },
  },
  minDfa: {
    stateCount: 1,
    startState: 0,
    acceptStates: [0],
    transitions: { "0": { a: [0], b: [0] } },
  },
  trace: { steps: [], result: "no-match", failurePosition: 2 },
};

beforeEach(() => {
  mockEngine.value.runPipeline.mockReturnValue(snapshot);
  mockEngine.value.runGrowthAnalysis.mockReturnValue(null);
  mockEngine.value.verifyCandidateEdges.mockReturnValue(null);
  mockEngine.value.runBoundedOptimization.mockReturnValue(null);
});

describe("App dead-state playback integration", () => {
  it("shows the sink on DFA/min-DFA failure, highlights the failed char, and keeps NFA sink-free", async () => {
    render(createElement(App));
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "(a|b+)*" } });
    fireEvent.change(textboxes[1], { target: { value: "aac" } });
    await waitFor(() => expect(mockEngine.value.runPipeline).toHaveBeenCalled());

    for (const [tabName, sinkId] of [["DFA", "2"], ["min-DFA", "1"]]) {
      fireEvent.click(screen.getByRole("tab", { name: tabName }));
      fireEvent.change(screen.getByRole("slider", { name: "Playback step" }), { target: { value: "3" } });
      await waitFor(() => {
        expect(document.querySelector('[data-state-id="' + sinkId + '"]')?.classList.contains("dead")).toBe(true);
        expect(screen.getByText("⊥")).toBeTruthy();
      });
      const chars = document.querySelector(".test-string-strip .chars")!.children;
      expect(chars[0].classList.contains("consumed")).toBe(true);
      expect(chars[1].classList.contains("consumed")).toBe(true);
      expect(chars[2].classList.contains("stuck")).toBe(true);
      expect(document.querySelector('[data-state-id="' + sinkId + '"]')?.classList.contains("accept")).toBe(false);
    }

    fireEvent.click(screen.getByRole("tab", { name: "NFA" }));
    await waitFor(() => expect(document.querySelectorAll(".state.dead")).toHaveLength(0));
    expect(screen.queryByText("⊥")).toBeNull();
  });
});
