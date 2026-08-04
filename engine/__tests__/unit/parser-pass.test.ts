import { describe, it, expect } from "vitest";
import { parse } from "../../passes/parser-pass.js";
import type { ASTNode } from "../../types.js";

const char = (v: string): ASTNode => ({ kind: "char", value: v });
const concat = (l: ASTNode, r: ASTNode): ASTNode => ({ kind: "concat", left: l, right: r });
const alt = (l: ASTNode, r: ASTNode): ASTNode => ({ kind: "alt", left: l, right: r });
const star = (c: ASTNode): ASTNode => ({ kind: "star", child: c });

describe("ParserPass — valid patterns (golden AST shapes)", () => {
  it("single char", () => {
    const r = parse("a");
    expect(r).toEqual({ ok: true, ast: char("a") });
  });

  it("concatenation is left-associative", () => {
    const r = parse("abc");
    expect(r).toEqual({ ok: true, ast: concat(concat(char("a"), char("b")), char("c")) });
  });

  it("alternation is left-associative", () => {
    const r = parse("a|b|c");
    expect(r).toEqual({ ok: true, ast: alt(alt(char("a"), char("b")), char("c")) });
  });

  it("star binds tighter than concatenation", () => {
    // "ab*" means a, then (b)* — NOT (ab)*
    const r = parse("ab*");
    expect(r).toEqual({ ok: true, ast: concat(char("a"), star(char("b"))) });
  });

  it("concatenation binds tighter than alternation", () => {
    // "ab|c" means (ab)|c — NOT a(b|c)
    const r = parse("ab|c");
    expect(r).toEqual({ ok: true, ast: alt(concat(char("a"), char("b")), char("c")) });
  });

  it("parentheses override precedence", () => {
    const r = parse("(a|b)*");
    expect(r).toEqual({ ok: true, ast: star(alt(char("a"), char("b"))) });
  });

  it("nested groups", () => {
    const r = parse("((a))");
    expect(r).toEqual({ ok: true, ast: char("a") });
  });

  it("backslash-escapes a metacharacter into a literal char", () => {
    const r = parse("\\(");
    expect(r).toEqual({ ok: true, ast: char("(") });
  });
});

describe("ParserPass — malformed patterns (golden ParseError shapes)", () => {
  it("empty pattern", () => {
    const r = parse("");
    expect(r).toEqual({
      ok: false,
      error: { type: "UnexpectedToken", position: 0, expected: "a character or '('", found: "end of input" },
    });
  });

  it("unmatched opening paren", () => {
    const r = parse("(a");
    expect(r).toEqual({
      ok: false,
      error: { type: "UnmatchedParen", position: 0, expected: "')'", found: "end of input" },
    });
  });

  it("unmatched closing paren", () => {
    const r = parse("a)");
    expect(r).toEqual({
      ok: false,
      error: { type: "UnmatchedParen", position: 1, expected: "end of input", found: ")" },
    });
  });

  it("empty group", () => {
    const r = parse("()");
    expect(r).toEqual({
      ok: false,
      error: { type: "EmptyGroup", position: 1, expected: "a pattern before ')'", found: ")" },
    });
  });

  it("leading star has nothing to repeat", () => {
    const r = parse("*a");
    expect(r).toEqual({
      ok: false,
      error: { type: "DanglingOperator", position: 0, expected: "a character or '('", found: "*" },
    });
  });

  it("double alternation operator", () => {
    const r = parse("a||b");
    expect(r).toEqual({
      ok: false,
      error: { type: "DanglingOperator", position: 2, expected: "a character or '('", found: "|" },
    });
  });

  it("trailing backslash with nothing to escape", () => {
    const r = parse("a\\");
    expect(r).toEqual({
      ok: false,
      error: { type: "UnexpectedToken", position: 1, expected: "a character after '\\'", found: "end of input" },
    });
  });
});