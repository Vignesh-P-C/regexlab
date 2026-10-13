// engine/__tests__/differential.test.ts
//
// TS-side counterpart of tests/differential_test.cpp (issue #15).
//
// Generates random-but-valid patterns directly from the engine's own AST
// building blocks (never random strings, which would mostly fail to parse and
// test nothing), serializes each to pattern text, runs it through the real
// TypeScript pipeline, and checks that the match result agrees with JavaScript's
// native RegExp on random test strings.
//
// Full-match semantics: this engine matches the WHOLE string, like
// std::regex_match. RegExp.test() finds a match ANYWHERE, so the oracle pattern
// is anchored as ^(?:pattern)$. Without the anchors this test would silently
// compare against partial-match semantics and pass for the wrong reason. The
// "oracle sanity" test below fails if the anchoring is ever dropped.

import { describe, it, expect } from "vitest";
import { parse } from "../passes/parser-pass.js";
import { thompsonConstruction } from "../passes/thompson-pass.js";
import { subsetConstruction } from "../passes/subset-construction-pass.js";
import { minimize } from "../passes/minimization-pass.js";
import { match } from "../passes/matcher-pass.js";
import type { ASTNode } from "../types.js";

// Set to a number (e.g. 1734000000000) to replay a failing run. Otherwise a
// fresh seed is used each run, like the C++ test's random_device, and is
// printed in every failure message.
const FIXED_SEED: number | null = null;
const SEED = FIXED_SEED ?? Date.now();

// mulberry32: tiny seeded PRNG, so any failure can be replayed exactly.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small alphabet, deliberately: random strings then share prefixes and
// structure with random patterns far more often, which is where DFA bugs hide.
const ALPHABET = "abcd";

function randomInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

function randomChar(rng: () => number): string {
  return ALPHABET[randomInt(rng, ALPHABET.length)];
}

/** Random AST from char / concat / alt / star, so it is parseable by construction. */
function randomAST(rng: () => number, maxDepth: number): ASTNode {
  if (maxDepth <= 0) return { kind: "char", value: randomChar(rng) };
  switch (randomInt(rng, 4)) {
    case 0:
      return { kind: "char", value: randomChar(rng) };
    case 1:
      return { kind: "concat", left: randomAST(rng, maxDepth - 1), right: randomAST(rng, maxDepth - 1) };
    case 2:
      return { kind: "alt", left: randomAST(rng, maxDepth - 1), right: randomAST(rng, maxDepth - 1) };
    default:
      return { kind: "star", child: randomAST(rng, maxDepth - 1) };
  }
}

function escapeIfMeta(c: string): string {
  return "|*()\\".includes(c) ? "\\" + c : c;
}

/** concat binds tighter than alt: "a|b" followed by "c" must become "(a|b)c". */
function serializeConcatChild(node: ASTNode): string {
  return node.kind === "alt" ? `(${serialize(node)})` : serialize(node);
}

/** The grammar's atom is CHAR | '(' regex ')', so only a bare char needs no parens. */
function serializeStarChild(node: ASTNode): string {
  return node.kind === "char" ? serialize(node) : `(${serialize(node)})`;
}

function serialize(node: ASTNode): string {
  switch (node.kind) {
    case "char":
      return escapeIfMeta(node.value);
    case "concat":
      return serializeConcatChild(node.left) + serializeConcatChild(node.right);
    case "alt":
      return `${serialize(node.left)}|${serialize(node.right)}`;
    case "star":
      return `${serializeStarChild(node.child)}*`;
  }
}

function randomTestString(rng: () => number, maxLength: number): string {
  const length = randomInt(rng, maxLength + 1);
  let s = "";
  for (let i = 0; i < length; i++) s += randomChar(rng);
  return s;
}

/** Whole-string match through the real pipeline, down to the minimized DFA. */
function engineMatches(pattern: string, input: string): boolean {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error(`pattern "${pattern}" failed to parse (seed ${SEED})`);
  const minDfa = minimize(subsetConstruction(thompsonConstruction(parsed.ast)));
  return match(minDfa, input).result === "match";
}

describe("Differential — random patterns agree with native RegExp (full-match)", () => {
  it("oracle sanity: anchoring gives full-match semantics, not partial", () => {
    const oracle = new RegExp("^(?:ab)$");
    expect(oracle.test("ab")).toBe(true);
    expect(oracle.test("xaby")).toBe(false); // an unanchored /ab/ would say true
    expect(oracle.test("abab")).toBe(false);
    // The engine itself is full-match too: same answers on the same inputs.
    expect(engineMatches("ab", "xaby")).toBe(false);
    expect(engineMatches("ab", "abab")).toBe(false);
  });

  it("agrees with RegExp on at least 2000 random (pattern, input) pairs", () => {
    const NUM_PATTERNS = 200;
    const STRINGS_PER_PATTERN = 10;
    const MAX_DEPTH = 3;
    const MAX_STRING_LENGTH = 6;

    const rng = makeRng(SEED);
    let casesChecked = 0;

    for (let p = 0; p < NUM_PATTERNS; p++) {
      const pattern = serialize(randomAST(rng, MAX_DEPTH));

      // A serializer bug is more fundamental than anything checked below.
      expect(parse(pattern).ok, `serialized pattern "${pattern}" must parse (seed ${SEED})`).toBe(true);

      const oracle = new RegExp(`^(?:${pattern})$`);

      for (let s = 0; s < STRINGS_PER_PATTERN; s++) {
        const input = randomTestString(rng, MAX_STRING_LENGTH);
        expect(
          engineMatches(pattern, input),
          `pattern: ${pattern}  input: "${input}"  seed: ${SEED}`,
        ).toBe(oracle.test(input));
        casesChecked++;
      }
    }

    expect(casesChecked).toBe(NUM_PATTERNS * STRINGS_PER_PATTERN);
  });
});
