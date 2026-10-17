// Route planning for tap-to-go, plot visits and the firefly trail. A straight run is used whenever it is clear;
// otherwise the run follows the Meadow's path graph (layout.ts: nodes round every ring path, joined along the rings
// and out along the avenues through the plazas). A query links the start and the goal to the nearest few graph nodes
// they can reach in a straight line and runs A* over a few hundred nodes, well under a millisecond on a phone.
import { meadowLayout, type PathNode } from "@/components/meadow/layout";
import { segmentClear, type P2 } from "@/components/meadow/space";

/** Half the cart's width plus a margin, for runs between path nodes. */
export const ROUTE_CLEARANCE = 0.55;
/** The first and last legs may start close to a wall (a parked cart sits by a kerb). */
const END_CLEARANCE = 0.32;
/** How many nearby nodes the start and the goal try to link to, and how far they look. */
const LINKS = 6;
const LINK_REACH = 9;

function nearbyLinks(p: P2, nodes: readonly PathNode[]): number[] {
  const near: Array<[number, number]> = [];
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - p.x, nodes[i].z - p.z);
    if (d < LINK_REACH) near.push([d, i]);
  }
  near.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [, i] of near) {
    if (segmentClear(p.x, p.z, nodes[i].x, nodes[i].z, END_CLEARANCE)) out.push(i);
    if (out.length >= LINKS) break;
  }
  return out;
}

/**
 * Waypoints from `start` to `goal`, both included. Falls back to the direct line when no route exists (for
 * instance if the cart has hopped into a bed), so the autopilot always has something to try.
 */
export function planRoute(start: P2, goal: P2): P2[] {
  if (segmentClear(start.x, start.z, goal.x, goal.z, END_CLEARANCE)) return [start, goal];

  const { nodes, edges } = meadowLayout();
  const n = nodes.length;
  const S = n;
  const G = n + 1;
  const pos = (i: number): P2 => (i === S ? start : i === G ? goal : nodes[i]);
  const startLinks = nearbyLinks(start, nodes);
  const goalLinks = new Set(nearbyLinks(goal, nodes));
  if (startLinks.length === 0 || goalLinks.size === 0) return [start, goal];

  const neighbours = (i: number): number[] => {
    if (i === S) return startLinks;
    return goalLinks.has(i) ? [...edges[i], G] : edges[i];
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

/** Total length of a polyline. */
export function routeLength(points: readonly P2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}

/**
 * Drops waypoints that a clear straight run can skip, so the cart does not zigzag node to node (or double back to a
 * node it is already past). If the start or the goal is itself close to a wall, runs from or to it are judged with
 * the tighter end-leg clearance, or nothing could ever skip past them.
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
