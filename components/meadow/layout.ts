// The spike's slice of the agreed ring Meadow, in metres, with the rose dais
// at the origin. Everything that has a footprint is described here once, as
// plain 2D shapes plus a height, and every consumer derives from it: the
// placeholder meshes, the Rapier colliders, the glide mover's collisions and
// the autopilot's route planner. That keeps the physics-free fallback and the
// physics cart driving exactly the same Meadow.
//
// Angles: a point at polar angle `a` sits at (r cos a, 0, r sin a). Yaw is a
// rotation about +y as three.js applies it, so a body with yaw `y` faces
// (cos y, 0, -sin y) along its local +x, which is the cart's forward axis.

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

export interface Plot {
  index: number;
  x: number;
  z: number;
  /** polar angle of the plot */
  a: number;
  /** radius of the plot's row */
  row: number;
  /** which ring path the plot is visited from */
  side: "inner" | "outer";
}

export interface PathNode {
  x: number;
  z: number;
  /** heading for a cart respawned here: along the ring, or out along a spoke */
  yaw: number;
}

export const GROUND_HALF = 30;

/** A raised plinth, taller than the cart's chassis floor so it cannot be driven onto. */
export const DAIS = { r: 4, h: 0.68 } as const;

/** The two ring paths, by centreline radius; `halfWidth` is the sanded band. */
export const PATHS = { inner: 6, outer: 13, halfWidth: 1 } as const;

/**
 * The bed ring between the paths. The kerb faces sit at `inner` and `outer`;
 * the walls stand inside the bed. The kerb is taller than the cart's chassis
 * floor (about 0.5 m at rest) so a raycast wheel cannot simply climb it.
 */
export const BED = { inner: 7, outer: 12, kerbT: 0.22, kerbH: 0.62, soilH: 0.46 } as const;

/** Four spokes cross the beds, so the rings connect; each is a walled corridor. */
export const SPOKES = { angles: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2], halfWidth: 1.5 } as const;

/** Plot rows inside the beds, inner rows first, as plots are handed out in planting order. */
export const PLOT_ROWS = [8.3, 10.7] as const;
const PLOTS_PER_ROW_PER_BED = 5;

export const HEDGE_ARC = { r: 18, from: (170 * Math.PI) / 180, to: (280 * Math.PI) / 180, h: 1.35, t: 0.9 } as const;

