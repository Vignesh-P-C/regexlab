/** Shared guards for expansion-heavy automata passes. */
export const MAX_NFA_STATES = 2_048;
// See minimization-pass.ts's work-budget comment for the full derivation
// (measured pre-compression WASM timing, ~9.27M rounded down for margin).
export const MAX_MINIMIZATION_WORK_UNITS = 10_000_000;
export const MAX_SUBSET_TRACE_STEPS = 50_000;

/** Raised when a valid pattern would exceed a pass's explicit safety budget. */
export class AutomatonTooComplexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomatonTooComplexError";
  }
}
