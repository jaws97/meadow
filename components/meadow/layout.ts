// The Meadow's ground plan, in metres, with the rose dais at the origin. Everything that has a footprint is described
// here once, as plain 2D shapes plus a height, and every consumer derives from it: the meshes, the Rapier colliders,
// the glide mover's collisions, the route planner and the plot picker. That keeps the physics-free fallback and the
// physics cart driving exactly the same Meadow.
//
// The plan, from the middle out: the dais with the owner's rose; a wide inner path (wide enough that a visit to the
// innermost plants is a calm pull-up, not a shuffle); then raised beds, two plot rows each, separated by ring paths;
// an outer promenade; a lawn; a hedge; a ring of trees. Avenues cut across the beds (four through the inner bed on
// the diagonals, eight through the rest), and where an avenue meets a ring path the bed corners are cut back into a
// little plaza with a lantern on each corner, so the cart turns without scraping. The plot rows and the avenue
// angles come from lib/server/plots.ts, which the server hands plots out by, so a plot is always drawn where the
// server put it. The beds grow outward in pairs of rings only if the Meadow ever outgrows the six planned rings
// (meadowLayout is rebuilt for the rings in use; see setLayoutRings).
//
// Angles: a point at polar angle `a` sits at (r cos a, 0, r sin a). Yaw is a rotation about +y as three.js applies
// it, so a body with yaw `y` faces (cos y, 0, -sin y) along its local +x, which is the cart's forward axis.
import { avenueAngles, firstPlotOfRing, PLOT_RINGS, plotRing, ringAt } from "@/lib/server/plots";

export interface P2 {
  x: number;
  z: number;
}

export interface Box2 {
  x: number;
  z: number;
  /** half extent along the box's local x (its length) */
  hx: number;
  /** half extent along the box's local z (its thickness) */
  hz: number;
  yaw: number;
  /** top of the solid, from the ground */
  h: number;
}

