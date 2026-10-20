// How far back the garden camera can stand in any direction from what it looks at, before the scenery is in its way.
// With the view free to turn all the way round the flower, a turn to the back would otherwise carry the camera through
// the tall hedge behind the bed, the vine arch or the fence, and a pull back at the front through the front hedges.
// The garden's own plan (LAYOUT) says where everything solid stands: hedges as their oval footprints up to their height,
// the arch and the gateway as the ground they span, the fence as its run, and the trees as a trunk and then a crown,
// each grown by a little air so the near plane never grazes a leaf. The bulky things must not stand between the
// camera and the flower either, so roomAlong walks the camera's line out from the target and stops short of the first
// of them; a tree only may not have the camera inside its trunk or crown (a trunk passing between would otherwise jerk
// the view in and out as it turns), and the lantern's slim post is no obstacle at all. The camera rig
// (components/garden/CameraRig.tsx) stands no farther back than that. Pure: no three, no DOM.
import { LAYOUT } from "@/lib/garden/layout";

/** Clear air kept between the camera and anything solid, metres. */
export const ROOM_AIR = 0.32;
/** The step the line is walked in, metres: finer than the thinnest thing in the way (a trunk, a fence board). */
const STEP = 0.04;

interface Oval {
  x: number;
  z: number;
  rx: number;
  rz: number;
  top: number;
}

interface Tree {
  x: number;
  z: number;
  trunk: number;
  crownFrom: number;
  crownTop: number;
  crown: number;
}

const ovals: Oval[] = [...LAYOUT.hedges, ...LAYOUT.front.hedges].map((h) => ({
  x: h.center[0],
  z: h.center[2],
  rx: h.rx + ROOM_AIR,
  rz: h.rz + ROOM_AIR,
  top: h.height + ROOM_AIR,
}));
// the arch spans the path on two legs a radius either side of its centre and stands about two metres
ovals.push({ x: LAYOUT.arch.center[0], z: LAYOUT.arch.center[2], rx: LAYOUT.arch.radius + ROOM_AIR, rz: LAYOUT.arch.radius + ROOM_AIR, top: 2.3 });
// the gateway: its posts and the gate standing open into the garden
ovals.push({
  x: LAYOUT.front.gate.center[0],
  z: LAYOUT.front.gate.center[2] - 0.3,
  rx: LAYOUT.front.gate.width / 2 + 0.1 + ROOM_AIR,
  rz: 0.55 + ROOM_AIR,
  top: LAYOUT.front.gate.height * 1.35 + ROOM_AIR,
});
const trees: Tree[] = [...LAYOUT.trees, ...LAYOUT.front.trees].map((t) => ({
  x: t.position[0],
  z: t.position[2],
  trunk: 0.22 * (t.height / 5.2) + ROOM_AIR,
  crownFrom: t.canopyY - t.canopyR * 0.6,
  crownTop: t.canopyY + t.canopyR,
  crown: t.canopyR * 0.85 + ROOM_AIR,
}));

const fence = {
  ax: LAYOUT.fence.from[0],
  az: LAYOUT.fence.from[2],
  bx: LAYOUT.fence.to[0],
  bz: LAYOUT.fence.to[2],
  reach: 0.06 + ROOM_AIR,
  top: LAYOUT.fence.height * 1.12 + ROOM_AIR,
};

