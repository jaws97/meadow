// Planar geometry queries over the Meadow's footprints in layout.ts. The route
// planner asks whether a straight run is clear for a body of some radius, the
// glide mover pushes itself out of walls, and taps that land in a bed or on a
// trunk are moved to the nearest spot a cart can actually reach. None of this
// touches Rapier, so the physics-free fallback works without the WASM build.
import { BED, BOXES, CIRCLES, GROUND_HALF, PATHS, inBed, type Box2 } from "@/components/meadow/layout";

export interface P2 {
  x: number;
  z: number;
}

/** Box-local coordinates of a world point (local x along the box's length). */
function toLocal(b: Box2, x: number, z: number, out: P2): P2 {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  return out;
}

function segmentPointDistSq(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len = vx * vx + vz * vz;
  const t = len > 1e-9 ? Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / len)) : 0;
  const dx = ax + vx * t - px;
  const dz = az + vz * t - pz;
  return dx * dx + dz * dz;
}

/** Slab test of segment a->b against the axis-aligned rectangle |x|<=hx, |z|<=hz. */
function segmentHitsRect(ax: number, az: number, bx: number, bz: number, hx: number, hz: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax + hx) && clip(dx, hx - ax) && clip(-dz, az + hz) && clip(dz, hz - az);
}

const la: P2 = { x: 0, z: 0 };
const lb: P2 = { x: 0, z: 0 };

/**
 * True when a disc of `radius` can slide from a to b without touching a wall,
 * a trunk, the dais or the hedge. Boxes are inflated square-cornered, which
 * is slightly conservative at their corners; that only makes routes kinder.
 */
export function segmentClear(ax: number, az: number, bx: number, bz: number, radius: number): boolean {
  for (const c of CIRCLES) {
    const rr = c.r + radius;
    if (segmentPointDistSq(ax, az, bx, bz, c.x, c.z) < rr * rr) return false;
  }
  for (const b of BOXES) {
    // Cheap reject on the bounding circle before the slab test.
    const reach = Math.hypot(b.hx, b.hz) + radius;
    if (segmentPointDistSq(ax, az, bx, bz, b.x, b.z) > reach * reach) continue;
    toLocal(b, ax, az, la);
    toLocal(b, bx, bz, lb);
    if (segmentHitsRect(la.x, la.z, lb.x, lb.z, b.hx + radius, b.hz + radius)) return false;
  }
  return true;
}

export function pointClear(x: number, z: number, radius: number): boolean {
  return segmentClear(x, z, x, z, radius) && !inBed(x, z) && Math.abs(x) < GROUND_HALF - radius && Math.abs(z) < GROUND_HALF - radius;
}

const lp: P2 = { x: 0, z: 0 };

/**
 * Moves a disc out of anything it overlaps, in place. Returns true if it had
 * to move. Two passes settle the corners where a kerb meets a spoke wall.
 */
export function pushOut(p: P2, radius: number): boolean {
  let moved = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of CIRCLES) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        p.x = c.x + (dx / d) * rr;
        p.z = c.z + (dz / d) * rr;
        moved = true;
      }
    }
    for (const b of BOXES) {
      toLocal(b, p.x, p.z, lp);
      const ex = b.hx + radius - Math.abs(lp.x);
      const ez = b.hz + radius - Math.abs(lp.z);
      if (ex <= 0 || ez <= 0) continue;
      // Out along the shallower axis, back into world space.
      if (ex < ez) lp.x += Math.sign(lp.x || 1) * ex;
      else lp.z += Math.sign(lp.z || 1) * ez;
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      p.x = b.x + lp.x * c + lp.z * s;
      p.z = b.z - lp.x * s + lp.z * c;
      moved = true;
    }
  }
  const lim = GROUND_HALF - radius;
  if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) {
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
    moved = true;
  }
  return moved;
}

/**
 * The reachable spot nearest to a tap. A tap inside a bed goes to whichever
 * path is closer, a little off the kerb; a tap on a trunk, the dais or the
 * hedge is pushed clear of it.
 */
export function reachableNear(x: number, z: number, radius: number): P2 {
  const p: P2 = { x, z };
  if (inBed(x, z)) {
    const r = Math.hypot(x, z) || 1;
    const toInner = r - BED.inner;
    const toOuter = BED.outer - r;
    const target = toInner < toOuter ? Math.min(BED.inner - radius - 0.25, PATHS.inner + 0.4) : BED.outer + radius + 0.25;
    p.x = (x / r) * target;
    p.z = (z / r) * target;
  }
  pushOut(p, radius + 0.1);
  return p;
}