export interface Circle2 {
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface Tree extends Circle2 {
  canopyY: number;
  canopyR: number;
}

export interface PathNode {
  x: number;
  z: number;
  /** heading for a cart respawned here: along the ring, or out along an avenue */
  yaw: number;
}

/** One ring path (index 0 is the inner path round the dais, the last the outer promenade). */
export interface PathRing {
  inner: number;
  outer: number;
  /** centreline radius */
  r: number;
}

export interface BedRing {
  inner: number;
  outer: number;
}

export interface Avenue {
  angle: number;
  /** centreline radii it runs between (the centres of the ring paths at its two ends) */
  from: number;
  to: number;
}

/** One raised bed between two avenues: its outline (closed, corners cut at the plazas) and a quick bounding test. */
export interface Sector {
  bed: number;
  points: P2[];
  rMin: number;
  rMax: number;
}

/** Where an avenue crosses a ring path: the plaza's centre and the radius its paving reaches. */
export interface Plaza extends P2 {
  r: number;
}

export interface Plot {
  index: number;
  ring: number;
  /** the plant's place */
  x: number;
  z: number;
  /** polar angle and radius of the plant */
  a: number;
  r: number;
  /** which ring path the plant is visited from, and which side of the bed faces it */
  path: number;
  side: "inner" | "outer";
  /** where the cart pulls up to visit: on the path, beside the bed, level with the plant */
  park: P2;
  /** the name stake: in front of the plant toward the path, a little to one side, facing the path */
  stake: P2 & { yaw: number };
}

export interface MeadowLayout {
  /** plot rings drawn (an even number, six at least) */
  rings: number;
  beds: BedRing[];
  paths: PathRing[];
  avenues: Avenue[];
  sectors: Sector[];
  kerbs: Box2[];
  hedge: Box2[];
  trees: Tree[];
  lanterns: P2[];
  /** where avenues cross ring paths, for the paving */
  plazas: Plaza[];
  circles: Circle2[];
  boxes: Box2[];
  /** radius of the hedge's inner face; nothing drives beyond it */
  hedgeR: number;
  /** radius of the lawn as drawn (the far ground carries on under the fog) */
  groundR: number;
  plots: Plot[];
  nodes: PathNode[];
  edges: number[][];
  spawn: PathNode;
}

/** A raised plinth, taller than the cart's chassis floor so it cannot be driven onto. */
export const DAIS = { r: 3.6, h: 0.68 } as const;

/**
 * The raised beds: a low stone kerb round soil a hand's width below its top. (The cart is kept out of the beds by an
 * unseen barrier above the stone in PhysicsWorld, so the kerb can stay low and gentle.) `margin` is how far each
 * plant row sits inside the bed's face.
 */
export const BED = { kerbT: 0.2, kerbH: 0.36, soilH: 0.3, margin: 0.85 } as const;

/** Half the avenues' width, how far the plaza corners are cut back, and the promenade's width. */
export const AVENUE_HALF = 1.2;
const CHAMFER = 1.05;
const PROMENADE = 2.6;
/** Lawn between the promenade and the hedge, and the hedge itself. */
const LAWN = 2.8;
export const HEDGE_SPEC = { t: 0.9, h: 1.35 } as const;
/** How far in from a bed's face the cart pulls up beside a plant. */
const PARK_OFF = 0.85;
/** How far the cart at the Meadow's start is turned off the path, its nose out toward the camera (radians). */
const SPAWN_TURN = 0.85;

const TAU = Math.PI * 2;

/** A heading along +a around a ring at polar angle a. */
export const tangentYaw = (a: number) => Math.atan2(-Math.cos(a), -Math.sin(a));
/** The yaw that faces along the planar direction (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx);

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

const polar = (r: number, a: number): P2 => ({ x: r * Math.cos(a), z: r * Math.sin(a) });

/** A deterministic pseudo-random sequence, for the trees' scatter. */
function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ---- beds, paths, avenues ------------------------------------------------------------------------------------------

function buildBeds(rings: number): BedRing[] {
  const beds: BedRing[] = [];
  for (let b = 0; b * 2 < rings; b++) {
    const a = ringAt(b * 2)!, c = ringAt(b * 2 + 1)!;
    beds.push({ inner: a.radius - BED.margin, outer: c.radius + BED.margin });
  }
  return beds;
}

function buildPaths(beds: BedRing[]): PathRing[] {
  const paths: PathRing[] = [];
  const ring = (inner: number, outer: number) => ({ inner, outer, r: (inner + outer) / 2 });
  paths.push(ring(DAIS.r, beds[0].inner));
  for (let b = 1; b < beds.length; b++) paths.push(ring(beds[b - 1].outer, beds[b].inner));
  const last = beds[beds.length - 1].outer;
  paths.push(ring(last, last + PROMENADE));
  return paths;
}

function buildAvenues(beds: BedRing[], paths: PathRing[]): Avenue[] {
  const inner = avenueAngles(0);
  const all = new Set<number>();
  for (let b = 0; b < beds.length; b++) for (const a of avenueAngles(b)) all.add(Math.round(a * 1e6) / 1e6);
  const out: Avenue[] = [];
  for (const a of [...all].sort((p, q) => p - q)) {
    // the inner bed's avenues start at the inner path; the rest start at the first ring path
    const fromBed = inner.some((x) => Math.abs(x - a) < 1e-6) ? 0 : 1;
    if (fromBed >= beds.length) continue;
    out.push({ angle: a, from: paths[fromBed].r, to: paths[paths.length - 1].r });
  }
  return out;
}

// ---- bed outlines -----------------------------------------------------------------------------------------------

/** Keeps the part of a closed polygon where dot(p - c, n) >= k (Sutherland-Hodgman against one half-plane). */
function clipHalfPlane(poly: P2[], c: P2, n: P2, k: number): P2[] {
  const out: P2[] = [];
  const side = (p: P2) => (p.x - c.x) * n.x + (p.z - c.z) * n.z - k;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** Points along an arc of radius r from angle a0 to a1 (either direction), about `step` metres apart, ends included. */
function arcPoints(r: number, a0: number, a1: number, step: number): P2[] {
  const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / step));
  return Array.from({ length: n + 1 }, (_, i) => polar(r, a0 + ((a1 - a0) * i) / n));
}

/**
 * One bed between avenue angles a0 < a1: the inner arc, the side of the a1 avenue, the outer arc back, the side of
 * the a0 avenue; then each corner cut back by CHAMFER, which makes the plazas where avenues meet ring paths.
 */
