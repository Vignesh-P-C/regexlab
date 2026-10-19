// Pure step-playback logic for issue #52. No React, no browser APIs, no
// engine/JSON contract change: everything here is derived client-side from
// the Automaton/ASTNode shapes the engine already returns (frontend/src/types/engine.ts).
//
// "Label matches char" and full-match semantics are reused from
// engine/passes/matcher-pass.ts (one transition per character, exact
// single-character string equality, no backtracking, stop immediately on
// a dead end) -- adapted here from that file's Map-based Automaton to the
// Record-based wire-format Automaton these functions actually receive.

import type { ASTNode, Automaton } from "../types/engine";

export type Verdict = "pending" | "match" | "no-match" | "stuck";

export type TraversedEdge = { from: number; to: number; label: string };

export type Step = {
  index: number;
  char: string | null; // null for step 0 (no character consumed yet)
  activeStates: number[]; // sorted ascending
  traversedEdges: TraversedEdge[];
  caption: string;
  verdict: Verdict;
};

/** A test string longer than this still works (these functions are total),
 *  but the UI (PR 2) should warn or truncate before handing over anything
 *  longer -- one slider position per character stops being usable well
 *  before this. */
export const PLAYBACK_MAX_CHARS = 1000;

function setKey(states: Iterable<number>): string {
  return [...states].sort((a, b) => a - b).join(",");
}

function sorted(states: Iterable<number>): number[] {
  return [...states].sort((a, b) => a - b);
}

/** Every state reachable from `states` using only "eps" transitions,
 *  including `states` itself. Mirrors subset-construction-pass.ts's own
 *  epsilonClosure exactly, adapted to the Record-based wire format. Also
 *  returns the eps edges actually walked, for traversedEdges. */
function epsilonClosure(
  automaton: Automaton,
  states: Iterable<number>,
): { closure: Set<number>; edges: TraversedEdge[] } {
  const closure = new Set<number>(states);
  const edges: TraversedEdge[] = [];
  const stack = [...closure];
  while (stack.length > 0) {
    const state = stack.pop()!;
    const targets = automaton.transitions[String(state)]?.["eps"] ?? [];
    for (const target of targets) {
      edges.push({ from: state, to: target, label: "eps" });
      if (!closure.has(target)) {
        closure.add(target);
        stack.push(target);
      }
    }
  }
  return { closure, edges };
}

/** Every state reachable from `states` by consuming exactly one `symbol`
 *  (no epsilons) -- mirrors subset-construction-pass.ts's move(). Also
 *  returns the edges actually walked, for traversedEdges. */
function move(
  automaton: Automaton,
  states: Iterable<number>,
  symbol: string,
): { moved: Set<number>; edges: TraversedEdge[] } {
  const moved = new Set<number>();
  const edges: TraversedEdge[] = [];
  for (const state of states) {
    const targets = automaton.transitions[String(state)]?.[symbol] ?? [];
    for (const target of targets) {
      edges.push({ from: state, to: target, label: symbol });
      moved.add(target);
    }
  }
  return { moved, edges };
}

function isAccepting(automaton: Automaton, states: Iterable<number>): boolean {
  const acceptSet = new Set(automaton.acceptStates);
  for (const s of states) if (acceptSet.has(s)) return true;
  return false;
}

/**
 * NFA playback (#52): step 0 is the epsilon-closure of the start state;
 * each character moves then re-closes over epsilons; an empty resulting
 * set means stuck (no continuation can ever match, so playback stops
 * there, same "stop immediately" rule matcher-pass.ts uses for the DFA).
 * The final step's verdict follows the NFA's own existential-acceptance
 * rule: match iff the final active set contains at least one accept
 * state (the same rule subset-construction-pass.ts uses to decide which
 * DFA states are accepting).
 */
export function computeNfaSteps(nfa: Automaton, input: string): Step[] {
  const steps: Step[] = [];

  const start = epsilonClosure(nfa, [nfa.startState]);
  let active = start.closure;
  steps.push({
    index: 0,
    char: null,
    activeStates: sorted(active),
    traversedEdges: start.edges,
    caption: `ε-closure of {${nfa.startState}} = {${setKey(active)}}`,
    verdict: input.length === 0 ? (isAccepting(nfa, active) ? "match" : "no-match") : "pending",
  });

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const moveResult = move(nfa, active, char);
    if (moveResult.moved.size === 0) {
      steps.push({
        index: steps.length,
        char,
        activeStates: [],
        traversedEdges: [],
        caption: `stuck on '${char}' (no transition from {${setKey(active)}})`,
        verdict: "stuck",
      });
      return steps;
    }
    const closureResult = epsilonClosure(nfa, moveResult.moved);
    active = closureResult.closure;
    const isLast = i === input.length - 1;
    steps.push({
      index: steps.length,
      char,
      activeStates: sorted(active),
      traversedEdges: [...moveResult.edges, ...closureResult.edges],
      caption: `on '${char}': move → {${setKey(moveResult.moved)}}, ε-closure → {${setKey(active)}}`,
      verdict: isLast ? (isAccepting(nfa, active) ? "match" : "no-match") : "pending",
    });
  }

  return steps;
}

