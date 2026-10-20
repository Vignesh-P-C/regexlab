/** Rabin–Scott worklist subset construction over epsilon closures. */
import type { Automaton } from "../types.js";
import { decodeCharacterSet, transitionMatches } from "../character-set.js";
function epsilonClosure(nfa: Automaton, states: Iterable<number>): Set<number> {
  const closure = new Set(states), stack = [...closure];
  while (stack.length) {
    const state = stack.pop()!;
    for (const target of nfa.transitions.get(state)?.get("eps") ?? []) if (!closure.has(target)) { closure.add(target); stack.push(target); }
  }
  return closure;
}
function move(nfa: Automaton, states: Iterable<number>, symbol: string): Set<number> {
  const result = new Set<number>();
  for (const state of states) for (const [label, targets] of nfa.transitions.get(state) ?? []) {
    if (transitionMatches(label, symbol)) targets.forEach((target) => result.add(target));
  }
  return result;
}
function alphabetOf(nfa: Automaton): string[] {
  const symbols = new Set<string>();
  for (const bySymbol of nfa.transitions.values()) for (const label of bySymbol.keys()) {
    if (label === "eps") continue;
    const set = decodeCharacterSet(label);
    if (set) set.forEach((code) => symbols.add(String.fromCharCode(code)));
    else if (label.length === 1) symbols.add(label);
  }
  return [...symbols].sort();
}
function setKey(states: Set<number>): string { return [...states].sort((a, b) => a - b).join(","); }
export function subsetConstruction(nfa: Automaton): Automaton {
  const alphabet = alphabetOf(nfa), stateSets: Set<number>[] = [], idByKey = new Map<string, number>();
  const transitions = new Map<number, Map<string, number[]>>();
  function idFor(states: Set<number>): number {
    const key = setKey(states); let id = idByKey.get(key);
    if (id === undefined) { id = stateSets.length; idByKey.set(key, id); stateSets.push(states); }
    return id;
  }
  const startState = idFor(epsilonClosure(nfa, [nfa.startState]));
  const worklist = [startState], processed = new Set<number>();
  while (worklist.length) {
    const current = worklist.pop()!; if (processed.has(current)) continue; processed.add(current);
    for (const symbol of alphabet) {
      const moved = move(nfa, stateSets[current], symbol); if (!moved.size) continue;
      const target = idFor(epsilonClosure(nfa, moved));
      let bySymbol = transitions.get(current); if (!bySymbol) { bySymbol = new Map(); transitions.set(current, bySymbol); }
      bySymbol.set(symbol, [target]); if (!processed.has(target)) worklist.push(target);
    }
  }
  const acceptStates = new Set<number>();
  stateSets.forEach((set, id) => { if ([...set].some((state) => nfa.acceptStates.has(state))) acceptStates.add(id); });
  return { stateCount: stateSets.length, startState, acceptStates, transitions };
}
