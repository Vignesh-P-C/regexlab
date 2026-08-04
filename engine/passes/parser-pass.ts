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

class Parser {
  private pos = 0;

  constructor(private readonly pattern: string) {}

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

      const inner = this.parseRegex();

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
      this.advance();
      return { kind: "char", value: escaped };
    }

    this.advance();
    return { kind: "char", value: c };
  }

  parse(): ParseResult {
    try {
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
export function parse(pattern: string): ParseResult {
  return new Parser(pattern).parse();
}