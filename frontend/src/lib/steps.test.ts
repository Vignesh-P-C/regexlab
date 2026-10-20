// Tests for steps.ts (#52, PR 1). Runs under the ROOT vitest config (see
// package.json at the repo root) -- frontend has no test tooling of its
// own yet, and this file has no React/browser imports, so it runs fine
// there as plain Node.
//
// Cross-checks against the real engine (parser -> Thompson -> subset
// construction -> minimization -> matcher) rather than hand-built fixture
// automata, for the same reason the project's existing differential tests
// do this: a hand-built fixture can't catch a mismatch between steps.ts's
// assumptions and what the engine actually produces.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../../../engine/passes/parser-pass.js";
import { thompsonConstruction } from "../../../engine/passes/thompson-pass.js";
import { subsetConstruction } from "../../../engine/passes/subset-construction-pass.js";
import { minimize } from "../../../engine/passes/minimization-pass.js";
import { match } from "../../../engine/passes/matcher-pass.js";
import type { Automaton as EngineAutomaton, ASTNode as EngineASTNode } from "../../../engine/types.js";

import type { Automaton as WireAutomaton } from "../types/engine";
import {
  computeNfaSteps,
  computeDfaSteps,
  computeInputPlaybackSteps,
  computeAstSteps,
  postOrderAstNodes,
  PLAYBACK_MAX_CHARS,
  type Step,
} from "./steps";

const here = path.dirname(fileURLToPath(import.meta.url));

// --- helpers: real engine in, wire-format Automaton out -------------------

/** The engine prototype's Automaton (Map/Set-backed) -> the wire format
 *  (Record/array-backed) these functions actually receive at runtime. */
function toWireAutomaton(a: EngineAutomaton): WireAutomaton {
  const transitions: Record<string, Record<string, number[]>> = {};
  for (const [state, bySymbol] of a.transitions.entries()) {
    const rec: Record<string, number[]> = {};
    for (const [symbol, targets] of bySymbol.entries()) rec[symbol] = [...targets];
    transitions[String(state)] = rec;
  }
  return {
    stateCount: a.stateCount,
    startState: a.startState,
    acceptStates: [...a.acceptStates].sort((x, y) => x - y),
    transitions,
  };
}

function buildAll(pattern: string) {
  const parsed = parse(pattern);
  if (!parsed.ok) throw new Error(`failed to parse "${pattern}"`);
  const engineAst = parsed.ast;
  const engineNfa = thompsonConstruction(engineAst);
  const engineDfa = subsetConstruction(engineNfa);
  const engineMinDfa = minimize(engineDfa);
  return {
    ast: engineAst, // ASTNode's shape is identical in engine/types.ts and frontend/src/types/engine.ts
    nfa: toWireAutomaton(engineNfa),
    dfa: toWireAutomaton(engineDfa),
    minDfa: toWireAutomaton(engineMinDfa),
    engineNfa,
    engineDfa,
    engineMinDfa,
  };
}

function stuckIndex(steps: Step[]): number | null {
  const last = steps[steps.length - 1];
  return last.verdict === "stuck" ? last.index : null;
}

// ---------------------------------------------------------------------------
// 1-6: direct cases
// ---------------------------------------------------------------------------

