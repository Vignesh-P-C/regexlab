// #52: the shared playback-step index rule. NFA/DFA/min-DFA share one
// "chars consumed" index; switching to a tab whose own step array is
// shorter (it got stuck sooner) must clamp the displayed step rather than
// show an invalid index or silently reset to 0 and lose the user's place.

/** Clamp a requested step index into [0, stepCount - 1]. An empty step
 *  array (stepCount <= 0) clamps to 0 -- callers always have at least a
 *  "step 0" entry in practice, but this stays total either way. */
export function clampStepIndex(index: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.max(0, Math.min(index, stepCount - 1));
}
