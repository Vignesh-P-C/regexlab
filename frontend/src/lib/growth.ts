// issue #68 — Subset Growth / NFA Structure Lab (PR A). Small frontend-
// side helper: the engine's JSON `Automaton` shape (Record-based, per
// frontend/src/types/engine.ts) already carries every transition, so
// listing eligible epsilon edges for the what-if panel doesn't need its
// own WASM export — it's a pure read over data the pipeline already
// returned. Mirrors engine/candidate.ts's listEligibleEpsilonEdges()
// logic for the Record-based shape instead of the engine's Map-based one.

import type { Automaton } from "../types/engine";

export type EligibleEdge = { source: number; target: number };

export function listEligibleEpsilonEdges(automaton: Automaton): EligibleEdge[] {
  const edges: EligibleEdge[] = [];
  for (const [sourceStr, bySymbol] of Object.entries(automaton.transitions)) {
    const targets = bySymbol["eps"];
    if (!targets) continue;
    const source = Number(sourceStr);
    for (const target of new Set(targets)) {
      edges.push({ source, target });
    }
  }
  edges.sort((a, b) => a.source - b.source || a.target - b.target);
  return edges;
}
