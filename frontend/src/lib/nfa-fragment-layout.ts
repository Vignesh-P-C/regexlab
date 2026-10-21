import type { ASTNode } from "../types/engine";

/**
 * A textbook Thompson diagram lays states out by their position in the
 * *recursive construction*, not by shortest graph distance from the start
 * state (plain BFS). The two disagree exactly when a loop's "skip" edge
 * reaches a state in fewer hops than the loop body does -- which is every
 * star/optional -- so BFS puts the loop's exit state right next to its
 * entry instead of after the body it's meant to follow, and then can't
 * tell the loop-back edge from the skip edge by hop count alone.
 *
 * This walks the AST the same way thompson-pass.ts's buildFragment does --
 * same node order, same "new states are allocated after both children"
 * rule -- so the Nth state id this function hands out is the Nth state id
 * the engine itself allocated. That lets every state get a layer from its
 * place in the construction (entry, then the body, then exit) instead of
 * from a graph search, with no back/skip-edge classification needed at
 * drawing time: a loop-back edge's layer always goes DOWN, and a skip
 * edge's layer always jumps by more than one, as a direct consequence of
 * how layers are assigned here.
 */
export type FragmentNfaLayout = { layer: number[]; stateCount: number };

type Fragment = { start: number; accept: number; entryLayer: number; exitLayer: number };

class LayoutBuilder {
  private nextId = 0;
  readonly layer: number[] = [];

  newState(atLayer: number): number {
    const id = this.nextId++;
    this.layer[id] = atLayer;
    return id;
  }
}

function buildFragment(node: ASTNode, startLayer: number, builder: LayoutBuilder): Fragment {
  switch (node.kind) {
    case "char":
    case "charset": {
      const start = builder.newState(startLayer);
      const accept = builder.newState(startLayer + 1);
      return { start, accept, entryLayer: startLayer, exitLayer: startLayer + 1 };
    }

    case "concat": {
      const left = buildFragment(node.left, startLayer, builder);
      // The concat epsilon-edge is one hop, same as any other edge that
      // isn't a loop-back or a skip, so the right fragment starts one
      // layer after the left one ends.
      const right = buildFragment(node.right, left.exitLayer + 1, builder);
      return { start: left.start, accept: right.accept, entryLayer: startLayer, exitLayer: right.exitLayer };
    }

    case "alt": {
      // Both branches split off the same entry layer; mirrors
      // thompson-pass.ts's allocation order: left fragment, then right
      // fragment, THEN the new start/accept states (allocated last).
      const left = buildFragment(node.left, startLayer + 1, builder);
      const right = buildFragment(node.right, startLayer + 1, builder);
      const joinLayer = Math.max(left.exitLayer, right.exitLayer) + 1;
      const start = builder.newState(startLayer);
      const accept = builder.newState(joinLayer);
      return { start, accept, entryLayer: startLayer, exitLayer: joinLayer };
    }

    case "star":
    case "plus":
    case "optional": {
      // The inner fragment is the "main chain" the diagram reads through;
      // the skip (star/optional) and loop-back (star/plus) edges are the
      // two bows off of it, not part of the chain's own length.
      const inner = buildFragment(node.child, startLayer + 1, builder);
      const exitLayer = inner.exitLayer + 1;
      const start = builder.newState(startLayer);
      const accept = builder.newState(exitLayer);
      return { start, accept, entryLayer: startLayer, exitLayer };
    }
  }
}

/**
 * Layout from the AST alone -- no dependency on the automaton's edges.
 * `expectedStateCount` is a defensive check: if this ever disagrees with
 * the real automaton's `stateCount` (thompson-pass.ts's allocation order
 * changed out from under this duplicate of it, or the AST passed in
 * doesn't actually match the automaton being drawn), the caller should
 * fall back to the generic BFS layout rather than trust a layer array
 * that's indexing the wrong states.
 */
export function layoutNfaFragments(ast: ASTNode): FragmentNfaLayout {
  const builder = new LayoutBuilder();
  buildFragment(ast, 0, builder);
  return { layer: builder.layer, stateCount: builder.layer.length };
}
