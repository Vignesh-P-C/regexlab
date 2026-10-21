export type LabelPoint = { x: number; y: number };
export type LabelBounds = { left: number; top: number; right: number; bottom: number };
export type LabelRoute = {
  key: string;
  label: string;
  start: LabelPoint;
  control: LabelPoint;
  end: LabelPoint;
  preferredSide: number;
};
export type PlacedLabel = { x: number; y: number; bounds: LabelBounds };
export type LabelCollisionReport = {
  nodes: string[];
  labels: string[];
  edges: string[];
};

const STATE_RADIUS = 20;
const BOX_PAD = 3;
const OFFSETS = [11, 21, 33, 47];
const T_VALUES = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
const SAMPLE_COUNT = 32;

/** A stable, deliberately generous estimate for the 12px SVG edge-label font. */
export function estimateTransitionLabelWidth(text: string): number {
  let width = 10;
  for (const char of text) {
    if (" ilI.,:;!'|".includes(char)) width += 3.6;
    else if ("MW@#%&".includes(char)) width += 9.6;
    else if (char.codePointAt(0)! > 0x2fff) width += 12;
    else width += 7.2;
  }
  return Math.max(18, width);
}

function pointOnRoute(route: LabelRoute, t: number): LabelPoint {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * route.start.x + 2 * inverse * t * route.control.x + t * t * route.end.x,
    y: inverse * inverse * route.start.y + 2 * inverse * t * route.control.y + t * t * route.end.y,
  };
}

function sampleRoute(route: LabelRoute): LabelPoint[] {
  return Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) =>
    pointOnRoute(route, index / SAMPLE_COUNT),
  );
}

function labelBounds(x: number, y: number, text: string): LabelBounds {
  const halfWidth = estimateTransitionLabelWidth(text) / 2 + BOX_PAD;
  return {
    left: x - halfWidth,
    right: x + halfWidth,
    top: y - 12 - BOX_PAD,
    bottom: y + 4 + BOX_PAD,
  };
}

function overlaps(a: LabelBounds, b: LabelBounds): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function hitsState(box: LabelBounds, state: LabelPoint): boolean {
  const nearestX = Math.max(box.left, Math.min(state.x, box.right));
  const nearestY = Math.max(box.top, Math.min(state.y, box.bottom));
  return Math.hypot(state.x - nearestX, state.y - nearestY) <= STATE_RADIUS + 2;
}

function segmentHitsBox(a: LabelPoint, b: LabelPoint, box: LabelBounds): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let low = 0;
  let high = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.left, box.right - a.x, a.y - box.top, box.bottom - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}

function routeHitsBox(samples: LabelPoint[], box: LabelBounds): boolean {
  for (let i = 1; i < samples.length; i++) {
    if (segmentHitsBox(samples[i - 1], samples[i], box)) return true;
  }
  return false;
}

function candidateAt(
  route: LabelRoute,
  t: number,
  side: number,
  offset: number,
): PlacedLabel {
  const point = pointOnRoute(route, t);
  const inverse = 1 - t;
  const tangentX =
    2 * inverse * (route.control.x - route.start.x) +
    2 * t * (route.end.x - route.control.x);
  const tangentY =
    2 * inverse * (route.control.y - route.start.y) +
    2 * t * (route.end.y - route.control.y);
  const length = Math.hypot(tangentX, tangentY) || 1;
  const x = point.x - (tangentY / length) * side * offset;
  const y = point.y + (tangentX / length) * side * offset + 4;
  return { x, y, bounds: labelBounds(x, y, route.label) };
}

function candidateScore(
  route: LabelRoute,
  box: LabelBounds,
  states: LabelPoint[],
  routes: LabelRoute[],
  samples: Map<string, LabelPoint[]>,
  occupied: LabelBounds[],
): number {
  let score = states.some((state) => hitsState(box, state)) ? 100 : 0;
  if (occupied.some((other) => overlaps(box, other))) score += 40;
  for (const other of routes) {
    if (other.key !== route.key && routeHitsBox(samples.get(other.key)!, box)) score += 20;
  }
  return score;
}

/**
 * Place each label against the complete graph geometry. Long labels are placed
 * first; candidates move along the actual quadratic curve and to either side.
 */
export function placeTransitionLabels(
  routes: LabelRoute[],
  states: LabelPoint[],
): Map<string, PlacedLabel> {
  const samples = new Map(routes.map((route) => [route.key, sampleRoute(route)]));
  const ordered = [...routes].sort(
    (a, b) =>
      estimateTransitionLabelWidth(b.label) - estimateTransitionLabelWidth(a.label) ||
      a.key.localeCompare(b.key),
  );
  const occupied: LabelBounds[] = [];
  const result = new Map<string, PlacedLabel>();

  for (const route of ordered) {
    const sides = [route.preferredSide || 1, -(route.preferredSide || 1)];
    let best: { label: PlacedLabel; score: number } | undefined;
    for (const t of T_VALUES) {
      for (const side of sides) {
        for (const offset of OFFSETS) {
          const label = candidateAt(route, t, side, offset);
          const score = candidateScore(route, label.bounds, states, routes, samples, occupied);
          if (!best || score < best.score) best = { label, score };
          if (score === 0) break;
        }
        if (best?.score === 0) break;
      }
      if (best?.score === 0) break;
    }
    const placed = best!.label;
    result.set(route.key, placed);
    occupied.push(placed.bounds);
  }
  return result;
}

/** Geometry assertions for the regression fixtures and manual review matrix. */
export function findTransitionLabelCollisions(
  routes: LabelRoute[],
  states: LabelPoint[],
  labels: Map<string, PlacedLabel>,
): LabelCollisionReport {
  const nodes: string[] = [];
  const labelPairs: string[] = [];
  const edges: string[] = [];
  const samples = new Map(routes.map((route) => [route.key, sampleRoute(route)]));

  for (const route of routes) {
    const placed = labels.get(route.key);
    if (!placed) continue;
    if (states.some((state) => hitsState(placed.bounds, state))) nodes.push(route.key);
    for (const other of routes) {
      if (other.key !== route.key && routeHitsBox(samples.get(other.key)!, placed.bounds)) {
        edges.push(route.key + " intersects " + other.key);
      }
    }
  }
  for (let first = 0; first < routes.length; first++) {
    for (let second = first + 1; second < routes.length; second++) {
      const a = labels.get(routes[first].key);
      const b = labels.get(routes[second].key);
      if (a && b && overlaps(a.bounds, b.bounds)) {
        labelPairs.push(routes[first].key + " overlaps " + routes[second].key);
      }
    }
  }
  return { nodes, labels: labelPairs, edges };
}