describe("computeNfaSteps / computeDfaSteps -- direct cases (#52)", () => {
  it("NFA playback follows the symbolic charset edge for each matching input symbol", () => {
    const { nfa } = buildAll("[a-c]");
    const steps = computeNfaSteps(nfa, "b");
    expect(steps).toHaveLength(2);
    expect(steps[1].activeStates).toEqual([1]);
    expect(steps[1].traversedEdges).toHaveLength(1);
    expect(steps[1].traversedEdges[0].label).toMatch(/^cs:[0-9a-f]{32}$/);
    expect(steps[1].verdict).toBe("match");
  });

  it("empty string: step 0 only, verdict decided immediately", () => {
    const { nfa, dfa, minDfa } = buildAll("a*");
    const nfaSteps = computeNfaSteps(nfa, "");
    const dfaSteps = computeDfaSteps(dfa, "");
    const minSteps = computeDfaSteps(minDfa, "");
    expect(nfaSteps).toHaveLength(1);
    expect(dfaSteps).toHaveLength(1);
    expect(minSteps).toHaveLength(1);
    expect(nfaSteps[0].char).toBeNull();
    expect(nfaSteps[0].verdict).toBe("match"); // 'a*' accepts the empty string
    expect(dfaSteps[0].verdict).toBe("match");
    expect(minSteps[0].verdict).toBe("match");
  });

  it("immediate reject: pattern 'a', input 'b' is stuck at char 0", () => {
    const { nfa, dfa } = buildAll("a");
    const nfaSteps = computeNfaSteps(nfa, "b");
    const dfaSteps = computeDfaSteps(dfa, "b");
    expect(nfaSteps).toHaveLength(2); // step 0 + the stuck step
    expect(dfaSteps).toHaveLength(2);
    expect(nfaSteps[1].verdict).toBe("stuck");
    expect(dfaSteps[1].verdict).toBe("stuck");
    expect(dfaSteps[1].caption).toContain("stuck on 'b'");
  });

  it("'(a*)*': nested star of an already-nullable subexpression still closes correctly", () => {
    const { nfa, dfa, minDfa } = buildAll("(a*)*");
    for (const input of ["", "a", "aaaa", "b"]) {
      const expected = match(buildAll("(a*)*").engineMinDfa, input);
      const expectedVerdict = expected.failurePosition !== undefined ? "stuck" : expected.result;
      const nfaSteps = computeNfaSteps(nfa, input);
      const dfaSteps = computeDfaSteps(dfa, input);
      const minSteps = computeDfaSteps(minDfa, input);
      expect(nfaSteps[nfaSteps.length - 1].verdict, `input "${input}"`).toBe(expectedVerdict);
      expect(dfaSteps[dfaSteps.length - 1].verdict, `input "${input}"`).toBe(expectedVerdict);
      expect(minSteps[minSteps.length - 1].verdict, `input "${input}"`).toBe(expectedVerdict);
    }
  });

  it("'(a|b)*abb' with 'babb': matches, with a full step per character", () => {
    const { nfa, dfa, minDfa } = buildAll("(a|b)*abb");
    const input = "babb";
    const nfaSteps = computeNfaSteps(nfa, input);
    const dfaSteps = computeDfaSteps(dfa, input);
    const minSteps = computeDfaSteps(minDfa, input);
    expect(nfaSteps).toHaveLength(input.length + 1);
    expect(dfaSteps).toHaveLength(input.length + 1);
    expect(minSteps).toHaveLength(input.length + 1);
    expect(nfaSteps[nfaSteps.length - 1].verdict).toBe("match");
    expect(dfaSteps[dfaSteps.length - 1].verdict).toBe("match");
    expect(minSteps[minSteps.length - 1].verdict).toBe("match");
    // each successful DFA/min-DFA step carries exactly one traversed edge
    for (const step of dfaSteps.slice(1)) expect(step.traversedEdges).toHaveLength(1);
  });

  it("stuck DFA: pattern 'ab', input 'ac' stops at the 'c'", () => {
    const { dfa, minDfa } = buildAll("ab");
    for (const automaton of [dfa, minDfa]) {
      const steps = computeDfaSteps(automaton, "ac");
      expect(steps).toHaveLength(3); // start, 'a', stuck-on-'c'
      expect(steps[1].verdict).toBe("pending");
      expect(steps[2].verdict).toBe("stuck");
      expect(steps[2].char).toBe("c");
    }
  });

  it(`a ${PLAYBACK_MAX_CHARS}-char string matches 'a*' exactly at the exported cap`, () => {
    const { nfa, dfa } = buildAll("a*");
    const input = "a".repeat(PLAYBACK_MAX_CHARS);
    const nfaSteps = computeNfaSteps(nfa, input);
    const dfaSteps = computeDfaSteps(dfa, input);
    expect(nfaSteps).toHaveLength(PLAYBACK_MAX_CHARS + 1);
    expect(dfaSteps).toHaveLength(PLAYBACK_MAX_CHARS + 1);
    expect(nfaSteps[nfaSteps.length - 1].verdict).toBe("match");
    expect(dfaSteps[dfaSteps.length - 1].verdict).toBe("match");
  });
});

