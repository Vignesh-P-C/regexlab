// Mirrors the JSON contract in engine/include/regexlab/json_bridge.hpp —
// keep these in sync if that shape changes.

export type ASTNode =
  | { kind: "char"; value: string }
  | { kind: "concat"; left: ASTNode; right: ASTNode }
  | { kind: "alt"; left: ASTNode; right: ASTNode }
  | { kind: "star"; child: ASTNode };

export type Automaton = {
  stateCount: number;
  startState: number;
  acceptStates: number[];
  transitions: Record<string, Record<string, number[]>>; // stateId -> symbol|"eps" -> [targets]
};

export type MatchStep = { ch: string; activeStates: number[] };

export type MatchTrace = {
  steps: MatchStep[];
  result: "match" | "no-match";
  failurePosition: number | null;
};

export type ParseErrorType =
  | "UnmatchedParen"
  | "UnexpectedToken"
  | "EmptyGroup"
  | "DanglingOperator"
  | "PatternTooComplex";

export type ParseError = {
  type: ParseErrorType;
  position: number;
  expected: string | null;
  found: string | null;
};

export type PipelineSnapshot =
  | { ok: true; ast: ASTNode; nfa: Automaton; dfa: Automaton; minDfa: Automaton; trace: MatchTrace }
  | { ok: false; error: ParseError };

export type Stage = "ast" | "nfa" | "dfa" | "minDfa";
