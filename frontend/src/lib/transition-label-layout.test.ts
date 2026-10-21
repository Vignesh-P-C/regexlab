import { describe, expect, it } from "vitest";
import {
  findTransitionLabelCollisions,
  placeTransitionLabels,
  type LabelRoute,
  type LabelPoint,
} from "./transition-label-layout";

function route(
  key: string,
  label: string,
  start: LabelPoint,
  control: LabelPoint,
  end: LabelPoint,
  preferredSide = 1,
): LabelRoute {
  return { key, label, start, control, end, preferredSide };
}

function expectCollisionFree(routes: LabelRoute[], states: LabelPoint[]) {
  const labels = placeTransitionLabels(routes, states);
  expect(findTransitionLabelCollisions(routes, states, labels)).toEqual({
    nodes: [],
    labels: [],
    edges: [],
  });
  return labels;
}

describe("transition label layout", () => {
  it("keeps reciprocal arrows, an epsilon label, and a self-loop clear", () => {
    const states = [{ x: 0, y: 100 }, { x: 220, y: 100 }, { x: 440, y: 100 }];
    const routes = [
      route("0>1", "a,b", { x: 20, y: 100 }, { x: 110, y: 100 }, { x: 200, y: 100 }),
      route("1>0", "eps", { x: 200, y: 100 }, { x: 110, y: 40 }, { x: 20, y: 100 }),
      route("1>2", "c", { x: 240, y: 100 }, { x: 330, y: 100 }, { x: 420, y: 100 }),
      route("2>2", "eps", { x: 432, y: 80 }, { x: 440, y: 56 }, { x: 448, y: 80 }, -1),
    ];
    expectCollisionFree(routes, states);
  });

  it("separates long merged labels on three outgoing arrows", () => {
    const states = [
      { x: 0, y: 100 },
      { x: 500, y: 0 },
      { x: 500, y: 100 },
      { x: 500, y: 200 },
      { x: 1000, y: 100 },
    ];
    const routes = [
      route("0>1", "a,b,c,d,e,f,g,h,i,j,k,l", { x: 20, y: 100 }, { x: 260, y: 50 }, { x: 480, y: 0 }),
      route("0>2", "eps", { x: 20, y: 100 }, { x: 260, y: 100 }, { x: 480, y: 100 }),
      route("0>3", "m", { x: 20, y: 100 }, { x: 260, y: 150 }, { x: 480, y: 200 }),
      route("2>4", "n,o,p", { x: 520, y: 100 }, { x: 760, y: 100 }, { x: 980, y: 100 }),
    ];
    expectCollisionFree(routes, states);
  });

  it("keeps labels clear around a back edge and a layer-skipping edge", () => {
    const states = [
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      { x: 600, y: 100 },
      { x: 900, y: 100 },
    ];
    const routes = [
      route("0>1", "a", { x: 20, y: 100 }, { x: 150, y: 100 }, { x: 280, y: 100 }),
      route("1>2", "b", { x: 320, y: 100 }, { x: 450, y: 100 }, { x: 580, y: 100 }),
      route("2>3", "c", { x: 620, y: 100 }, { x: 750, y: 100 }, { x: 880, y: 100 }),
      route("0>2", "d", { x: 20, y: 100 }, { x: 300, y: 10 }, { x: 580, y: 100 }),
      route("3>1", "e", { x: 880, y: 100 }, { x: 600, y: 220 }, { x: 320, y: 100 }),
    ];
    expectCollisionFree(routes, states);
  });

  it("places the same labels at the same coordinates regardless of input order", () => {
    const states = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }];
    const routes = [
      route("0>1", "long,label", { x: 20, y: 0 }, { x: 160, y: 0 }, { x: 280, y: 0 }),
      route("0>2", "eps", { x: 20, y: 0 }, { x: 160, y: 50 }, { x: 280, y: 100 }),
    ];
    const forward = placeTransitionLabels(routes, states);
    const reversed = placeTransitionLabels([...routes].reverse(), states);
    expect([...forward.entries()].sort()).toEqual([...reversed.entries()].sort());
  });
});