/**
 * DFA / min-DFA playback (#52): one state per step, start state at step 0.
 * A missing transition is this engine's only representation of a dead
 * state (subset-construction-pass.ts never adds an explicit trap state --
 * "no transition on this symbol -> implicit dead state, omitted") so
 * "missing transition" and "stuck" are the same thing here; playback
 * records one terminal "stuck on 'x'" step and stops, same "never
 * backtracks" rule as matcher-pass.ts.
 *
 * Shared by the DFA and min-DFA tabs -- same Automaton shape, same rule.
 * Equals engine/passes/matcher-pass.ts's own MatchTrace step-for-step on
 * the successfully-consumed prefix (see steps.test.ts); it adds exactly
 * one step matcher-pass.ts's trace does not have: a terminal "stuck"
 * marker when there is a dead end, so the UI has somewhere to land on.
 *
 * `nfaForCaption`, when given, re-runs computeNfaSteps on the same input
 * purely to annotate each caption with "NFA states for this prefix" --
 * this is the live NFA run for this specific test string, not a general
 * DFA-state-to-NFA-subset table (the engine never exposes that mapping).
 */
export function computeDfaSteps(dfa: Automaton, input: string, nfaForCaption?: Automaton): Step[] {
  const nfaSteps = nfaForCaption ? computeNfaSteps(nfaForCaption, input) : null;
  const nfaSuffix = (i: number): string => {
    if (!nfaSteps) return "";
    const nfaStep = nfaSteps[i];
    if (!nfaStep) return "";
    return ` — NFA states for this prefix: {${setKey(nfaStep.activeStates)}}`;
  };

  const steps: Step[] = [];
  let current = dfa.startState;

  steps.push({
    index: 0,
    char: null,
    activeStates: [current],
    traversedEdges: [],
    caption: `start state ${current}${nfaSuffix(0)}`,
    verdict: input.length === 0 ? (dfa.acceptStates.includes(current) ? "match" : "no-match") : "pending",
  });

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const destination = dfa.transitions[String(current)]?.[char]?.[0];

    if (destination === undefined) {
      steps.push({
        index: steps.length,
        char,
        activeStates: [],
        traversedEdges: [],
        caption: `stuck on '${char}' (no transition from state ${current})`,
        verdict: "stuck",
      });
      return steps;
    }

    const from = current;
    current = destination;
    const isLast = i === input.length - 1;
    steps.push({
      index: steps.length,
      char,
      activeStates: [current],
      traversedEdges: [{ from, to: current, label: char }],
      caption: `on '${char}': ${from} → ${current}${nfaSuffix(i + 1)}`,
      verdict: isLast ? (dfa.acceptStates.includes(current) ? "match" : "no-match") : "pending",
    });
  }

  return steps;
}

export type AstStep = { index: number; nodeIndex: number; caption: string };

/**
 * The exact order Thompson's construction visits an AST: children fully
 * built before the parent combines them, left before right for concat and
 * alt, child before star (thompson-pass.ts's buildFragment recurses into
 * children before ever calling builder.newState() for the combining
 * states) -- i.e. a plain post-order walk. Exported as its own helper so
 * PR 2's UI can map nodeIndex back to a specific AST node to highlight,
 * independent of the caption text computeAstSteps adds.
 */
export function postOrderAstNodes(ast: ASTNode): { node: ASTNode; nodeIndex: number }[] {
  const result: { node: ASTNode; nodeIndex: number }[] = [];
  function visit(node: ASTNode): void {
    if (node.kind === "concat" || node.kind === "alt") {
      visit(node.left);
      visit(node.right);
    } else if (node.kind === "star") {
      visit(node.child);
    }
    result.push({ node, nodeIndex: result.length });
  }
  visit(ast);
  return result;
}

/** Names the Thompson's-construction rule for one AST node (thompson-pass.ts's
 *  four combination rules, one per ASTNode kind). */
function thompsonRuleCaption(node: ASTNode): string {
  switch (node.kind) {
    case "char":
      return `char '${node.value}': single-transition fragment (s) --${node.value}--> (f)`;
    case "concat":
      return "concat: wire left.accept --eps--> right.start";
    case "alt":
      return "alt: new start/accept, ε to both branches, both branches ε to the new accept";
    case "star":
      return "star: new start/accept, ε skip (zero reps) + ε loop-back (repeat)";
  }
}

/**
 * AST playback (#52): step i highlights the i-th node Thompson's
 * construction would build a fragment for, in that construction's own
 * order (postOrderAstNodes above) -- not an automaton, so there is no
 * char/activeStates/verdict here, just documented construction-order
 * semantics ("this is the order Thompson's construction built it in").
 */
export function computeAstSteps(ast: ASTNode): AstStep[] {
  return postOrderAstNodes(ast).map(({ node, nodeIndex }) => ({
    index: nodeIndex,
    nodeIndex,
    caption: thompsonRuleCaption(node),
  }));
}
