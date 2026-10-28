// Mirrors the C++ JSON contract. A charset AST node carries its ASCII set as codes.
export type ASTNode =
  | { kind: "char"; value: string }
  | { kind: "charset"; characters: number[]; label: string }
  | { kind: "concat"; left: ASTNode; right: ASTNode }
  | { kind: "alt"; left: ASTNode; right: ASTNode }
  | { kind: "star"; child: ASTNode }
  | { kind: "plus"; child: ASTNode }
  | { kind: "optional"; child: ASTNode };
export type Automaton = {
  stateCount: number; startState: number; acceptStates: number[];
  /** Edge keys: ASCII char, "eps", or "cs:" plus 32 hex digits. */
  transitions: Record<string, Record<string, number[]>>;
};
export type MatchStep = { ch: string; activeStates: number[] };
export type MatchTrace = { steps: MatchStep[]; result: "match" | "no-match"; failurePosition: number | null };
export type ParseErrorType = "UnmatchedParen" | "UnexpectedToken" | "EmptyGroup" | "DanglingOperator" | "PatternTooComplex" | "InvalidCharacterClass" | "AutomatonTooComplex";
export type ParseError = { type: ParseErrorType; position: number; expected: string | null; found: string | null; message?: string };
export type PipelineSnapshot =
  | { ok: true; ast: ASTNode; nfa: Automaton; dfa: Automaton; minDfa: Automaton; trace: MatchTrace }
  | { ok: false; error: ParseError };
export type Stage = "ast" | "nfa" | "dfa" | "minDfa";

// issue #68 — Subset Growth / NFA Structure Lab (PR A). Additive —
// mirrors engine/growth-types.ts / growth-types.hpp field for field.
export type SubsetConstructionStep = {
  sourceId: number;
  sourceNfaStates: number[];
  symbol: string;
  moveNfaStates: number[];
  closureNfaStates: number[];
  targetId: number;
  isNew: boolean;
  isAccepting: boolean;
};
export type SubsetTrace = { steps: SubsetConstructionStep[]; subsetCount: number };
export type AutomatonMetrics = {
  rawStateCount: number; reachableStateCount: number; trimStateCount: number;
  epsilonEdgeCount: number; consumingEdgeCount: number; totalTransitionCount: number; alphabetSize: number;
};
export type PowersetCeiling = { exponent: number; exactDecimal: string };
export type BoundResult =
  | { status: "not-computed"; reason: string }
  | { status: "computed"; representation: string; method: string; value: string };
export type GrowthAnalysis = {
  nfaMetrics: AutomatonMetrics;
  subsetTrace: SubsetTrace;
  reachableSubsetStateCount: number;
  minimizedStateCount: number;
  powersetCeiling: PowersetCeiling;
  bound: BoundResult;
};
export type GrowthAnalysisResult = { ok: true; analysis: GrowthAnalysis } | { ok: false; error: ParseError };

export type EquivalenceWitness = { word: string; isEmpty: boolean; baselineAccepts: boolean; candidateAccepts: boolean };
export type EquivalenceResult =
  | { status: "equivalent" }
  | { status: "different"; witness: EquivalenceWitness }
  | { status: "inconclusive"; reason: string };
// Candidate edges come from the epsilon-only selector, so the symbol is implicit at this UI boundary.
export type CandidateEdgeId = { source: number; target: number };
export type CandidateEditError = { type: "InvalidCandidateEdit"; message: string };
export type CandidateResult = { nfa: Automaton; metrics: AutomatonMetrics; equivalence: EquivalenceResult };
export type CandidateResponse =
  | { ok: true; candidate: CandidateResult }
  | { ok: false; error: ParseError | CandidateEditError };

export type BoundedSearchLimits = {
  maxEligibleEdges: number; maxEditDepth: number; maxCandidates: number;
  maxDfaStates: number; maxWorkUnitsPerCheck: number; maxProductStatePairs: number;
};
export type BoundedAutomatonMetrics = {
  nfa: AutomatonMetrics;
  reachableSubsetStateCount: number | null;
  minimizedStateCount: number | null;
  subsetAnalysisReason: string | null;
  minimizationReason: string | null;
};
export type BoundedOptimizationCandidate = {
  id: string;
  edits: { source: number; symbol: "eps"; target: number }[];
  nfa: Automaton;
  metrics: BoundedAutomatonMetrics;
  equivalence: EquivalenceResult;
  minimizedStateCountMatchesBaseline: boolean | null;
};
export type BoundedOptimizationStopReason =
  | "eligible-edge-limit" | "candidate-limit" | "baseline-inconclusive";
export type BoundedOptimizationResult = {
  limits: BoundedSearchLimits;
  totalEligibleEdgeCount: number; consideredEdgeCount: number;
  searchSpaceCandidateCount: number; generatedCandidateCount: number;
  evaluatedCandidateCount: number; equivalentCandidateCount: number;
  differentCandidateCount: number; inconclusiveCandidateCount: number;
  duplicateAutomataSkipped: number;
  stopReasons: BoundedOptimizationStopReason[];
  baselineMetrics: BoundedAutomatonMetrics;
  candidates: BoundedOptimizationCandidate[];
  paretoFrontierIds: string[];
};
export type BoundedOptimizationResponse =
  | { ok: true; search: BoundedOptimizationResult }
  | { ok: false; error: ParseError };
