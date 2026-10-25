// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { Automaton } from "../types/engine";
import { computeDfaSteps, withPlaybackDeadState } from "../lib/steps";
import { AutomatonView } from "./AutomatonView";

afterEach(cleanup);

describe("AutomatonView playback dead state", () => {
  it("draws an active rejecting sink with the failed edge and Sigma self-loop", () => {
    const dfa: Automaton = {
      stateCount: 2,
      startState: 0,
      acceptStates: [1],
      transitions: { "0": { a: [1] } },
    };
    const failed = computeDfaSteps(dfa, "b").at(-1)!;
    const displayDfa = withPlaybackDeadState(dfa, failed);
    render(
      createElement(AutomatonView, {
        stage: "dfa",
        ast: null,
        automaton: displayDfa,
        activeStates: failed.activeStates,
        traversedEdges: failed.traversedEdges,
        astNodeIndex: null,
        deadStateId: dfa.stateCount,
      }),
    );

    expect(screen.getByText("⊥")).toBeTruthy();
    expect(screen.getByText("Σ")).toBeTruthy();
    expect(document.querySelector('[data-state-id="2"]')?.parentElement?.querySelector("title")?.textContent).toContain("Rejecting sink state");
    const deadNode = document.querySelector('[data-state-id="2"]');
    expect(deadNode?.classList.contains("state")).toBe(true);
    expect(deadNode?.classList.contains("dead")).toBe(true);
    expect(deadNode?.classList.contains("active")).toBe(true);
    expect(deadNode?.classList.contains("accept")).toBe(false);
    expect(document.querySelectorAll(".accept-ring")).toHaveLength(1);
    expect(document.querySelector(".automaton-svg path.traversed")).toBeTruthy();
  });
});
