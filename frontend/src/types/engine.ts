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
export type ParseErrorType = "UnmatchedParen" | "UnexpectedToken" | "EmptyGroup" | "DanglingOperator" | "PatternTooComplex" | "InvalidCharacterClass";
export type ParseError = { type: ParseErrorType; position: number; expected: string | null; found: string | null };
export type PipelineSnapshot =
  | { ok: true; ast: ASTNode; nfa: Automaton; dfa: Automaton; minDfa: Automaton; trace: MatchTrace }
  | { ok: false; error: ParseError };
export type Stage = "ast" | "nfa" | "dfa" | "minDfa";