function sectorOutline(bed: BedRing, a0: number, a1: number): P2[] {
  const w = AVENUE_HALF;
  const si = Math.sqrt(bed.inner ** 2 - w * w), so = Math.sqrt(bed.outer ** 2 - w * w);
  const ai0 = a0 + Math.atan2(w, si), ai1 = a1 - Math.atan2(w, si);
  const ao0 = a0 + Math.atan2(w, so), ao1 = a1 - Math.atan2(w, so);
  const poly = [...arcPoints(bed.inner, ai0, ai1, 1.0), ...arcPoints(bed.outer, ao1, ao0, 1.0)];
  // the corners, each with the two directions of its edges running away from it
  const u = (a: number): P2 => ({ x: Math.cos(a), z: Math.sin(a) });
  const tan = (a: number, s: number): P2 => ({ x: -Math.sin(a) * s, z: Math.cos(a) * s });
  const corners: Array<[P2, P2, P2]> = [
    [polar(bed.inner, ai0), tan(ai0, 1), u(a0)],
    [polar(bed.inner, ai1), tan(ai1, -1), u(a1)],
    [polar(bed.outer, ao1), tan(ao1, -1), { x: -Math.cos(a1), z: -Math.sin(a1) }],
    [polar(bed.outer, ao0), tan(ao0, 1), { x: -Math.cos(a0), z: -Math.sin(a0) }],
  ];
  let out = poly;
  for (const [c, d1, d2] of corners) {
    const nx = d1.x + d2.x, nz = d1.z + d2.z, len = Math.hypot(nx, nz) || 1;
    const n = { x: nx / len, z: nz / len };
    out = clipHalfPlane(out, c, n, CHAMFER * (d1.x * n.x + d1.z * n.z));
  }
  return out;
}

function signedArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

/** Kerb stones along an outline: each edge one stone, its outer face on the outline. */
function kerbsOf(poly: P2[]): Box2[] {
  const inward = Math.sign(signedArea(poly)) || 1;
  const out: Box2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    // left of the edge is inside for a positive (anticlockwise in x, z) outline
    const nx = (-dz / len) * inward, nz = (dx / len) * inward;
    out.push({
      x: (a.x + b.x) / 2 + nx * (BED.kerbT / 2),
      z: (a.z + b.z) / 2 + nz * (BED.kerbT / 2),
      // a hair longer than the edge, so neighbouring stones close their corners
      hx: len / 2 + 0.04,
      hz: BED.kerbT / 2,
      yaw: yawOf(dx, dz),
      h: BED.kerbH,
    });
  }
  return out;
}

/** Lanterns stand on the cut corners, a little inside the bed. */
function lanternsOf(poly: P2[], beds: BedRing[], bed: number): P2[] {
  const out: P2[] = [];
  const b = beds[bed];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    // a chamfer edge is about CHAMFER * sqrt(2) long and lies off both arcs
    const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    const r = Math.hypot(mid.x, mid.z);
    if (Math.abs(len - CHAMFER * Math.SQRT2) > 0.35 || r < b.inner + 0.1 || r > b.outer - 0.1) continue;
    const toward = 0.42 / (Math.hypot(mid.x, mid.z) || 1);
    // inward: toward the middle of the bed's depth
    const midR = (b.inner + b.outer) / 2;
    const s = r < midR ? 1 : -1;
    out.push({ x: mid.x + mid.x * toward * s, z: mid.z + mid.z * toward * s });
  }
  return out;
}

// ---- hedge and trees -------------------------------------------------------------------------------------------

function arcBoxes(r: number, maxLen: number, t: number, h: number): Box2[] {
  const count = Math.max(8, Math.ceil((TAU * r) / maxLen));
  const step = TAU / count;
  const out: Box2[] = [];
  for (let i = 0; i < count; i++) {
    const am = step * (i + 0.5);
    const rc = r * Math.cos(step / 2);
    out.push({ x: rc * Math.cos(am), z: rc * Math.sin(am), hx: r * Math.sin(step / 2) + 0.03, hz: t / 2, yaw: tangentYaw(am), h });
  }
  return out;
}

