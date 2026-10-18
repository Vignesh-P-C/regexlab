/**
 * ParserPass — CLAUDE.md v2 §8 (first stage of the pipeline)
 *
 * Algorithm: recursive-descent parsing, one function per grammar
 * production. This directly mirrors the "predictive parser" technique
 * from Aho/Lam/Sethi/Ullman (the prescribed BCSE307L textbook), applied
 * to the grammar in types.ts.
 *
 * Design choices worth being able to defend in a viva:
 *   - '|' binds loosest, then concatenation, then '*' — enforced purely
 *     by which grammar production calls which (parseRegex calls
 *     parseTerm calls parseFactor calls parseAtom), NOT by a precedence
 *     table. This is the textbook way recursive descent encodes
 *     precedence: tighter-binding operators live deeper in the call chain.
 *   - Both '|' (alt) and concatenation are built LEFT-ASSOCIATIVE here
 *     (a loop, not right-recursion) — e.g. "a|b|c" becomes
 *     alt(alt(a,b),c). This doesn't change the language accepted
 *     (both operations are associative for regular languages) but it's
 *     a concrete implementation choice you should be able to name.
 *   - Errors are thrown internally as ParseFailure and caught once at
 *     the top of parse(), so every recursive helper can stay simple and
 *     just "throw on trouble" instead of threading Result types through
 *     every call.
 *
 * ONE ADDITION BEYOND THE WRITTEN GRAMMAR: backslash-escaping (e.g. `\(`
 * matches a literal '('). The grammar's CHAR production doesn't exclude
 * this, but it's not spelled out either — flagging it explicitly per
 * CLAUDE.md v2 §0.1 rule 5. It's cheap (a few lines) and lets you write
 * test patterns that contain literal metacharacters. Remove it if you'd
 * rather stay strictly literal to the grammar as written.
 */

import type { ASTNode, ParseError, ParseResult } from "../types.js";

class ParseFailure extends Error {
  constructor(public readonly parseError: ParseError) {
    super(`${parseError.type} at position ${parseError.position}`);
  }
}

/**
 * Safety limits on what the parser will accept. Mirrors ParseLimits in
 * parser-pass.hpp. Production code uses the defaults; the parameter exists
 * so tests can lift one limit to exercise the other (under default limits the
 * parser never consumes more than maxPatternLength units — see
 * exceedsLengthCap — so the depth guard is unreachable and is kept as
 * defense in depth).
 */
export const DEFAULT_MAX_PATTERN_LENGTH = 500;
export const DEFAULT_MAX_NESTING_DEPTH = 1000;

export type ParseLimits = {
  maxPatternLength: number;
  maxNestingDepth: number;
};

const DEFAULT_LIMITS: ParseLimits = {
  maxPatternLength: DEFAULT_MAX_PATTERN_LENGTH,
  maxNestingDepth: DEFAULT_MAX_NESTING_DEPTH,
};

class Parser {
  // Two guards keep recursion bounded (mirrors parser-pass.cpp):
  //  - maxNestingDepth: thousands of '(' in a row fail as a normal
  //    ParseError instead of blowing the call stack.
  //  - maxPatternLength: the depth guard only counts '(', but long chains of
  //    plain concatenation/alternation build equally deep ASTs (depth =
  //    pattern length). 500 is sized from measurements (see issue #29 and
  //    the comment in parser-pass.cpp). It applies to an all-ASCII prefix
  //    only — see exceedsLengthCap for why.

  private pos = 0;
  private depth = 0;

  constructor(
    private readonly pattern: string,
    private readonly limits: ParseLimits,
  ) {}

  private peek(): string | undefined {
    return this.pattern[this.pos];
  }

  private advance(): string {
    return this.pattern[this.pos++];
  }

  /** regex ::= term ('|' term)* */
  private parseRegex(): ASTNode {
    let node = this.parseTerm();
    while (this.peek() === "|") {
      this.advance();
      const right = this.parseTerm();
      node = { kind: "alt", left: node, right };
    }
    return node;
  }

  /** term ::= factor+  (one or more factors, concatenated) */
  private parseTerm(): ASTNode {
    let node = this.parseFactor();
    while (this.canStartFactor()) {
      const right = this.parseFactor();
      node = { kind: "concat", left: node, right };
    }
    return node;
  }

  /**
   * Does the length cap apply to this pattern?
   *
   * The cap counts units, and the two engines count different ones: TS counts
   * UTF-16 code units, C++ counts UTF-8 bytes. Comparing a raw length against
   * the cap therefore diverged on non-ASCII input — "é" x 300 is 300 units but
   * 600 bytes, so TS parsed it and C++ called it too long (issue #36).
   *
   * The fix is to apply the cap only to an all-ASCII prefix. Inside such a
   * prefix one unit is exactly one byte, so both engines measure the same
   * thing and the divergence disappears by construction.
   *
   * Skipping the cap is safe: positions 0..cap are then known to contain a
   * non-ASCII unit, and requireAscii rejects the first one the parser reaches,
   * so at most `cap` units are ever consumed and recursion stays bounded no
   * matter how long the rest of the pattern is. Verified in both engines for
   * literals, groups and escapes.
   *
   * Mirrors exceedsLengthCap in parser-pass.cpp.
   */
  private exceedsLengthCap(): boolean {
    const cap = this.limits.maxPatternLength;
    if (this.pattern.length <= cap) return false;
    // pattern.length > cap, so indices 0..cap all exist.
    for (let i = 0; i <= cap; i++) {
      if (this.pattern.charCodeAt(i) > 0x7f) return false;
    }
    return true;
  }

