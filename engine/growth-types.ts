/**
 * growth-types.ts — issue #68 (Subset Growth / NFA Structure Lab, PR A)
 *
 * Additive data contracts for the opt-in Growth/What-If analysis. None of
 * this is consumed by the existing runPipeline() path — it's a parallel,
 * explicitly-requested API (see RegexLab_Automata_Complexity_Optimization_Lab_Proposal.md
 * §7.1's "normal compile is not exhaustive search" principle). PR B (the
 * Bounded Optimization Explorer) is expected to reuse verifyCandidate()
 * and these types directly rather than re-implementing equivalence
 * checking — see engine/equivalence.ts's header comment for the exact
 * reusable entry point.
 */

import type { Automaton } from "./types.js";
import type { AutomatonMetrics } from "./automaton-metrics.js";

/** One step of the real Rabin–Scott subset-construction worklist. */
export type SubsetConstructionStep = {
  /** The DFA state id being processed (its NFA-state-set is in sourceNfaStates). */
  sourceId: number;
  /** The NFA states that make up the source DFA subset, sorted ascending. */
  sourceNfaStates: number[];
  symbol: string;
  /** move(sourceNfaStates, symbol) — before epsilon-closure, sorted ascending. */
  moveNfaStates: number[];
  /** epsilonClosure(moveNfaStates) — this IS the target DFA subset, sorted ascending. */
  closureNfaStates: number[];
  /** The DFA state id assigned to closureNfaStates. */
  targetId: number;
  /** True the first time this NFA-state-set was ever discovered. */
  isNew: boolean;
  /** True iff closureNfaStates intersects the NFA's accept states. */
  isAccepting: boolean;
};

export type SubsetTrace = {
  steps: SubsetConstructionStep[];
  /** Equal to the resulting DFA's stateCount — the actual, not estimated, reachable-subset count. */
  subsetCount: number;
};

export type PowersetCeiling = { exponent: number; exactDecimal: string };

/**
 * Status-bearing result for the research structural upper bound
 * (Baburin & Cotterell 2025, "A Close Analysis of the Subset
 * Construction" — subset complexity). PR A deliberately ships this as
 * "not-computed": the bound's own proof assumes an epsilon-free NFA, and
 * RegexLab's Thompson NFA is not epsilon-free, so applying the theorem
 * would require a semantics-preserving epsilon-free normalization that
 * has NOT been designed or correctness-reviewed yet (see the MD's §4.3,
 * a "required correctness gate"). Shipping a fabricated or unverified
 * number would violate the MD's explicit safety rule ("do not invent a
 * value"). `status` is a real field, not a placeholder — a future PR can
 * add a "computed" variant once the normalization is done.
 */
export type BoundResult =
  | { status: "not-computed"; reason: string }
  | { status: "computed"; representation: string; method: string; value: string };

export type GrowthAnalysis = {
  nfaMetrics: AutomatonMetrics;
  subsetTrace: SubsetTrace;
  /** The actual reachable subset-DFA state count — SAME number as subsetTrace.subsetCount, exposed again at the top level because it's one of the four headline counts (see #68's acceptance criteria: never conflate this with minimizedStateCount). */
  reachableSubsetStateCount: number;
  minimizedStateCount: number;
  powersetCeiling: PowersetCeiling;
  bound: BoundResult;
};

/**
 * A stable identity for one epsilon-edge relation. Deliberately content-
 * addressed (source/symbol/target), never an array index, so an edge's
 * identity survives any other edit elsewhere in the automaton — per the
 * MD §5.1: "record every edit as a stable operation ... rather than
 * relying on an ephemeral array index."
 */
export type CandidateEdgeId = { source: number; symbol: "eps"; target: number };

export type CandidateEdit =
  | { kind: "deleteEpsilonEdge"; edge: CandidateEdgeId }
  | { kind: "deleteEpsilonEdges"; edges: CandidateEdgeId[] };

export type EquivalenceWitness = {
  /** The actual input string; "" means the empty string (display as "ε" in the UI, not the literal word "epsilon"). */
  word: string;
  isEmpty: boolean;
  baselineAccepts: boolean;
  candidateAccepts: boolean;
};

export type EquivalenceResult =
  | { status: "equivalent" }
  | { status: "different"; witness: EquivalenceWitness }
  | { status: "inconclusive"; reason: string };

export type CandidateResult = {
  edits: CandidateEdit[];
  nfa: Automaton;
  metrics: AutomatonMetrics;
  equivalence: EquivalenceResult;
};
