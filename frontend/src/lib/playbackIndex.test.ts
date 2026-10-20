import { describe, it, expect } from "vitest";
import { clampStepIndex } from "./playbackIndex";

describe("clampStepIndex (#52)", () => {
  it("passes a valid index through unchanged", () => {
    expect(clampStepIndex(2, 5)).toBe(2);
  });

  it("clamps down to the last valid index when the requested index is too large", () => {
    expect(clampStepIndex(5, 3)).toBe(2);
  });

  it("clamps a negative index up to 0", () => {
    expect(clampStepIndex(-1, 5)).toBe(0);
  });

  it("clamps to 0 for an empty step array", () => {
    expect(clampStepIndex(5, 0)).toBe(0);
  });

  it("a single-step array always clamps to 0", () => {
    expect(clampStepIndex(0, 1)).toBe(0);
    expect(clampStepIndex(3, 1)).toBe(0);
  });
});
