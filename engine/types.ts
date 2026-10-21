/** RegexLab contracts. Charset transition labels use the "cs:<32 hex>" protocol. */
export type ASTNode =
  | { kind: "char"; value: string }
  | { kind: "charset"; characters: number[]; label: string }
  | { kind: "concat"; left: ASTNode; right: ASTNode }
  | { kind: "alt"; left: ASTNode; right: ASTNode }
  | { kind: "star"; child: ASTNode }
  | { kind: "plus"; child: ASTNode }
  | { kind: "optional"; child: ASTNode };
export type ParseError = {
  type: "UnmatchedParen" | "UnexpectedToken" | "EmptyGroup" | "DanglingOperator" | "PatternTooComplex" | "InvalidCharacterClass" | "AutomatonTooComplex";
  position: number; expected?: string; found?: string;
};
export type ParseResult = { ok: true; ast: ASTNode } | { ok: false; error: ParseError };
export type Automaton = { stateCount: number; startState: number; acceptStates: Set<number>; transitions: Map<number, Map<string, number[]>> };
export type MatchTrace = { steps: { char: string; activeStates: number[] }[]; result: "match" | "no-match"; failurePosition?: number };
