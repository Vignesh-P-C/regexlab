import { describe, it, expect } from "vitest";
import { layoutNfaFragments } from "./nfa-fragment-layout";
import type { ASTNode } from "../types/engine";

// Hand-built ASTs mirroring exactly what the parser would produce -- small
// enough to reason about the expected layer of every state by hand.

const char = (value: string): ASTNode => ({ kind: "char", value });

describe("layoutNfaFragments (#61 follow-up: textbook NFA layout)", () => {
  it("lays out a single char as a 2-state, 1-layer-apart fragment", () => {
    const { layer, stateCount } = layoutNfaFragments(char("a"));
    expect(stateCount).toBe(2);
    expect(layer).toEqual([0, 1]);
  });

  it("concat chains layers straight through, matching thompson-pass.ts's id order", () => {
    // "ab": char 'a' gets ids 0,1; char 'b' gets ids 2,3 (built left-to-right,
    // no extra states of its own) -- see thompson-pass.ts's concat case.
    const ast: ASTNode = { kind: "concat", left: char("a"), right: char("b") };
    const { layer, stateCount } = layoutNfaFragments(ast);
    expect(stateCount).toBe(4);
    expect(layer).toEqual([0, 1, 2, 3]);
  });

  it("alt splits both branches to the same layer and joins one layer after the longer branch", () => {
    // "a|b": left 'a' gets ids 0,1; right 'b' gets ids 2,3; then the new
    // start/accept get ids 4,5 -- thompson-pass.ts allocates them LAST.
    const ast: ASTNode = { kind: "alt", left: char("a"), right: char("b") };
    const { layer, stateCount } = layoutNfaFragments(ast);
    expect(stateCount).toBe(6);
    // start=4 at layer 0; both branch starts (0,2) at layer 1; both branch
    // accepts (1,3) at layer 2; the join accept=5 at layer 3.
    expect(layer[4]).toBe(0);
    expect(layer[0]).toBe(1);
    expect(layer[2]).toBe(1);
    expect(layer[1]).toBe(2);
    expect(layer[3]).toBe(2);
    expect(layer[5]).toBe(3);
  });

  it("star places the inner fragment as the main chain, with entry/exit bracketing it", () => {
    // "a*": inner 'a' gets ids 0,1; star's start/accept get ids 2,3.
    const ast: ASTNode = { kind: "star", child: char("a") };
    const { layer, stateCount } = layoutNfaFragments(ast);
    expect(stateCount).toBe(4);
    expect(layer[2]).toBe(0); // star's own start (entry)
    expect(layer[0]).toBe(1); // inner start
    expect(layer[1]).toBe(2); // inner accept
    expect(layer[3]).toBe(3); // star's own accept (exit) -- AFTER the body,
    // not beside the entry, which is exactly what BFS-shortest-path got
    // wrong (see this file's header): the skip edge (2->3) reaching 3 in
    // one hop must not shorten 3's layer to 1.
    // Consequence: the loop-back edge 1->0 has span layer[0]-layer[1] = -1
    // (goes DOWN a layer -- drawn above the centerline), and the skip edge
    // 2->3 has span layer[3]-layer[2] = 3 (skips two layers -- drawn below).
    expect(layer[0] - layer[1]).toBeLessThanOrEqual(0);
    expect(layer[3] - layer[2]).toBeGreaterThan(1);
  });

  it("a+ is laid out as a mandatory copy, a repeating copy, and one shared accept", () => {
    const ast: ASTNode = { kind: "plus", child: char("a") };
    const { layer, stateCount } = layoutNfaFragments(ast);
    expect(stateCount).toBe(5);
    expect(layer).toEqual([0, 1, 2, 3, 4]);
  });

  it("a+bcd places both plus exits before the shared b continuation", () => {
    const ast: ASTNode = {
      kind: "concat",
      left: {
        kind: "concat",
        left: {
          kind: "concat",
          left: { kind: "plus", child: char("a") },
          right: char("b"),
        },
        right: char("c"),
      },
      right: char("d"),
    };
    const { layer, stateCount } = layoutNfaFragments(ast);
    expect(stateCount).toBe(10);
    expect(layer).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("stays correct for a pattern with both a loop and a skip competing for the shortest BFS path", () => {
    // "(a|b)*a": this is the exact case that motivated this file -- under
    // plain BFS-from-start layering, the star's exit state is reachable in
    // ONE hop via the skip edge, which used to put it at the same layer as
    // the loop body's entry instead of after the loop body. Assert the
    // actual construction order/layers here so a regression shows up as a
    // failing layer assertion, not just a visually-wrong diagram.
    const ast: ASTNode = {
      kind: "concat",
      left: { kind: "star", child: { kind: "alt", left: char("a"), right: char("b") } },
      right: char("a"),
    };
    const { layer, stateCount } = layoutNfaFragments(ast);
    // alt: 'a'=0,1 'b'=2,3 alt-start=4 alt-accept=5; star: star-start=6 star-accept=7;
    // concat's final 'a': 8,9.
    expect(stateCount).toBe(10);
    expect(layer[6]).toBe(0); // star start (overall entry)
    expect(layer[4]).toBe(1); // alt start
    expect(layer[0]).toBe(2); // 'a' branch start
    expect(layer[2]).toBe(2); // 'b' branch start, same layer as 'a' branch (symmetric)
    expect(layer[1]).toBe(3);
    expect(layer[3]).toBe(3);
    expect(layer[5]).toBe(4); // alt accept (join)
    expect(layer[7]).toBe(5); // star accept (exit) -- AFTER the alt, not beside state 6
    expect(layer[8]).toBe(6);
    expect(layer[9]).toBe(7);
    // The loop-back (5 -> 4) goes down two layers; the skip (6 -> 7) jumps
    // five. Both need a bow; neither would be mistaken for a plain edge.
    expect(layer[4] - layer[5]).toBeLessThanOrEqual(0);
    expect(layer[7] - layer[6]).toBeGreaterThan(1);
  });
});
