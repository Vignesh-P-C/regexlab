// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { Stage } from "../types/engine";
import { PlaybackControls } from "./PlaybackControls";

afterEach(cleanup);

type Overrides = Partial<{
  activeStage: Stage;
  stepCount: number;
  activeStep: number;
  caption: string;
  tooLong: boolean;
}>;

function renderControls(overrides: Overrides = {}) {
  const props = {
    activeStage: "nfa" as Stage,
    onStageChange: vi.fn(),
    stepCount: 4,
    activeStep: 0,
    onStepChange: vi.fn(),
    caption: "ε-closure of {0} = {0}",
    tooLong: false,
    ...overrides,
  };
  render(createElement(PlaybackControls, props));
  return props;
}

describe("PlaybackControls (#52)", () => {
  it("exposes all four stages as named tabs and reports stage selection", () => {
    const { onStageChange } = renderControls();

    expect(screen.getByRole("tablist", { name: "Playback stage" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "AST",
      "NFA",
      "DFA",
      "min-DFA",
    ]);
    expect(screen.getByRole("tab", { name: "NFA" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "DFA" }));
    expect(onStageChange).toHaveBeenCalledWith("dfa");
  });

  it("keeps the range and arrow controls in sync with the supplied step bounds", () => {
    const { onStepChange } = renderControls({ activeStep: 2, stepCount: 5 });
    const previous = screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement;
    const slider = screen.getByRole("slider", { name: "Playback step" }) as HTMLInputElement;

    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("4");
    expect(slider.value).toBe("2");
    expect(screen.getByText("step 2 of 4")).toBeTruthy();

    fireEvent.click(next);
    expect(onStepChange).toHaveBeenLastCalledWith(3);
    fireEvent.change(slider, { target: { value: "1" } });
    expect(onStepChange).toHaveBeenLastCalledWith(1);
  });

  it("disables playback controls when a non-AST input exceeds the playback cap", () => {
    renderControls({ activeStage: "dfa", tooLong: true });

    expect(screen.getByText(/longer than playback supports/i)).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Playback step" })).toBeNull();
    expect(screen.queryByText(/ε-closure/)).toBeNull();
  });

  it("keeps AST playback available when the test string exceeds the cap", () => {
    renderControls({ activeStage: "ast", tooLong: true, caption: "char 'a': single-transition fragment" });

    expect(screen.getByRole("slider", { name: "Playback step" })).toBeTruthy();
    expect(screen.queryByText(/longer than playback supports/i)).toBeNull();
    expect(screen.getByText("char 'a': single-transition fragment")).toBeTruthy();
  });

  it("disables arrows at the first and last playback steps", () => {
    renderControls({ activeStep: 0, stepCount: 4 });
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();

    renderControls({ activeStep: 3, stepCount: 4 });
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
