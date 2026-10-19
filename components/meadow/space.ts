// Planar geometry queries over the Meadow's footprints in layout.ts. The route planner asks whether a straight run is
// clear for a body of some radius, the glide mover pushes itself out of walls, and taps that land in a bed, on the dais
// or on the river are moved to the nearest spot a cart can actually reach. None of this touches Rapier, so the
// physics-free fallback works without the WASM build. The hedge ring is the edge of the world: nothing drives past its
// inner face. The river is walled by its copings and the bridges' parapets (boxes like the kerbs), so a straight run
// can only cross it along a bridge; the water itself is also out of bounds here, in case anything ever finds a way in.
import { BED, inBed, inWater, meadowLayout, onBridge, pathOf, type Box2, type P2 } from "@/components/meadow/layout";
import { LEVEL } from "@/components/meadow/river";

export type { P2 };

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
 * True when a disc of `radius` can slide from a to b without touching a kerb, the dais or the hedge. Boxes are
 * inflated square-cornered, which is slightly conservative at their corners; that only makes routes kinder.
 */
export function segmentClear(ax: number, az: number, bx: number, bz: number, radius: number): boolean {
  const L = meadowLayout();
  for (const c of L.circles) {
    const rr = c.r + radius;
    if (segmentPointDistSq(ax, az, bx, bz, c.x, c.z) < rr * rr) return false;
  }
  // nothing beyond the hedge
  const lim = L.hedgeR - radius;
  if (ax * ax + az * az > lim * lim || bx * bx + bz * bz > lim * lim) return false;
  // a cheap annulus reject: only boxes whose radius band the segment can reach
  const rMin = Math.sqrt(segmentPointDistSq(ax, az, bx, bz, 0, 0)) - radius - 1.5;
  const rMax = Math.max(Math.hypot(ax, az), Math.hypot(bx, bz)) + radius + 1.5;
  for (const b of L.boxes) {
    const rb = Math.hypot(b.x, b.z);
    if (rb < rMin || rb > rMax) continue;
    const reach = Math.hypot(b.hx, b.hz) + radius;
    if (segmentPointDistSq(ax, az, bx, bz, b.x, b.z) > reach * reach) continue;
    toLocal(b, ax, az, la);
    toLocal(b, bx, bz, lb);
    if (segmentHitsRect(la.x, la.z, lb.x, lb.z, b.hx + radius, b.hz + radius)) return false;
  }
  return true;
}

export function pointClear(x: number, z: number, radius: number): boolean {
  return segmentClear(x, z, x, z, radius) && !inBed(x, z) && !inWater(x, z);
}

/** A disc over the water (and not on a bridge) is lifted out onto the nearer bank, clear of its coping. */
function outOfWater(p: P2, radius: number): boolean {
  if (!inWater(p.x, p.z)) return false;
  const { band } = meadowLayout().river;
  const r = Math.hypot(p.x, p.z) || 1;
  const to = r < band.mid ? band.c0 - radius : band.c1 + radius;
  p.x *= to / r;
  p.z *= to / r;
  return true;
}

const lp: P2 = { x: 0, z: 0 };

/**
 * Moves a disc out of anything it overlaps, in place. Returns true if it had to move. Two passes settle the corners
 * where two kerb stones meet. A box pushes the disc straight out from the nearest point of its rectangle, so a corner
 * is round to a disc that meets it: a disc sliding along a curved wall of boxes (a coping, whose stones overlap by a
 * few centimetres) rides over the joints, where a square corner would push it back along the wall and hold it there.
 */
export function pushOut(p: P2, radius: number): boolean {
  const L = meadowLayout();
  let moved = outOfWater(p, radius);
  for (let pass = 0; pass < 2; pass++) {
    for (const c of L.circles) {
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
    const r = Math.hypot(p.x, p.z);
    for (const b of L.boxes) {
      if (Math.abs(Math.hypot(b.x, b.z) - r) > radius + b.hx + 0.3) continue;
      toLocal(b, p.x, p.z, lp);
      const ax = Math.abs(lp.x);
      const az = Math.abs(lp.z);
      if (ax >= b.hx + radius || az >= b.hz + radius) continue;
      if (ax <= b.hx && az <= b.hz) {
        // The centre inside the box: out along the shallower axis.
        const ex = b.hx + radius - ax;
        const ez = b.hz + radius - az;
        if (ex < ez) lp.x += Math.sign(lp.x || 1) * ex;
        else lp.z += Math.sign(lp.z || 1) * ez;
      } else {
        // Out from the nearest point of the rectangle (on a face, or its corner), to a radius from it.
        const cx = Math.min(b.hx, Math.max(-b.hx, lp.x));
        const cz = Math.min(b.hz, Math.max(-b.hz, lp.z));
        const dx = lp.x - cx;
        const dz = lp.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        const d = Math.sqrt(d2);
        lp.x = cx + (dx / d) * radius;
        lp.z = cz + (dz / d) * radius;
      }
      // Back into world space.
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      p.x = b.x + lp.x * c + lp.z * s;
      p.z = b.z - lp.x * s + lp.z * c;
      moved = true;
    }
  }
  const lim = L.hedgeR - radius;
  const d = Math.hypot(p.x, p.z);
  if (d > lim) {
    p.x *= lim / d;
    p.z *= lim / d;
    moved = true;
  }
  return moved;
}

/**
 * The reachable spot nearest to a tap. A tap inside a bed goes to whichever of its two faces is nearer, onto the
 * path a little off the kerb; a tap on the river (its water or its copings, but not a bridge) goes to the nearer
 * towpath, as far off the coping; a tap on the dais or past the hedge is pushed clear of it.
 */
export function reachableNear(x: number, z: number, radius: number): P2 {
  const p: P2 = { x, z };
  const { band } = meadowLayout().river;
  const rr = Math.hypot(x, z);
  if (rr > band.c0 && rr < band.c1 && !onBridge(x, z)) {
    const target = rr < band.mid ? band.c0 - radius - 0.25 : band.c1 + radius + 0.25;
    p.x = (x / rr) * target;
    p.z = (z / rr) * target;
  } else if (inBed(x, z)) {
    const r = Math.hypot(x, z) || 1;
    const L = meadowLayout();
    const bed = L.beds.find((b) => r >= b.inner - 0.3 && r <= b.outer + 0.3) ?? L.beds[0];
    const toInner = r - bed.inner;
    const toOuter = bed.outer - r;
    const target = toInner < toOuter ? bed.inner - radius - 0.25 : bed.outer + radius + 0.25;
    p.x = (x / r) * target;
    p.z = (z / r) * target;
  }
  pushOut(p, radius + 0.1);
  return p;
}

/** Height of the walking surface under a point: the soil top inside a bed, a bridge's deck, the ground elsewhere. */
export function groundHeight(x: number, z: number): number {
  return inBed(x, z) ? BED.soilH : onBridge(x, z) ? LEVEL.deck : 0;
}

/** The centre radius of the ring path nearest to a point, for keeping guides on the paving. */
export function pathRadiusNear(x: number, z: number): number {
  return meadowLayout().paths[pathOf(Math.hypot(x, z))].r;
}
