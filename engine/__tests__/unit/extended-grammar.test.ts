import { describe, expect, it } from "vitest";
import { encodeCharacterSet, formatTransitionSymbols } from "../../character-set.js";
import { parse } from "../../passes/parser-pass.js";
import { thompsonConstruction } from "../../passes/thompson-pass.js";
import { subsetConstruction } from "../../passes/subset-construction-pass.js";
import { minimize } from "../../passes/minimization-pass.js";
import { match } from "../../passes/matcher-pass.js";
import type { ASTNode } from "../../types.js";

function nodeFor(pattern: string): ASTNode {
  const result = parse(pattern);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.ast;
}
function accepts(pattern: string, input: string): boolean {
  const nfa = thompsonConstruction(nodeFor(pattern));
  return match(minimize(subsetConstruction(nfa)), input).result === "match";
}

describe("extended grammar AST and character sets (#60)", () => {
  it("gives postfix operators tighter binding than concatenation and alternation", () => {
    expect(nodeFor("a|bc+")).toEqual({
      kind: "alt",
      left: { kind: "char", value: "a" },
      right: { kind: "concat", left: { kind: "char", value: "b" }, right: { kind: "plus", child: { kind: "char", value: "c" } } },
    });
    expect(nodeFor("ab?")).toEqual({ kind: "concat", left: { kind: "char", value: "a" }, right: { kind: "optional", child: { kind: "char", value: "b" } } });
  });

  it("keeps a class as one compact AST set and Thompson edge", () => {
    const ast = nodeFor("[a-cx]");
    expect(ast).toEqual({ kind: "charset", characters: [97, 98, 99, 120], label: "[a-cx]" });
    const nfa = thompsonConstruction(ast);
    expect(nfa.stateCount).toBe(2);
    expect([...nfa.transitions.get(0)!.keys()]).toEqual([encodeCharacterSet([97, 98, 99, 120])]);
  });

  it("defines dot, negated classes, and ASCII shorthands precisely", () => {
    expect((nodeFor(".") as Extract<ASTNode, {kind:"charset"}>).characters).toHaveLength(126);
    expect((nodeFor("[^0-9]") as Extract<ASTNode, {kind:"charset"}>).characters).toHaveLength(118);
    expect((nodeFor("\\d") as Extract<ASTNode, {kind:"charset"}>).characters).toEqual(Array.from({length:10},(_,i)=>48+i));
    expect((nodeFor("\\w") as Extract<ASTNode, {kind:"charset"}>).characters).toEqual([...Array.from({length:26},(_,i)=>65+i),...Array.from({length:26},(_,i)=>97+i),...Array.from({length:10},(_,i)=>48+i),95].sort((a,b)=>a-b));
    expect((nodeFor("\\s") as Extract<ASTNode, {kind:"charset"}>).characters).toEqual([9,10,11,12,13,32]);
    expect((nodeFor("\\D") as Extract<ASTNode, {kind:"charset"}>).characters).toHaveLength(118);
  });

  it("formats symbolic shorthand sets as single-backslash labels", () => {
    const slash = String.fromCharCode(92);
    expect(formatTransitionSymbols([encodeCharacterSet([9, 10, 11, 12, 13, 32])])).toBe(slash + "s");
    const nonDigits = Array.from({ length: 128 }, (_, i) => i).filter((x) => x < 48 || x > 57);
    expect(formatTransitionSymbols([encodeCharacterSet(nonDigits)])).toBe(slash + "D");
  });
  it("preserves literal escapes and old behavior for unrelated patterns", () => {
    expect(nodeFor("\\+")).toEqual({kind:"char",value:"+"});
    expect(nodeFor("\\?")).toEqual({kind:"char",value:"?"});
    expect(nodeFor("\\.")).toEqual({kind:"char",value:"."});
    expect(nodeFor("^a$")).toEqual({kind:"concat",left:{kind:"concat",left:{kind:"char",value:"^"},right:{kind:"char",value:"a"}},right:{kind:"char",value:"$"}});
    expect(parse("+")).toMatchObject({ok:false,error:{type:"DanglingOperator",position:0}});
  });

  it("reports malformed classes, descending ranges, and repeated postfix operators", () => {
    expect(parse("[]")).toMatchObject({ok:false,error:{type:"InvalidCharacterClass",position:0}});
    expect(parse("[^]")).toMatchObject({ok:false,error:{type:"InvalidCharacterClass",position:0}});
    expect(parse("[abc")).toMatchObject({ok:false,error:{type:"InvalidCharacterClass",position:0}});
    expect(parse("[z-a]")).toMatchObject({ok:false,error:{type:"InvalidCharacterClass",position:2}});
    expect(parse("\\x80")).toMatchObject({ok:false,error:{type:"UnexpectedToken",position:0}});
    expect(parse("a**")).toMatchObject({ok:false,error:{type:"DanglingOperator",position:2}});
  });

  it("parses shorthand unions and escaped closing brackets in classes", () => {
    expect((nodeFor("[\\dA-C]") as Extract<ASTNode,{kind:"charset"}>).characters).toEqual([...Array.from({length:10},(_,i)=>48+i),65,66,67]);
    expect((nodeFor("[\\]]") as Extract<ASTNode,{kind:"charset"}>).characters).toEqual([93]);
  });
});

describe("extended syntax through the full automata pipeline", () => {
  it("implements one-or-more and optional over whole-string matching", () => {
    expect(accepts("a+b?", "a")).toBe(true);
    expect(accepts("a+b?", "aaab")).toBe(true);
    expect(accepts("a+b?", "")).toBe(false);
    expect(accepts("a+b?", "b")).toBe(false);
    expect(accepts("a?", "")).toBe(true);
  });
  it("matches classes and shorthands without expanding the NFA into per-character edges", () => {
    expect(accepts("[a-z]+", "regex")).toBe(true);
    expect(accepts("[a-z]+", "reg3x")).toBe(false);
    expect(accepts("\\d+", "12345")).toBe(true);
    expect(accepts("\\d+", "12x")).toBe(false);
    expect(accepts("[^0-9]+", "abc")).toBe(true);
    expect(accepts("[^0-9]+", "a1")).toBe(false);
    expect(accepts("\\+", "+")).toBe(true);
  });
  it("expands symbolic NFA sets into concrete DFA alphabet transitions", () => {
    const dfa = subsetConstruction(thompsonConstruction(nodeFor("[a-c]")));
    const labels = [...dfa.transitions.values()].flatMap((bySymbol) => [...bySymbol.keys()]);
    expect(labels).toEqual(["a", "b", "c"]);
    expect(labels.every((label) => !label.startsWith("cs:"))).toBe(true);
  });
  it("an empty complemented class compiles as a dead NFA fragment without an unlabeled edge", () => {
    const nfa = thompsonConstruction(nodeFor("[^\\x00-\\x7f]"));
    expect(nfa.stateCount).toBe(2);
    expect(nfa.transitions.size).toBe(0);
    expect(accepts("[^\\x00-\\x7f]", "")).toBe(false);
  });
  it("dot accepts ASCII except CR/LF", () => {
    expect(accepts(".", "x")).toBe(true);
    expect(accepts(".", "\n")).toBe(false);
    expect(accepts(".", "\r")).toBe(false);
    expect(accepts(".", "\x7f")).toBe(true);
  });
});