function fenceDistance(x: number, z: number): number {
  const vx = fence.bx - fence.ax;
  const vz = fence.bz - fence.az;
  const t = Math.min(1, Math.max(0, ((x - fence.ax) * vx + (z - fence.az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(x - (fence.ax + vx * t), z - (fence.az + vz * t));
}

/** Whether the point (x, y, z) is inside a hedge, the arch, the gateway or the fence (with its air round it). */
export function bulkAt(x: number, y: number, z: number): boolean {
  for (const o of ovals) {
    if (y > o.top) continue;
    const u = (x - o.x) / o.rx;
    const v = (z - o.z) / o.rz;
    if (u * u + v * v < 1) return true;
  }
  return y < fence.top && fenceDistance(x, z) < fence.reach;
}

/** Whether the point (x, y, z) is inside a tree's trunk or crown (with its air round it). */
export function treeAt(x: number, y: number, z: number): boolean {
  for (const t of trees) {
    if (y > t.crownTop) continue;
    const r = y < t.crownFrom ? t.trunk : t.crown;
    const dx = x - t.x;
    const dz = z - t.z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/**
 * The farthest the camera may stand from (tx, ty, tz) along the unit direction (dx, dy, dz), up to `want`: short of
 * the first bulky thing on the line (or `want` when it is clear), and then, if that spot is inside a tree, in front of
 * the tree. Nothing within `near` of the target counts (the target rides the plant, inside nothing).
 */
export function roomAlong(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, want: number, near = 0.6): number {
  let s = want;
  for (let t = near; t < want; t += STEP) {
    if (bulkAt(tx + dx * t, ty + dy * t, tz + dz * t)) {
      s = t - STEP;
      break;
    }
  }
  while (s > near && treeAt(tx + dx * s, ty + dy * s, tz + dz * s)) s -= STEP;
  return Math.max(near, s);
}

// ---- the lantern, for a still that must not look through it -------------------------------------------------------

/**
 * The lantern as a camera looking at the flower must not see it close up: its lamp (hung on its arm toward the bed, at
 * lampHeight) and its post. The live camera passes it by (a slim post is no obstacle while orbiting), but the bloom card
 * is one still photograph, and a lamp a metre from the lens and across the flower would fill it.
 */
const lantern = (() => {
  const [px, , pz] = LAYOUT.lantern.position;
  const bx = LAYOUT.bed.center[0] - px;
  const bz = LAYOUT.bed.center[2] - pz;
  const len = Math.hypot(bx, bz) || 1;
  const ARM = 0.27;
  return { px, pz, postTop: 1.6, post: 0.06, lx: px + (bx / len) * ARM, ly: LAYOUT.lantern.lampHeight, lz: pz + (bz / len) * ARM, lamp: 0.14 };
})();

/** The camera's half-view across, as a share of distance (the card's 30 degree lens, a little to spare). */
const VIEW = 0.28;

/** Whether a sphere of radius r at (x, y, z) shows between a camera at distance d along the line and the target. */
function inView(x: number, y: number, z: number, r: number, tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, d: number): boolean {
  const ox = x - tx;
  const oy = y - ty;
  const oz = z - tz;
  const s = ox * dx + oy * dy + oz * dz;
  // behind the target it is scenery; behind the camera it is not seen
  if (s <= 0 || s >= d) return false;
  const lateral = Math.hypot(ox - dx * s, oy - dy * s, oz - dz * s);
  return lateral < VIEW * (d - s) + r;
}

/**
 * Whether a camera standing `d` from (tx, ty, tz) along the unit direction (dx, dy, dz) sees the flower clear of the
 * lantern: neither its lamp nor its post stands in the picture between the camera and the flower.
 */
export function lanternClear(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, d: number): boolean {
  if (inView(lantern.lx, lantern.ly, lantern.lz, lantern.lamp, tx, ty, tz, dx, dy, dz, d)) return false;
  for (let y = 0.1; y < lantern.postTop; y += 0.15) if (inView(lantern.px, y, lantern.pz, lantern.post, tx, ty, tz, dx, dy, dz, d)) return false;
  return true;
}

/** How far from the target, up to `want`, the camera may stand along the line with the lantern out of the picture (at least `near`). */
export function lanternAlong(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, want: number, near = 0.6): number {
  let d = want;
  while (d > near && !lanternClear(tx, ty, tz, dx, dy, dz, d)) d -= STEP;
  return Math.max(near, d);
}
