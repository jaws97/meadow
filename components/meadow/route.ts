// Route planning for tap-to-go. A straight run is used whenever it is clear;
// otherwise the run goes through the path nodes in layout.ts (the two rings
// and the spoke mid-points), which are joined wherever a cart-wide body fits
// between them. The graph is built once on first use; a query adds the start
// and the goal as temporary nodes and runs A* over about forty nodes, so it is
// far below a millisecond even on a phone.
import { PATH_NODES } from "@/components/meadow/layout";
import { segmentClear, type P2 } from "@/components/meadow/space";

/** Half the cart's width plus a margin, for runs between path nodes. */
export const ROUTE_CLEARANCE = 0.55;
/** The first and last legs may start close to a wall (a parked cart's nose sits by a kerb). */
const END_CLEARANCE = 0.32;

let edges: number[][] | null = null;

function graph(): number[][] {
  if (edges) return edges;
  const n = PATH_NODES.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = PATH_NODES[i];
      const b = PATH_NODES[j];
      // Long links would let a route skim past corners the lookahead then cuts.
      if (Math.hypot(a.x - b.x, a.z - b.z) > 9) continue;
      if (segmentClear(a.x, a.z, b.x, b.z, ROUTE_CLEARANCE)) {
        out[i].push(j);
        out[j].push(i);
      }
    }
  }
  edges = out;
  return out;
}

/**
 * Waypoints from `start` to `goal`, both included. Falls back to the direct
 * line when no route exists (for instance if the cart has hopped into a bed),
 * so the autopilot always has something to try.
 */
export function planRoute(start: P2, goal: P2): P2[] {
  if (segmentClear(start.x, start.z, goal.x, goal.z, END_CLEARANCE)) return [start, goal];

  const g = graph();
  const n = PATH_NODES.length;
  const S = n;
  const G = n + 1;
  const pos = (i: number): P2 => (i === S ? start : i === G ? goal : PATH_NODES[i]);
  const startLinks: number[] = [];
  const goalLinks: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = PATH_NODES[i];
    if (segmentClear(start.x, start.z, p.x, p.z, END_CLEARANCE)) startLinks.push(i);
    if (segmentClear(p.x, p.z, goal.x, goal.z, END_CLEARANCE)) goalLinks.push(i);
  }
  if (startLinks.length === 0 || goalLinks.length === 0) return [start, goal];

  const neighbours = (i: number): number[] => {
    if (i === S) return startLinks;
    const list = g[i];
    return goalLinks.includes(i) ? [...list, G] : list;
  };
  const dist = (i: number, j: number) => {
    const a = pos(i);
    const b = pos(j);
    return Math.hypot(a.x - b.x, a.z - b.z);
  };

  const gScore = new Map<number, number>([[S, 0]]);
  const came = new Map<number, number>();
  const open = new Set<number>([S]);
  const closed = new Set<number>();
  while (open.size > 0) {
    let cur = -1;
    let best = Infinity;
    for (const i of open) {
      const f = (gScore.get(i) ?? Infinity) + dist(i, G);
      if (f < best) {
        best = f;
        cur = i;
      }
    }
    if (cur === G) break;
    open.delete(cur);
    closed.add(cur);
    for (const nb of neighbours(cur)) {
      if (closed.has(nb)) continue;
      const tentative = (gScore.get(cur) ?? Infinity) + dist(cur, nb);
      if (tentative < (gScore.get(nb) ?? Infinity)) {
        gScore.set(nb, tentative);
        came.set(nb, cur);
        open.add(nb);
      }
    }
  }
  if (!came.has(G)) return [start, goal];

  const chain: number[] = [G];
  while (chain[chain.length - 1] !== S) chain.push(came.get(chain[chain.length - 1])!);
  chain.reverse();
  return smooth(chain.map((i) => ({ x: pos(i).x, z: pos(i).z })));
}

/**
 * Drops waypoints that a clear straight run can skip, so the cart does not
 * zigzag node to node (or double back to a node it is already past). If the
 * start or the goal is itself close to a wall, runs from or to it are judged
 * with the tighter end-leg clearance, or nothing could ever skip past them.
 */
function smooth(points: P2[]): P2[] {
  const out: P2[] = [points[0]];
  const last = points.length - 1;
  const tight = (p: P2) => !segmentClear(p.x, p.z, p.x, p.z, ROUTE_CLEARANCE);
  const startTight = tight(points[0]);
  const goalTight = tight(points[last]);
  let i = 0;
  while (i < last) {
    let j = last;
    const from = i;
    const clearance = (k: number) => ((from === 0 && startTight) || (k === last && goalTight) ? END_CLEARANCE : ROUTE_CLEARANCE);
    while (j > i + 1 && !segmentClear(points[i].x, points[i].z, points[j].x, points[j].z, clearance(j))) j--;
    out.push(points[j]);
    i = j;
  }
  return out;
}