describe("computeInputPlaybackSteps -- UI playback cap (#52)", () => {
  it("builds the input traces at the cap", () => {
    const { nfa, dfa, minDfa } = buildAll("a*");
    const steps = computeInputPlaybackSteps(nfa, dfa, minDfa, "a".repeat(PLAYBACK_MAX_CHARS));

    expect(steps).not.toBeNull();
    expect(steps?.nfa).toHaveLength(PLAYBACK_MAX_CHARS + 1);
    expect(steps?.dfa).toHaveLength(PLAYBACK_MAX_CHARS + 1);
    expect(steps?.minDfa).toHaveLength(PLAYBACK_MAX_CHARS + 1);
  });

  it("does not build per-character traces above the cap", () => {
    const { nfa, dfa, minDfa } = buildAll("a*");

    expect(computeInputPlaybackSteps(nfa, dfa, minDfa, "a".repeat(PLAYBACK_MAX_CHARS + 1))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7: AST visit order
// ---------------------------------------------------------------------------

describe("computeAstSteps / postOrderAstNodes -- visit order (#52)", () => {
  it("'a|b' visits children before the parent, left before right -- same order thompson-pass.ts's buildFragment recurses in", () => {
    const { ast } = buildAll("a|b");
    const nodes = postOrderAstNodes(ast);
    const kinds = nodes.map(({ node }) => (node.kind === "char" ? `char:${node.value}` : node.kind));
    // hand-derived from thompson-pass.ts's alt case: buildFragment(left) then
    // buildFragment(right) THEN the combining states -- i.e. char 'a', char 'b', alt.
    expect(kinds).toEqual(["char:a", "char:b", "alt"]);
    expect(nodes.map(({ nodeIndex }) => nodeIndex)).toEqual([0, 1, 2]);

    const steps = computeAstSteps(ast);
    expect(steps.map((s) => s.caption.split(":")[0])).toEqual(["char 'a'", "char 'b'", "alt"]);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(steps.map((s) => s.nodeIndex)).toEqual([0, 1, 2]);
  });

  it("'(a|b)*c' -- star's child visited before the star itself, then concat's right side last", () => {
    const { ast } = buildAll("(a|b)*c");
    const nodes = postOrderAstNodes(ast);
    const kinds = nodes.map(({ node }) => (node.kind === "char" ? `char:${node.value}` : node.kind));
    // hand-derived: concat(star(alt(a,b)), c) -- buildFragment visits
    // concat's left (the star) fully -- which itself visits its child (the
    // alt, which visits a then b) before the star's own combining state --
    // then concat's right (c), then concat's own combining state.
    expect(kinds).toEqual(["char:a", "char:b", "alt", "star", "char:c", "concat"]);
  });
});

// ---------------------------------------------------------------------------
// 8: seeded differential vs the TS engine's own matcher
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIFF_SEED_DEFAULT = 52052;
const DIFF_CASES = 50;

describe("seeded differential: step verdicts vs the TS engine matcher (#52)", () => {
  const envSeed = process.env.REGEXLAB_DIFF_SEED;
  const SEED = envSeed && envSeed.length > 0 ? Number(envSeed) : DIFF_SEED_DEFAULT;

  it(`agrees with the engine's own matcher on ${DIFF_CASES} random (pattern, input) pairs (seed ${SEED})`, () => {
    console.log(`[steps differential] seed: ${SEED}`);
    const rng = mulberry32(SEED);
    const alphabet = "ab";
    const randomChar = (): string => alphabet[Math.floor(rng() * alphabet.length)];
    function randomAst(depth: number): EngineASTNode {
      if (depth <= 0) return { kind: "char", value: randomChar() };
      switch (Math.floor(rng() * 4)) {
        case 0:
          return { kind: "char", value: randomChar() };
        case 1:
          return { kind: "concat", left: randomAst(depth - 1), right: randomAst(depth - 1) };
        case 2:
          return { kind: "alt", left: randomAst(depth - 1), right: randomAst(depth - 1) };
        default:
          return { kind: "star", child: randomAst(depth - 1) };
      }
    }
    function randomInput(maxLen: number): string {
      const len = Math.floor(rng() * (maxLen + 1));
      let s = "";
      for (let i = 0; i < len; i++) s += randomChar();
      return s;
    }

    for (let i = 0; i < DIFF_CASES; i++) {
      const ast = randomAst(3);
      const engineNfa = thompsonConstruction(ast);
      const engineDfa = subsetConstruction(engineNfa);
      const engineMinDfa = minimize(engineDfa);
      const input = randomInput(6);

      const expected = match(engineMinDfa, input);
      const expectedVerdict = expected.failurePosition !== undefined ? "stuck" : expected.result;

      const nfaSteps = computeNfaSteps(toWireAutomaton(engineNfa), input);
      const dfaSteps = computeDfaSteps(toWireAutomaton(engineMinDfa), input);

      expect(nfaSteps[nfaSteps.length - 1].verdict, `case ${i}, seed ${SEED}`).toBe(expectedVerdict);
      expect(dfaSteps[dfaSteps.length - 1].verdict, `case ${i}, seed ${SEED}`).toBe(expectedVerdict);
    }
  });
});

// ---------------------------------------------------------------------------
// 9: computeDfaSteps(minDfa) === engine MatchTrace, step for step
// ---------------------------------------------------------------------------

describe("computeDfaSteps(minDfa) matches the engine's own MatchTrace step-for-step (#52)", () => {
  const pattern = "(a|b)*ab";
  const inputs = ["", "a", "ab", "aab", "aba", "abx"];

  for (const input of inputs) {
    it(`pattern "${pattern}", input "${input}"`, () => {
      const { minDfa, engineMinDfa } = buildAll(pattern);
      const trace = match(engineMinDfa, input);
      const steps = computeDfaSteps(minDfa, input);

      // steps[0] is the start-state marker the engine's raw trace doesn't have.
      const consumed = steps.slice(1);
      const comparable = consumed.slice(0, trace.steps.length).map((s) => ({ char: s.char, activeStates: s.activeStates }));
      expect(comparable).toEqual(trace.steps.map((s) => ({ char: s.char, activeStates: s.activeStates })));

      if (trace.failurePosition !== undefined) {
        // exactly one extra terminal "stuck" step beyond the raw trace, so the UI has somewhere to land.
        expect(consumed).toHaveLength(trace.steps.length + 1);
        expect(consumed[consumed.length - 1].verdict).toBe("stuck");
      } else {
        expect(consumed).toHaveLength(trace.steps.length);
        expect(steps[steps.length - 1].verdict).toBe(trace.result);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 10: per-prefix invariants, via test-only tracers of the engine's own
// (never-returned) internal mappings.
// ---------------------------------------------------------------------------

/** Mirrors subset-construction-pass.ts's own algorithm, test-only, purely
 *  to recover the dfaId -> NFA-subset mapping that pass computes internally
 *  but never returns. Same alphabet ordering and worklist discovery order,
 *  so ids line up with a real subsetConstruction(nfa) call on the same nfa. */
function tracedNfaSubsets(nfa: EngineAutomaton): Map<number, Set<number>> {
  function epsilonClosure(states: Iterable<number>): Set<number> {
    const closure = new Set<number>(states);
    const stack = [...closure];
    while (stack.length > 0) {
      const s = stack.pop()!;
      for (const t of nfa.transitions.get(s)?.get("eps") ?? []) {
        if (!closure.has(t)) {
          closure.add(t);
          stack.push(t);
        }
      }
    }
    return closure;
  }
  function move(states: Iterable<number>, symbol: string): Set<number> {
    const result = new Set<number>();
    for (const s of states) for (const t of nfa.transitions.get(s)?.get(symbol) ?? []) result.add(t);
    return result;
  }
  const alphabet = new Set<string>();
  for (const bySymbol of nfa.transitions.values()) for (const sym of bySymbol.keys()) if (sym !== "eps") alphabet.add(sym);
  const sortedAlphabet = [...alphabet].sort();

  const stateSets: Set<number>[] = [];
  const idBySetKey = new Map<string, number>();
  const keyOf = (s: Set<number>) => [...s].sort((a, b) => a - b).join(",");
  function idFor(s: Set<number>): number {
    const k = keyOf(s);
    let id = idBySetKey.get(k);
    if (id === undefined) {
      id = stateSets.length;
      idBySetKey.set(k, id);
      stateSets.push(s);
    }
    return id;
  }

  const startId = idFor(epsilonClosure([nfa.startState]));
  const processed = new Set<number>();
  const worklist = [startId];
  while (worklist.length > 0) {
    const cur = worklist.pop()!;
    if (processed.has(cur)) continue;
    processed.add(cur);
    for (const symbol of sortedAlphabet) {
      const moved = move(stateSets[cur], symbol);
      if (moved.size === 0) continue;
      const targetId = idFor(epsilonClosure(moved));
      if (!processed.has(targetId)) worklist.push(targetId);
    }
  }
  const result = new Map<number, Set<number>>();
  stateSets.forEach((set, id) => result.set(id, set));
  return result;
}

/** Mirrors minimization-pass.ts's own Moore's-algorithm refinement loop,
 *  test-only, to recover the dfaState -> minDfaId mapping that pass
 *  computes internally but never returns. Same canonical-renumbering
 *  worklist order, so ids line up with a real minimize(dfa) call on the
 *  same dfa. */
function tracedMinGroups(dfa: EngineAutomaton): Map<number, number> {
  const alphabet = new Set<string>();
  for (const bySymbol of dfa.transitions.values()) for (const sym of bySymbol.keys()) alphabet.add(sym);
  const sortedAlphabet = [...alphabet].sort();

  const allStates = Array.from({ length: dfa.stateCount }, (_, i) => i);
  const accepting = allStates.filter((s) => dfa.acceptStates.has(s));
  const nonAccepting = allStates.filter((s) => !dfa.acceptStates.has(s));
  let groups = [nonAccepting, accepting].filter((g) => g.length > 0);

  function refine(currentGroups: number[][]): { groups: number[][]; changed: boolean } {
    const groupIndexOf = new Map<number, number>();
    currentGroups.forEach((g, i) => {
      for (const s of g) groupIndexOf.set(s, i);
    });
    const newGroups: number[][] = [];
    let changed = false;
    for (const group of currentGroups) {
      const buckets = new Map<string, number[]>();
      for (const s of group) {
        const signature = sortedAlphabet
          .map((sym) => {
            const dest = dfa.transitions.get(s)?.get(sym)?.[0];
            return dest === undefined ? "-" : groupIndexOf.get(dest);
          })
          .join(",");
        const bucket = buckets.get(signature);
        if (bucket) bucket.push(s);
        else buckets.set(signature, [s]);
      }
      if (buckets.size > 1) changed = true;
      newGroups.push(...buckets.values());
    }
    return { groups: newGroups, changed };
  }

  let changed = true;
  while (changed) {
    const r = refine(groups);
    groups = r.groups;
    changed = r.changed;
  }

  const groupIndexOfState = new Map<number, number>();
  groups.forEach((g, i) => {
    for (const s of g) groupIndexOfState.set(s, i);
  });

  const canonicalId = new Map<number, number>();
  function idFor(groupIndex: number): number {
    let id = canonicalId.get(groupIndex);
    if (id === undefined) {
      id = canonicalId.size;
      canonicalId.set(groupIndex, id);
    }
    return id;
  }
  const startGroupIndex = groupIndexOfState.get(dfa.startState)!;
  idFor(startGroupIndex);
  const worklist = [startGroupIndex];
  const processed = new Set<number>();
  while (worklist.length > 0) {
    const g = worklist.pop()!;
    if (processed.has(g)) continue;
    processed.add(g);
    const representative = groups[g][0];
    for (const symbol of sortedAlphabet) {
      const dest = dfa.transitions.get(representative)?.get(symbol)?.[0];
      if (dest === undefined) continue;
      const destGroup = groupIndexOfState.get(dest)!;
      idFor(destGroup);
      if (!processed.has(destGroup)) worklist.push(destGroup);
    }
  }

  const result = new Map<number, number>();
  for (const s of allStates) result.set(s, idFor(groupIndexOfState.get(s)!));
  return result;
}

describe("per-prefix invariants: NFA set / min-DFA class / stuck agreement (#52)", () => {
  const patterns = ["a|b", "(a|b)*ab", "(a*)*", "(a|b)*abb"];
  const inputs = ["", "a", "b", "ab", "ba", "aab", "abb", "bbb", "aaaa", "x"];

  for (const pattern of patterns) {
    it(`pattern "${pattern}"`, () => {
      const { nfa, dfa, minDfa, engineNfa, engineDfa } = buildAll(pattern);
      const nfaSubsetByDfaState = tracedNfaSubsets(engineNfa);
      const minGroupByDfaState = tracedMinGroups(engineDfa);

      for (const input of inputs) {
        const nfaSteps = computeNfaSteps(nfa, input);
        const dfaSteps = computeDfaSteps(dfa, input);
        const minSteps = computeDfaSteps(minDfa, input);

        const nfaStuckAt = stuckIndex(nfaSteps);
        const dfaStuckAt = stuckIndex(dfaSteps);
        const minStuckAt = stuckIndex(minSteps);
        const ctx = `pattern "${pattern}" input "${input}"`;
        expect(dfaStuckAt, ctx).toBe(nfaStuckAt);
        expect(minStuckAt, ctx).toBe(nfaStuckAt);

        const liveLen = nfaStuckAt ?? nfaSteps.length;
        for (let i = 0; i < liveLen; i++) {
          const dfaState = dfaSteps[i].activeStates[0];
          const expectedSubset = nfaSubsetByDfaState.get(dfaState);
          expect(expectedSubset, `${ctx} step ${i}`).toBeDefined();
          expect(new Set(nfaSteps[i].activeStates), `${ctx} step ${i}`).toEqual(expectedSubset);

          const minState = minSteps[i].activeStates[0];
          expect(minGroupByDfaState.get(dfaState), `${ctx} step ${i}`).toBe(minState);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 11: real WASM cross-check (skips cleanly if the module isn't built)
// ---------------------------------------------------------------------------

describe("real WASM cross-check (#52)", () => {
  it("computeDfaSteps(minDfa) final verdict matches the compiled WASM matcher's verdict", async () => {
    const wasmJsPath = path.resolve(here, "../../public/wasm/regexlab.js");
    const wasmBinPath = path.resolve(here, "../../public/wasm/regexlab.wasm");
    if (!existsSync(wasmJsPath) || !existsSync(wasmBinPath)) {
      console.log("SKIPPED: wasm not built");
      return;
    }

    const mod = await import(wasmJsPath);
    const instance = await mod.default();

    const cases: [string, string][] = [
      ["(a|b)*ab", "aab"],
      ["(a|b)*ab", "aba"],
      ["ab", "ac"],
      ["a*", ""],
    ];
    for (const [pattern, input] of cases) {
      const wasmResult = JSON.parse(instance.runPipeline(pattern, input));
      expect(wasmResult.ok, `pattern "${pattern}"`).toBe(true);
      const { minDfa } = buildAll(pattern);
      const steps = computeDfaSteps(minDfa, input);
      const expectedVerdict = wasmResult.trace.failurePosition !== null ? "stuck" : wasmResult.trace.result;
      expect(steps[steps.length - 1].verdict, `pattern "${pattern}" input "${input}"`).toBe(expectedVerdict);
    }
  });
});
