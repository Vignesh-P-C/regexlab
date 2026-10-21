/**
 * MinimizationPass — CLAUDE.md v2 §8 (fourth stage of the pipeline)
 *
 * Algorithm: Moore's algorithm — iterative partition refinement.
 * Complexity: O(n² · k) — see CLAUDE.md §10 (n = DFA states, k = alphabet
 * size). Hopcroft's O(n log n · k) algorithm is the Hard Stretch upgrade
 * to this pass, deliberately not attempted until this simpler version is
 * solid and both of you can explain it unaided (§0.1 rule 9 / §11).
 *
 * Core idea: two DFA states are "equivalent" (mergeable into one state
 * in the minimal DFA) exactly when no input string can ever tell them
 * apart — i.e. for every symbol, they transition into states that are
 * ALSO equivalent, and they agree on whether they're accepting.
 *
 * Moore's algorithm computes this via refinement, starting from the
 * coarsest possible guess and splitting groups apart only when evidence
 * proves two states aren't actually equivalent:
 *
 *   1. Start with 2 groups: accepting states, non-accepting states.
 *      (This is the coarsest safe guess — nothing in group A can be
 *      equivalent to something in group B, since one accepts and the
 *      other doesn't.)
 *   2. Repeat: for every group, split it into subgroups whenever two
 *      states in it transition to DIFFERENT groups on the same symbol.
 *      This is real evidence they're distinguishable.
 *   3. Stop when a full pass causes zero splits — a fixpoint. What's
 *      left is the coarsest partition consistent with the automaton's
 *      actual behavior, i.e. exactly the equivalence classes we wanted.
 *
 * Each final group becomes exactly one state in the minimized DFA.
 *
 * Note: this pass assumes every input state is reachable from the start
 * state, which is true by construction — SubsetConstructionPass's
 * worklist only ever creates states it discovers via a real transition,
 * so there's no unreachable-state pruning step needed here.
 */

import type { Automaton } from "../types.js";

function alphabetOf(dfa: Automaton): string[] {
  const symbols = new Set<string>();
  for (const bySymbol of dfa.transitions.values()) {
    for (const symbol of bySymbol.keys()) symbols.add(symbol);
  }
  return [...symbols].sort();
}

/**
 * Alphabet equivalence-class compression (added for issue #64 follow-up).
 *
 * refine()'s per-state "signature" loops over every symbol in the alphabet,
 * so each fixpoint round costs O(n * k) where k = alphabet.length. Extended
 * syntax (character classes, `.`, shorthand classes) desugars into one DFA
 * symbol per matching ASCII code during subset construction, so k can now be
 * as large as 126 (`.`) instead of the ~1 symbol a plain literal pattern
 * produced before this grammar existed — and refine() runs up to n times to
 * reach the fixpoint, so the real cost is O(n^2 * k).
 *
 * The fix: two symbols that lead every state to the same destination are
 * interchangeable as far as refine()'s signature is concerned — including
 * both in a signature adds the same value twice, which can never cause an
 * extra split. So before refining, group the alphabet into equivalence
 * classes where symbols a and b are in the same class iff
 * transition(s, a) === transition(s, b) for every state s (the "transition
 * column" for a and b is identical). Only one representative per class is
 * needed to build a signature that is informationally identical to using
 * the full alphabet — dropping the duplicates never changes which states
 * end up in the same bucket, so the final partition (and therefore the
 * minimized DFA) is unaffected. A `.`-repeated pattern collapses its whole
 * 126-symbol alphabet into a single class (every symbol sends every state
 * to the same next state), so refine() becomes O(n^2 * 1) instead of
 * O(n^2 * 126) for exactly the case that used to be slow.
 *
 * Picking the lexicographically-first symbol in each class as its
 * representative (alphabet is pre-sorted) keeps this deterministic.
 */
function representativeAlphabetOf(dfa: Automaton, alphabet: string[], stateCount: number): string[] {
  const classKeyOf = new Map<string, string>(); // symbol -> its class's key (the full transition column)
  const seenKeys = new Set<string>();
  const representatives: string[] = [];

  for (const symbol of alphabet) {
    const column: string[] = [];
    for (let state = 0; state < stateCount; state++) {
      const dest = dfa.transitions.get(state)?.get(symbol)?.[0];
      column.push(dest === undefined ? "-" : String(dest));
    }
    const key = column.join(",");
    classKeyOf.set(symbol, key);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      representatives.push(symbol);
    }
  }

  return representatives;
}

/** One refinement pass: split every group using each state's "signature" (which group each symbol leads to). */
function refine(groups: number[][], dfa: Automaton, alphabet: string[]): { groups: number[][]; changed: boolean } {
  const groupIndexOf = new Map<number, number>();
  groups.forEach((group, index) => {
    for (const state of group) groupIndexOf.set(state, index);
  });

  const newGroups: number[][] = [];
  let changed = false;

  for (const group of groups) {
    const buckets = new Map<string, number[]>();
    for (const state of group) {
      const signature = alphabet
        .map((symbol) => {
          const dest = dfa.transitions.get(state)?.get(symbol)?.[0];
          return dest === undefined ? "-" : groupIndexOf.get(dest);
        })
        .join(",");
      const bucket = buckets.get(signature);
      if (bucket) {
        bucket.push(state);
      } else {
        buckets.set(signature, [state]);
      }
    }
    if (buckets.size > 1) changed = true;
    newGroups.push(...buckets.values());
  }

  return { groups: newGroups, changed };
}