/** A heading along +a around a ring at polar angle a. */
export const tangentYaw = (a: number) => Math.atan2(-Math.cos(a), -Math.sin(a));
/** The yaw that faces along the planar direction (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx);

const lateral = SPOKES.halfWidth + BED.kerbT / 2;

function arcBoxes(r: number, from: number, to: number, maxLen: number, t: number, h: number): Box2[] {
  const span = to - from;
  const count = Math.max(1, Math.ceil((span * r) / maxLen));
  const step = span / count;
  const out: Box2[] = [];
  for (let i = 0; i < count; i++) {
    const am = from + step * (i + 0.5);
    const half = step / 2;
    const rc = r * Math.cos(half);
    // A hair longer than the chord so neighbouring boxes close the corner gap.
    out.push({ x: rc * Math.cos(am), z: rc * Math.sin(am), hx: r * Math.sin(half) + 0.03, hz: t / 2, yaw: tangentYaw(am), h });
  }
  return out;
}

function buildKerbs(): Box2[] {
  const boxes: Box2[] = [];
  const rIn = BED.inner + BED.kerbT / 2;
  const rOut = BED.outer - BED.kerbT / 2;
  const n = SPOKES.angles.length;
  for (let k = 0; k < n; k++) {
    const s0 = SPOKES.angles[k];
    const s1 = k + 1 < n ? SPOKES.angles[k + 1] : SPOKES.angles[0] + Math.PI * 2;
    for (const r of [rIn, rOut]) {
      const da = Math.asin((lateral + BED.kerbT / 2) / r);
      boxes.push(...arcBoxes(r, s0 + da, s1 - da, 1.8, BED.kerbT, BED.kerbH));
    }
    // The two walls along spoke k, one each side of its corridor.
    const u = [Math.cos(s0), Math.sin(s0)];
    const v = [-Math.sin(s0), Math.cos(s0)];
    const r0 = Math.sqrt(BED.inner * BED.inner - lateral * lateral);
    const r1 = Math.sqrt(BED.outer * BED.outer - lateral * lateral);
    const rm = (r0 + r1) / 2;
    for (const side of [-1, 1]) {
      boxes.push({
        x: u[0] * rm + v[0] * lateral * side,
        z: u[1] * rm + v[1] * lateral * side,
        hx: (r1 - r0) / 2,
        hz: BED.kerbT / 2,
        yaw: yawOf(u[0], u[1]),
        h: BED.kerbH,
      });
    }
  }
  return boxes;
}

export const KERBS: readonly Box2[] = buildKerbs();

export const HEDGE: readonly Box2[] = arcBoxes(HEDGE_ARC.r, HEDGE_ARC.from, HEDGE_ARC.to, 2.2, HEDGE_ARC.t, HEDGE_ARC.h);

const deg = Math.PI / 180;
// Kept off the camera's side of the spawn (it looks in from about 45 degrees),
// so no canopy stands between the lens and the cart on the first frame.
export const TREES: readonly Tree[] = [
  [100, 16.2, 4.6, 1.8],
  [124, 19.8, 5.4, 2.2],
  [150, 15.8, 4.2, 1.6],
  [298, 16.4, 4.8, 1.9],
  [322, 20.4, 5.6, 2.3],
  [346, 15.9, 4.4, 1.7],
  [12, 18.6, 5.0, 2.0],
].map(([a, r, canopyY, canopyR]) => ({
  x: r * Math.cos(a * deg),
  z: r * Math.sin(a * deg),
  r: 0.3,
  h: 2.6,
  canopyY,
  canopyR,
}));

export const CIRCLES: readonly Circle2[] = [{ x: 0, z: 0, r: DAIS.r, h: DAIS.h }, ...TREES];
export const BOXES: readonly Box2[] = [...KERBS, ...HEDGE];

function buildPlots(): Plot[] {
  const plots: Plot[] = [];
  const n = SPOKES.angles.length;
  for (const row of PLOT_ROWS) {
    const margin = Math.asin((lateral + BED.kerbT + 0.75) / row);
    for (let k = 0; k < n; k++) {
      const s0 = SPOKES.angles[k];
      const s1 = k + 1 < n ? SPOKES.angles[k + 1] : SPOKES.angles[0] + Math.PI * 2;
      const from = s0 + margin;
      const to = s1 - margin;
      for (let i = 0; i < PLOTS_PER_ROW_PER_BED; i++) {
        const a = from + ((to - from) * i) / (PLOTS_PER_ROW_PER_BED - 1);
        plots.push({
          index: plots.length,
          x: row * Math.cos(a),
          z: row * Math.sin(a),
          a,
          row,
          side: row - BED.inner < BED.outer - row ? "inner" : "outer",
        });
      }
    }
  }
  return plots;
}

export const PLOTS: readonly Plot[] = buildPlots();

function buildPathNodes(): PathNode[] {
  const nodes: PathNode[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    nodes.push({ x: PATHS.inner * Math.cos(a), z: PATHS.inner * Math.sin(a), yaw: tangentYaw(a) });
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    nodes.push({ x: PATHS.outer * Math.cos(a), z: PATHS.outer * Math.sin(a), yaw: tangentYaw(a) });
  }
  const mid = (BED.inner + BED.outer) / 2;
  for (const s of SPOKES.angles) {
    nodes.push({ x: mid * Math.cos(s), z: mid * Math.sin(s), yaw: yawOf(Math.cos(s), Math.sin(s)) });
  }
  return nodes;
}

export const PATH_NODES: readonly PathNode[] = buildPathNodes();

/** On the outer path, on the camera's side, rolling round anticlockwise. */
const SPAWN_A = 45 * deg;
export const SPAWN: PathNode = {
  x: PATHS.outer * Math.cos(SPAWN_A),
  z: PATHS.outer * Math.sin(SPAWN_A),
  yaw: tangentYaw(SPAWN_A),
};

export function nearestPathNode(x: number, z: number): PathNode {
  let best = PATH_NODES[0];
  let bestD = Infinity;
  for (const n of PATH_NODES) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** True inside a planted bed (between the kerb faces and outside every spoke corridor). */
export function inBed(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < BED.inner || r > BED.outer) return false;
  const a = Math.atan2(z, x);
  for (const s of SPOKES.angles) {
    const d = wrapAngle(a - s);
    if (Math.abs(r * Math.sin(d)) < lateral + BED.kerbT / 2 && Math.cos(d) > 0) return false;
  }
  return true;
}
