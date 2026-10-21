/** Recursive-descent parser for RegexLab's versioned ASCII regex grammar. */
import type { ASTNode, ParseError, ParseResult } from "../types.js";
class ParseFailure extends Error { readonly parseError: ParseError; constructor(parseError: ParseError) { super(parseError.type); this.parseError = parseError; } }
export const DEFAULT_MAX_PATTERN_LENGTH = 500;
export const DEFAULT_MAX_NESTING_DEPTH = 1000;
export type ParseLimits = { maxPatternLength: number; maxNestingDepth: number };
const DEFAULT_LIMITS: ParseLimits = { maxPatternLength: DEFAULT_MAX_PATTERN_LENGTH, maxNestingDepth: DEFAULT_MAX_NESTING_DEPTH };
type ClassAtom = { characters: number[]; singleton: boolean };
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ascii = range(0, 127), digits = range(48, 57), word = [...range(65, 90), ...digits, 95, ...range(97, 122)].sort((a, b) => a - b), whitespace = [9, 10, 11, 12, 13, 32];
class Parser {
  private pos = 0; private depth = 0;
  constructor(private readonly pattern: string, private readonly limits: ParseLimits) {}
  private peek(offset = 0): string | undefined { return this.pattern[this.pos + offset]; }
  private advance(): string { return this.pattern[this.pos++]; }
  private fail(type: ParseError["type"], position: number, expected: string, found: string): never { throw new ParseFailure({ type, position, expected, found }); }
  private exceedsLengthCap(): boolean {
    const cap = this.limits.maxPatternLength;
    if (this.pattern.length <= cap) return false;
    for (let i = 0; i <= cap; i++) if (this.pattern.charCodeAt(i) > 127) return false;
    return true;
  }
  private requireAscii(c: string, at: number): void { if (c.charCodeAt(0) > 127) this.fail("UnexpectedToken", at, "an ASCII character", "non-ASCII character"); }
  private parseRegex(): ASTNode {
    let node = this.parseTerm();
    while (this.peek() === "|") { this.advance(); node = { kind: "alt", left: node, right: this.parseTerm() }; }
    return node;
  }
  private parseTerm(): ASTNode {
    let node = this.parseFactor();
    while (this.peek() !== undefined && this.peek() !== "|" && this.peek() !== ")") node = { kind: "concat", left: node, right: this.parseFactor() };
    return node;
  }
  private parseFactor(): ASTNode {
    const child = this.parseAtom(), q = this.peek();
    if (q === "*" || q === "+" || q === "?") {
      this.advance();
      return q === "*" ? { kind: "star", child } : q === "+" ? { kind: "plus", child } : { kind: "optional", child };
    }
    return child;
  }
  private parseAtom(): ASTNode {
    const c = this.peek();
    if (c === undefined) this.fail("UnexpectedToken", this.pos, "a character or '('", "end of input");
    if (c === "(") {
      const open = this.pos; this.advance();
      if (this.peek() === ")") this.fail("EmptyGroup", this.pos, "a pattern before ')'", ")");
      if (++this.depth > this.limits.maxNestingDepth) this.fail("PatternTooComplex", open, `nesting depth <= ${this.limits.maxNestingDepth}`, "deeper group nesting");
      const inner = this.parseRegex(); this.depth--;
      if (this.peek() !== ")") this.fail("UnmatchedParen", open, "')'", this.peek() ?? "end of input");
      this.advance(); return inner;
    }
    if (c === "[") return this.parseCharacterClass();
    if (c === ".") { this.advance(); return { kind: "charset", characters: ascii.filter((x) => x !== 10 && x !== 13), label: "." }; }
    if (c === "|" || c === "*" || c === "+" || c === "?" || c === ")") this.fail("DanglingOperator", this.pos, "a character or '('", c);
    if (c === "\\") return this.parseEscape().node;
    this.requireAscii(c, this.pos); this.advance(); return { kind: "char", value: c };
  }
  private shorthand(c: string): number[] | null {
    switch (c) {
      case "d": return digits; case "w": return word; case "s": return whitespace;
      case "D": return ascii.filter((x) => !digits.includes(x));
      case "W": return ascii.filter((x) => !word.includes(x));
      case "S": return ascii.filter((x) => !whitespace.includes(x));
      default: return null;
    }
  }
  private parseEscape(): { node: ASTNode; atom: ClassAtom } {
    const slash = this.pos; this.advance(); const c = this.peek();
    if (c === undefined) this.fail("UnexpectedToken", slash, "a character after '\\'", "end of input");
    this.requireAscii(c, this.pos); this.advance();
    const set = this.shorthand(c);
    if (set) return { node: { kind: "charset", characters: set, label: `\\${c}` }, atom: { characters: set, singleton: false } };
    if (c === "x") {
      const text = this.pattern.slice(this.pos, this.pos + 2);
      if (text.length !== 2 || !/^[0-9a-fA-F]{2}$/.test(text)) this.fail("UnexpectedToken", slash, "two hex digits after '\\x'", text || "end of input");
      const code = Number.parseInt(text, 16); this.pos += 2;
      if (code > 127) this.fail("UnexpectedToken", slash, "an ASCII escape", "non-ASCII character");
      return { node: { kind: "char", value: String.fromCharCode(code) }, atom: { characters: [code], singleton: true } };
    }
    const controls: Record<string, number> = { n: 10, r: 13, t: 9, v: 11, f: 12 };
    const code = controls[c] ?? c.charCodeAt(0);
    return { node: { kind: "char", value: String.fromCharCode(code) }, atom: { characters: [code], singleton: true } };
  }
  private classAtom(open: number): ClassAtom {
    if (this.peek() === undefined) this.fail("InvalidCharacterClass", open, "a closing ']'", "end of input");
    if (this.peek() === "\\") return this.parseEscape().atom;
    const c = this.peek()!, at = this.pos; this.requireAscii(c, at); this.advance();
    return { characters: [c.charCodeAt(0)], singleton: true };
  }
  private parseCharacterClass(): ASTNode {
    const open = this.pos; this.advance(); const negated = this.peek() === "^"; if (negated) this.advance();
    const set = new Set<number>(); let members = 0;
    while (this.peek() !== "]") {
      if (this.peek() === undefined) this.fail("InvalidCharacterClass", open, "a closing ']'", "end of input");
      const first = this.classAtom(open);
      if (first.singleton && first.characters[0] !== 45 && this.peek() === "-" && this.peek(1) !== "]" && this.peek(1) !== undefined) {
        const dash = this.pos; this.advance(); const last = this.classAtom(open);
        if (!last.singleton || first.characters[0] > last.characters[0]) this.fail("InvalidCharacterClass", dash, "an ascending range with single-character endpoints", "invalid range");
        for (let x = first.characters[0]; x <= last.characters[0]; x++) set.add(x);
      } else first.characters.forEach((x) => set.add(x));
      members++;
    }
    if (!members) this.fail("InvalidCharacterClass", open, "at least one class member", "empty character class");
    this.advance();
    const chars = negated ? ascii.filter((x) => !set.has(x)) : [...set].sort((a, b) => a - b);
    return { kind: "charset", characters: chars, label: this.pattern.slice(open, this.pos) };
  }
  parse(): ParseResult {
    try {
      if (this.exceedsLengthCap()) this.fail("PatternTooComplex", this.limits.maxPatternLength, `pattern length <= ${this.limits.maxPatternLength}`, "longer pattern");
      const ast = this.parseRegex();
      if (this.pos < this.pattern.length) {
        const c = this.pattern[this.pos];
        if (c === ")") this.fail("UnmatchedParen", this.pos, "end of input", ")");
        this.fail("UnexpectedToken", this.pos, "end of input", c);
      }
      return { ok: true, ast };
    } catch (e) { if (e instanceof ParseFailure) return { ok: false, error: e.parseError }; throw e; }
  }
}
export function parse(pattern: string, limits: Partial<ParseLimits> = {}): ParseResult {
  return new Parser(pattern, { ...DEFAULT_LIMITS, ...limits }).parse();
}