/**
 * refine()'s per-state signature loop runs once per fixpoint round (up to
 * stateCount rounds), so its real cost is stateCount^2 * alphabetSize —
 * fine for a handful of symbols, not fine for a `.`-heavy pattern whose
 * alphabet is however many distinct ASCII codes its character classes
 * cover (up to 126). Alphabet compression (above) usually drives that
 * down to ~1 for a single repeated class, but a pattern can still be
 * constructed where every symbol's transition column really is distinct
 * (no two symbols ever collapse) — e.g. a long concatenation of distinct
 * single-character literals, where each literal is "live" at exactly one
 * unique state and so is never redundant with any other. For that
 * adversarial shape, compression buys nothing and the cost is still
 * stateCount^2 * alphabetSize.
 *
 * This threshold is a backstop against that shape, not the primary fix —
 * the primary fix is the compression above. Derivation: the engine's
 * alphabet is ASCII-only (at most 128 symbols, CLAUDE.md §10), so even the
 * fully-adversarial case can't push alphabetSize past 128. Measured on the
 * WASM build pre-compression (Stage 1 of the issue #64 follow-up review):
 * stateCount=501, alphabetSize=126 (a `.` x500 chain) cost ~6793ms, i.e.
 * ~4637 (stateCount^2 * alphabetSize) units per millisecond. Capping
 * worst-case synchronous blocking at ~2s on that same hardware gives
 * 2000ms * 4637 ~= 9.27M; rounded down for margin. Post-compression, the
 * same `.` x500 case now costs 500^2 * 1 = 250,000 — 40x under this
 * threshold — while a 128-symbol, zero-compression, 500-state adversarial
 * case (500^2 * 128 = 32,000,000) is caught well before it would run.
 */
const MAX_MINIMIZATION_WORK = 10_000_000;

class MinimizationFailure extends Error {
  readonly parseError: { type: "AutomatonTooComplex"; position: number; expected: string; found: string };
  constructor(stateCount: number, alphabetSize: number) {
    super("AutomatonTooComplex");
    this.parseError = {
      type: "AutomatonTooComplex",
      position: 0,
      expected: `stateCount^2 * alphabetSize <= ${MAX_MINIMIZATION_WORK}`,
      found: `stateCount=${stateCount}, alphabetSize=${alphabetSize} (stateCount^2 * alphabetSize = ${stateCount * stateCount * alphabetSize})`,
    };
  }
}

/** MinimizationPass entry point: DFA in, minimal DFA out (Moore's algorithm). */
export function minimize(dfa: Automaton): Automaton {
  const alphabet = alphabetOf(dfa);
  const representatives = representativeAlphabetOf(dfa, alphabet, dfa.stateCount);

  const work = dfa.stateCount * dfa.stateCount * representatives.length;
  if (work > MAX_MINIMIZATION_WORK) throw new MinimizationFailure(dfa.stateCount, representatives.length);

  const allStates = Array.from({ length: dfa.stateCount }, (_, i) => i);
  const accepting = allStates.filter((s) => dfa.acceptStates.has(s));
  const nonAccepting = allStates.filter((s) => !dfa.acceptStates.has(s));

  // Coarsest safe starting partition: accepting vs non-accepting (skip empty groups).
  let groups = [nonAccepting, accepting].filter((g) => g.length > 0);

  // Fixpoint: keep refining until a full pass produces zero splits. Uses
  // the compressed representative list, not the full alphabet — see
  // representativeAlphabetOf's comment for why that's sound.
  let changed = true;
  while (changed) {
    const result = refine(groups, dfa, representatives);
    groups = result.groups;
    changed = result.changed;
  }

  const groupIndexOfState = new Map<number, number>();
  groups.forEach((group, index) => {
    for (const state of group) groupIndexOfState.set(state, index);
  });

  // Renumber groups via a worklist starting from the start group, so IDs are
  // assigned in a deterministic discovery order (same style as the other passes)
  // rather than the arbitrary order refinement happened to produce them in.
  const canonicalId = new Map<number, number>(); // original group index -> canonical new id
  const transitions = new Map<number, Map<string, number[]>>();
  const startGroupIndex = groupIndexOfState.get(dfa.startState)!;

  function idFor(groupIndex: number): number {
    let id = canonicalId.get(groupIndex);
    if (id === undefined) {
      id = canonicalId.size;
      canonicalId.set(groupIndex, id);
    }
    return id;
  }

  const startState = idFor(startGroupIndex);
  const worklist = [startGroupIndex];
  const processed = new Set<number>();

  while (worklist.length > 0) {
    const groupIndex = worklist.pop()!;
    if (processed.has(groupIndex)) continue;
    processed.add(groupIndex);

    const representative = groups[groupIndex][0]; // any member; refinement guarantees they all agree
    const currentId = idFor(groupIndex);

    for (const symbol of alphabet) {
      const dest = dfa.transitions.get(representative)?.get(symbol)?.[0];
      if (dest === undefined) continue;

      const destGroupIndex = groupIndexOfState.get(dest)!;
      const destId = idFor(destGroupIndex);

      let bySymbol = transitions.get(currentId);
      if (!bySymbol) {
        bySymbol = new Map();
        transitions.set(currentId, bySymbol);
      }
      bySymbol.set(symbol, [destId]);

      if (!processed.has(destGroupIndex)) worklist.push(destGroupIndex);
    }
  }

  const acceptStates = new Set<number>();
  groups.forEach((group, groupIndex) => {
    if (dfa.acceptStates.has(group[0])) {
      acceptStates.add(idFor(groupIndex));
    }
  });

  return {
    stateCount: canonicalId.size,
    startState,
    acceptStates,
    transitions,
  };
}