  /**
   * The engine's alphabet is ASCII (code units 0x00-0x7F). A unit > 0x7F is
   * rejected where a literal would be consumed, so the leftmost error in the
   * pattern still wins. Mirrors requireAscii in parser-pass.cpp; `found` is a
   * fixed description, never the raw character (see D4).
   */
  private requireAscii(c: string, position: number): void {
    if (c.charCodeAt(0) > 0x7f) {
      throw new ParseFailure({
        type: "UnexpectedToken",
        position,
        expected: "an ASCII character",
        found: "non-ASCII character",
      });
    }
  }

  /** Lookahead helper: could the next token legally start a new factor? */
  private canStartFactor(): boolean {
    const c = this.peek();
    return c !== undefined && c !== "|" && c !== ")";
  }

  /** factor ::= atom quantifier?   (quantifier restricted to '*' in Core scope) */
  private parseFactor(): ASTNode {
    const atom = this.parseAtom();
    if (this.peek() === "*") {
      this.advance();
      return { kind: "star", child: atom };
    }
    return atom;
  }

  /**
   * atom ::= CHAR | '(' regex ')'
   * ('[' charclass ']' is Stretch B — not implemented yet, see types.ts)
   */
  private parseAtom(): ASTNode {
    const c = this.peek();

    if (c === undefined) {
      throw new ParseFailure({
        type: "UnexpectedToken",
        position: this.pos,
        expected: "a character or '('",
        found: "end of input",
      });
    }

    if (c === "(") {
      const openParenPos = this.pos;
      this.advance();

      if (this.peek() === ")") {
        throw new ParseFailure({
          type: "EmptyGroup",
          position: this.pos,
          expected: "a pattern before ')'",
          found: ")",
        });
      }

      if (++this.depth > this.limits.maxNestingDepth) {
        throw new ParseFailure({
          type: "PatternTooComplex",
          position: openParenPos,
          expected: `nesting depth <= ${this.limits.maxNestingDepth}`,
          found: "deeper group nesting",
        });
      }
      const inner = this.parseRegex();
      this.depth--;

      if (this.peek() !== ")") {
        throw new ParseFailure({
          type: "UnmatchedParen",
          position: openParenPos,
          expected: "')'",
          found: this.peek() ?? "end of input",
        });
      }
      this.advance(); // consume ')'
      return inner;
    }

    if (c === "|" || c === "*" || c === ")") {
      // An operator appearing where an atom was expected has nothing to
      // apply to — e.g. "*ab", "a||b", "a**" (second '*'), "()" handled above.
      throw new ParseFailure({
        type: "DanglingOperator",
        position: this.pos,
        expected: "a character or '('",
        found: c,
      });
    }

    if (c === "\\") {
      const escapePos = this.pos;
      this.advance();
      const escaped = this.peek();
      if (escaped === undefined) {
        throw new ParseFailure({
          type: "UnexpectedToken",
          position: escapePos,
          expected: "a character after '\\'",
          found: "end of input",
        });
      }
      this.requireAscii(escaped, this.pos);
      this.advance();
      return { kind: "char", value: escaped };
    }

    this.requireAscii(c, this.pos);
    this.advance();
    return { kind: "char", value: c };
  }

  parse(): ParseResult {
    try {
      if (this.exceedsLengthCap()) {
        throw new ParseFailure({
          type: "PatternTooComplex",
          position: this.limits.maxPatternLength,
          expected: `pattern length <= ${this.limits.maxPatternLength}`,
          found: "longer pattern",
        });
      }

      const ast = this.parseRegex();

      if (this.pos < this.pattern.length) {
        const c = this.pattern[this.pos];
        if (c === ")") {
          throw new ParseFailure({
            type: "UnmatchedParen",
            position: this.pos,
            expected: "end of input",
            found: ")",
          });
        }
        throw new ParseFailure({
          type: "UnexpectedToken",
          position: this.pos,
          expected: "end of input",
          found: c,
        });
      }

      return { ok: true, ast };
    } catch (e) {
      if (e instanceof ParseFailure) {
        return { ok: false, error: e.parseError };
      }
      throw e;
    }
  }
}

/** ParserPass entry point: string in, ParseResult out. Pure, no side effects. */
export function parse(pattern: string, limits: Partial<ParseLimits> = {}): ParseResult {
  return new Parser(pattern, { ...DEFAULT_LIMITS, ...limits }).parse();
}
