/**
 * RegexLab — Core Engine Data Contracts
 *
 * Defined once, up front, so every pass (Parser -> Thompson -> Subset
 * Construction -> Minimization -> Matcher) builds against a stable
 * interface. See CLAUDE.md v2 §7.
 *
 * ---------------------------------------------------------------------
 * Formal Grammar (CLAUDE.md v2 §6)
 * ---------------------------------------------------------------------
 *
 *   regex      ::= term ('|' term)*
 *   term       ::= factor+
 *   factor     ::= atom quantifier?
 *   quantifier ::= '*' | '+' | '?'
 *   atom       ::= CHAR
 *                | '(' regex ')'
 *                | '[' charclass ']'
 *   charclass  ::= CHAR ('-' CHAR)? (CHAR ('-' CHAR)?)*
 *
 * Precedence (loosest to tightest binding): '|'  <  concatenation  <  '*'
 *
 * CORE SCOPE ONLY (CLAUDE.md v2 §11): char, concat, '|', '*', '()'.
 * '+', '?', and '[a-z]' character classes are explicit Stretch A / B —
 * NOT implemented in ParserPass yet. Do not add them until Core is
 * fully working and both of you can explain this parser without notes.
 * ---------------------------------------------------------------------
 */

/** Abstract Syntax Tree produced by ParserPass. */
export type ASTNode =
  | { kind: "char"; value: string }
  | { kind: "concat"; left: ASTNode; right: ASTNode }
  | { kind: "alt"; left: ASTNode; right: ASTNode }
  | { kind: "star"; child: ASTNode };

/**
 * Structured parse failure. This is the object the AI Suggestion Layer
 * (§12) consumes — it is never handed raw exception text.
 */
export type ParseError = {
  type: "UnmatchedParen" | "UnexpectedToken" | "EmptyGroup" | "DanglingOperator";
  position: number;
  expected?: string;
  found?: string;
};

/** Result type every pass in the pipeline returns instead of throwing. */
export type ParseResult =
  | { ok: true; ast: ASTNode }
  | { ok: false; error: ParseError };

/**
 * States are integers, not strings — array/map-backed for O(1) access.
 * Produced by ThompsonPass (as an NFA) and again by SubsetConstructionPass
 * / MinimizationPass (as a DFA / min-DFA) — same shape reused across passes.
 */
export type Automaton = {
  stateCount: number;
  startState: number;
  acceptStates: Set<number>;
  /** state -> (symbol | "eps") -> [destination states] */
  transitions: Map<number, Map<string, number[]>>;
};

/** Produced by MatcherPass; drives the SVG playback animation. */
export type MatchTrace = {
  steps: { char: string; activeStates: number[] }[];
  result: "match" | "no-match";
  failurePosition?: number;
};