function buildTrees(hedgeR: number): Tree[] {
  const rnd = rand(1729);
  const trees: Tree[] = [];
  const count = Math.round((TAU * (hedgeR + 6)) / 5.2);
  for (let i = 0; i < count; i++) {
    const a = ((i + rnd() * 0.6) / count) * TAU;
    const r = hedgeR + 3.2 + rnd() * 5.5 + (i % 2) * 2.4;
    const canopyR = 1.7 + rnd() * 1.3;
    trees.push({ x: r * Math.cos(a), z: r * Math.sin(a), r: 0.3, h: 2.6, canopyY: 3.6 + canopyR * 0.9 + rnd() * 1.2, canopyR });
  }
  return trees;
}

// ---- plots -----------------------------------------------------------------------------------------------------

function buildPlots(rings: number, beds: BedRing[]): Plot[] {
  const plots: Plot[] = [];
  const total = firstPlotOfRing(rings);
  for (let i = 0; i < total; i++) {
    const p = plotRing(i)!;
    const bed = Math.floor(p.ring / 2);
    const inner = p.ring % 2 === 0;
    const a = p.angle;
    const parkR = inner ? beds[bed].inner - PARK_OFF : beds[bed].outer + PARK_OFF;
    const toward = inner ? -1 : 1;
    // the stake stands between the plant and the path (just behind the low box hedging), a little to the side so it
    // never hides the plant
    const sr = p.radius + toward * 0.37;
    const sa = a + 0.3 / p.radius;
    plots.push({
      index: i,
      ring: p.ring,
      x: p.radius * Math.cos(a),
      z: p.radius * Math.sin(a),
      a,
      r: p.radius,
      path: inner ? bed : bed + 1,
      side: inner ? "inner" : "outer",
      park: polar(parkR, a),
      stake: { ...polar(sr, sa), yaw: inner ? yawOf(-Math.cos(sa), -Math.sin(sa)) : yawOf(Math.cos(sa), Math.sin(sa)) },
    });
  }
  return plots;
}

// ---- the route graph -------------------------------------------------------------------------------------------

function buildGraph(paths: PathRing[], beds: BedRing[], avenues: Avenue[]): { nodes: PathNode[]; edges: number[][] } {
  const nodes: PathNode[] = [];
  const edges: number[][] = [];
  const link = (i: number, j: number) => {
    edges[i].push(j);
    edges[j].push(i);
  };
  const add = (n: PathNode) => {
    nodes.push(n);
    edges.push([]);
    return nodes.length - 1;
  };
  // ring nodes: an even spacing round each path, plus one exactly at every avenue that meets it
  const crossing = new Map<string, number>();
  paths.forEach((path, k) => {
    const meets = avenues.filter((av) => path.r >= av.from - 0.01 && path.r <= av.to + 0.01).map((av) => av.angle);
    const n = Math.max(16, Math.ceil((TAU * path.r) / 2.4));
    const angles = Array.from({ length: n }, (_, i) => (i / n) * TAU).filter((a) => meets.every((m) => Math.abs(wrapAngle(a - m)) * path.r > 0.9));
    const all = [...angles.map((a) => ({ a, av: false })), ...meets.map((a) => ({ a, av: true }))].sort((p, q) => p.a - q.a);
    const ids = all.map(({ a, av }) => {
      const id = add({ ...polar(path.r, a), yaw: tangentYaw(a) });
      if (av) crossing.set(`${k}:${a.toFixed(5)}`, id);
      return id;
    });
    for (let i = 0; i < ids.length; i++) link(ids[i], ids[(i + 1) % ids.length]);
  });
  // avenue nodes: from each crossing out across the next bed (through its middle) to the next crossing
  for (const av of avenues) {
    let prev = -1;
    paths.forEach((path, k) => {
      if (path.r < av.from - 0.01 || path.r > av.to + 0.01) return;
      const here = crossing.get(`${k}:${av.angle.toFixed(5)}`);
      if (here === undefined) return;
      if (prev >= 0) {
        const bed = beds[k - 1];
        const mid = add({ ...polar((bed.inner + bed.outer) / 2, av.angle), yaw: yawOf(Math.cos(av.angle), Math.sin(av.angle)) });
        link(prev, mid);
        link(mid, here);
      }
      prev = here;
    });
  }
  return { nodes, edges };
}

// ---- the whole plan ----------------------------------------------------------------------------------------------

