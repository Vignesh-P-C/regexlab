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

describe("ParserPass — nesting depth guard", () => {
  // The 500-char length cap would trip first on these long patterns, so lift
  // it: these tests target the depth guard specifically.
  const liftedLength = { maxPatternLength: 1_000_000 };
  const nested = (depth: number) => "(".repeat(depth) + "a" + ")".repeat(depth);

  it("nesting well under the limit still parses normally", () => {
    expect(parse(nested(500), liftedLength).ok).toBe(true);
  });

  it("nesting exactly at the limit parses", () => {
    expect(parse(nested(1000), liftedLength).ok).toBe(true);
  });

  it("one level past the limit is rejected by the depth guard", () => {
    const r = parse(nested(1001), liftedLength);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe("PatternTooComplex");
      expect(r.error.position).toBe(1000);
      expect(r.error.expected).toBe("nesting depth <= 1000");
    }
  });

  it("far past the limit fails gracefully as PatternTooComplex", () => {
    const r = parse(nested(1500), liftedLength);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe("PatternTooComplex");
    }
  });
});

describe("ParserPass — pattern length guard", () => {
  it("a pattern exactly at the cap parses", () => {
    expect(parse("a".repeat(500)).ok).toBe(true);
  });

  it("one character past the cap is rejected with a length error", () => {
    expect(parse("a".repeat(501))).toEqual({
      ok: false,
      error: {
        type: "PatternTooComplex",
        position: 500,
        expected: "pattern length <= 500",
        found: "longer pattern",
      },
    });
  });

  it("applies to every shape, not just plain literals", () => {
    const alternation = Array(251).fill("a").join("|"); // 501 chars
    const stars = "a*".repeat(251); // 502 chars
    expect(alternation.length).toBe(501);
    for (const pattern of [alternation, stars]) {
      const r = parse(pattern);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.type).toBe("PatternTooComplex");
    }
  });

  it("the length cap is checked before anything else", () => {
    // 501 chars that would otherwise be a syntax error at position 0.
    const r = parse(")" + "a".repeat(500));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe("PatternTooComplex");
  });

  it("max nesting reachable under the default cap stays far below the depth limit", () => {
    // 249 pairs + 'a' = 499 chars: parses fine, and 249 << 1000, which is why
    // the depth guard is unreachable through default limits.
    const pattern = "(".repeat(249) + "a" + ")".repeat(249);
    expect(pattern.length).toBe(499);
    expect(parse(pattern).ok).toBe(true);
  });

  it("custom limits are honored", () => {
    expect(parse("abcde", { maxPatternLength: 5 }).ok).toBe(true);
    const r = parse("abcdef", { maxPatternLength: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.position).toBe(5);
      expect(r.error.expected).toBe("pattern length <= 5");
    }
  });
});
