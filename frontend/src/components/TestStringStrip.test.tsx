// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import type { Automaton } from "../types/engine";
import { computeDfaSteps } from "../lib/steps";
import { TestStringStrip } from "./TestStringStrip";

afterEach(cleanup);

const dfa: Automaton = {
  stateCount: 3,
  startState: 0,
  acceptStates: [2],
  transitions: { "0": { a: [1] }, "1": { b: [2] } },
};

describe("TestStringStrip stuck-character marker", () => {
  it("marks the failed character, preserves the consumed prefix, and leaves later input unconsumed", () => {
    const input = "abxq";
    const steps = computeDfaSteps(dfa, input);
    const stuckIndex = steps.length - 1;

    render(createElement(TestStringStrip, { input, steps, stepIndex: stuckIndex, verdict: "stuck" }));
    const chars = document.querySelector(".chars")!.children;

    expect(chars[0].classList.contains("consumed")).toBe(true);
    expect(chars[1].classList.contains("consumed")).toBe(true);
    expect(chars[2].classList.contains("stuck")).toBe(true);
    expect(chars[3].classList.contains("not-yet")).toBe(true);
  });

  it("keeps the next character marker on a nonterminal successful playback step", () => {
    const input = "ab";
    const steps = computeDfaSteps(dfa, input);

    render(createElement(TestStringStrip, { input, steps, stepIndex: 1, verdict: "match" }));
    const chars = document.querySelector(".chars")!.children;

    expect(chars[0].classList.contains("consumed")).toBe(true);
    expect(chars[1].classList.contains("next")).toBe(true);
  });
});