export function buildLayout(rings: number = PLOT_RINGS.length): MeadowLayout {
  const beds = buildBeds(rings);
  const paths = buildPaths(beds);
  const avenues = buildAvenues(beds, paths);
  const sectors: Sector[] = [];
  const kerbs: Box2[] = [];
  const lanterns: P2[] = [];
  beds.forEach((bed, b) => {
    const angles = avenueAngles(b);
    for (let k = 0; k < angles.length; k++) {
      const a0 = angles[k], a1 = k + 1 < angles.length ? angles[k + 1] : angles[0] + TAU;
      const points = sectorOutline(bed, a0, a1);
      sectors.push({ bed: b, points, rMin: bed.inner - 0.05, rMax: bed.outer + 0.05 });
      kerbs.push(...kerbsOf(points));
      lanterns.push(...lanternsOf(points, beds, b));
    }
  });
  // each plaza's paving reaches just past the cut corners of the beds round it
  const plazas: Plaza[] = [];
  for (const av of avenues) {
    for (const p of paths) {
      if (p.r < av.from - 0.01 || p.r > av.to + 0.01) continue;
      const half = (p.outer - p.inner) / 2;
      plazas.push({ ...polar(p.r, av.angle), r: Math.hypot(half + 0.3, AVENUE_HALF + CHAMFER) + 0.1 });
    }
  }
  const promenade = paths[paths.length - 1];
  const hedgeR = promenade.outer + LAWN;
  const hedge = arcBoxes(hedgeR + HEDGE_SPEC.t / 2, 2.2, HEDGE_SPEC.t, HEDGE_SPEC.h);
  const trees = buildTrees(hedgeR);
  const { nodes, edges } = buildGraph(paths, beds, avenues);
  // On the inner path where the camera's avenue meets it, rolling round anticlockwise: the rose fills the view behind.
  // Turned a little out toward the avenue (and the camera), so the first view is the cart's front three-quarter, the
  // jar framed by its hoop, rather than side-on with the hoop seen edge-on.
  const spawnA = Math.PI / 4;
  const spawn: PathNode = { ...polar(paths[0].r + 0.4, spawnA), yaw: tangentYaw(spawnA) + SPAWN_TURN };
  return {
    rings,
    beds,
    paths,
    avenues,
    sectors,
    kerbs,
    hedge,
    trees,
    lanterns,
    plazas,
    circles: [{ x: 0, z: 0, r: DAIS.r, h: DAIS.h }],
    boxes: [...kerbs, ...hedge],
    hedgeR,
    groundR: hedgeR + 16,
    plots: buildPlots(rings, beds),
    nodes,
    edges,
    spawn,
  };
}

// ---- the current plan ----------------------------------------------------------------------------------------------

let current: MeadowLayout = buildLayout();
let version = 0;

/** The plan in use. Read it fresh where it matters (it is replaced, never mutated, when the Meadow grows). */
export function meadowLayout(): MeadowLayout {
  return current;
}

/** Bumped whenever the plan is replaced, so meshes and colliders built from it know to rebuild. */
export function layoutVersion(): number {
  return version;
}

/** Draws `rings` plot rings (from lib/server/plots ringsToDraw); returns true when the plan changed. */
export function setLayoutRings(rings: number): boolean {
  if (rings === current.rings) return false;
  current = buildLayout(rings);
  version++;
  return true;
}

/** The plot with this index on the current plan, or null when it is not drawn. */
export function plotAt(index: number): Plot | null {
  return index >= 0 && index < current.plots.length ? current.plots[index] : null;
}

export function nearestPathNode(x: number, z: number): PathNode {
  let best = current.nodes[0];
  let bestD = Infinity;
  for (const n of current.nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function insidePolygon(poly: P2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** True inside a planted bed (within a bed's outline, so not on an avenue or a plaza). */
export function inBed(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  for (const s of current.sectors) {
    if (r < s.rMin || r > s.rMax) continue;
    if (insidePolygon(s.points, x, z)) return true;
  }
  return false;
}

/** The ring path a point is on (or nearest to), by radius. */
export function pathOf(r: number): number {
  const ps = current.paths;
  let best = 0;
  let bestD = Infinity;
  ps.forEach((p, i) => {
    const d = r < p.inner ? p.inner - r : r > p.outer ? r - p.outer : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
