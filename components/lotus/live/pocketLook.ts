// The lotus in a river pocket (the Meadow's lazy river, components/meadow/river.ts), from the model: the pond view's own
// plant (look.ts, its pot frame: y = 0 on the water) standing in the pocket's still shelf, with its stalks lengthened
// as a pocket of real mud allows (the flower about 0.9 m over the water, the standing leaves about half that, so both
// clear the coping), three standing leaves from the moment it has any, and its floating leaves spread over the shelf
// inside the sill stones instead of round a pot. The river preview (components/lotus/river/RiverLotus.tsx) draws its
// pockets with the same rules, from here.
//
// From the model, on a visit: the stage (as the urli's, live/urliLook.ts), the flower's own opening and warmth, a pod's
// drying and the stalks' droop. The river is always full and clear: no low water, no dry mud and no algae, whatever the
// friend's own pond is doing (its level, its green water and its koi belong to their personal pond). The floating
// leaves come from the snapshot's band and the plot alone, so the Meadow's instanced pads (Plants.tsx) and the visit's
// full plant lay exactly the same leaves on the water and the visit's handover dissolves one into the other.
//
// Frames: a pocket's floating leaves are laid out in the pocket's own frame (+z straight out from the wall to the open
// channel, x along the wall, the origin on the pocket's middle line), and the standing plant is turned to the nearest of
// the detail levels' three angles (lod/bands.ts SPINS); `turn` carries the leaves from one frame to the other.
// Pure: no three, no DOM.
import { lookFor, pondStandingLeaves, type FloatLeaf, type LotusLook, type V3 } from "@/components/lotus/look";
import { timeOfDay, urliStageOf, type MeadowBand } from "@/components/lotus/live/urliLook";
import { DEFAULTS, type ConceptParams, type FlowerDay, type Overrides, type Stage } from "@/components/lotus/params";
import { pocketReach } from "@/components/meadow/river";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { POCKET_LOTUS_OUT } from "@/lib/server/plots";
import type { PondVisual } from "@/lib/sim";

/** How much taller than the pond's the pocket's stalks grow: standing leaves, and the flower. */
export const STAND_LIFT = 2.0;
export const FLOWER_LIFT = 2.25;
/** The river preview's plant stands this far out from the wall (the pocket's middle is 0.55): its spread fits the front. */
export const PLANT_OUT = 0.62;

/** Pond-leaf seeds (look.ts uses 11 + 7i): reused so the pockets share the pond's eight floating-leaf textures. */
const FLOAT_SEEDS = [11, 18, 25, 32, 39, 46, 53, 60];

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/**
 * Floating leaves filling a pocket's still shelf, in the plant's frame (pond-plant units, before the Meadow's 1.3; the
 * frame's +z points out from the wall to the open channel, its middle `out` metres from the wall): each wholly on the
 * shelf inside the sill stones and clear of its neighbours, the larger first. A pond plant's leaves crowd its patch
 * of water; a pocket of mud carries a dozen or so by its second month. `turn` (radians) turns the laid-out leaves about
 * the frame's middle, for a plant frame turned `-turn` from the pocket's.
 */
export function pocketFloats(stage: Stage, seed: number, lie: boolean, out = PLANT_OUT, turn = 0): FloatLeaf[] {
  const count = stage === "floating" ? 8 : stage === "aerial" ? 11 : stage === "pod" ? 14 : 14;
  const [rMin, rMax] = stage === "floating" ? [0.055, 0.095] : [0.07, 0.135];
  let s = seed * 7919 + 101;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const k = PLANT_SCALE;
  const fits = (x: number, z: number, r: number) => {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const along = (x + Math.cos(a) * r) * k;
      const o = out + (z + Math.sin(a) * r) * k;
      if (o < 0.06 || o > pocketReach(along) - 0.15) return false;
    }
    return true;
  };
  const leaves: FloatLeaf[] = [];
  for (let tries = 0; tries < 900 && leaves.length < count; tries++) {
    const t = leaves.length / Math.max(1, count - 1);
    const r = rMax - (rMax - rMin) * (t * 0.8 + 0.2 * rnd());
    const x = (rnd() * 2 - 1) * 0.8;
    const z = -0.45 + rnd() * 0.75;
    if (!fits(x, z, r)) continue;
    // crowding as a lotus patch does, a leaf's rim now and then lying over its neighbour's (they float at three heights)
    if (leaves.some((f) => Math.hypot(f.x - x, f.z - z) < (f.r + r) * 0.86)) continue;
    const i = leaves.length;
    leaves.push({ x, z, r, y: 0.0012 + (i % 3) * 0.0011, yaw: rnd() * Math.PI * 2, seed: FLOAT_SEEDS[i % FLOAT_SEEDS.length], onMud: lie, tilt: 0, brown: 0, pale: 0 });
  }
  if (turn === 0) return leaves;
  // (three.js's turn about +y: x' = x cos + z sin, z' = z cos - x sin)
  const c = Math.cos(turn), sn = Math.sin(turn);
  return leaves.map((f) => ({ ...f, x: f.x * c + f.z * sn, z: f.z * c - f.x * sn, yaw: f.yaw + turn }));
}

/** A standing leaf raised on its pocket-length stalk (the i-th of the pond's three, a little lower each). */
export function riverStand(st: LotusLook["standing"][number], i: number): LotusLook["standing"][number] {
  return { ...st, top: [st.top[0] * 1.15, st.top[1] * STAND_LIFT * (1 - 0.05 * i), st.top[2] * 1.1] as V3 };
}

/**
 * The pond look made a pocket's: the pocket's own floating leaves, three standing leaves (the pond's own three; a
 * floating-leaf plant has none yet), and the standing leaves and the flower raised on longer stalks.
 */
export function riverLook(l: LotusLook, seed: number, lie: boolean, threeStands: LotusLook["standing"] | null): LotusLook {
  const lift = (v: V3, k: number): V3 => [v[0], v[1] * k, v[2]];
  const stands = l.standing.length > 0 && threeStands ? threeStands : l.standing;
  return {
    ...l,
    floating: pocketFloats(l.stage, seed, lie),
    standing: stands.map(riverStand),
    flower: { ...l.flower, head: lift(l.flower.head, FLOWER_LIFT) },
    focus: lift(l.focus, l.flower.kind === "none" ? STAND_LIFT : FLOWER_LIFT),
  };
}

/** The pond's three standing leaves (as its seed-pod plant carries them), for every river plant past its floating leaves. */
export function pondThreeStands(params: ConceptParams): LotusLook["standing"] {
  return lookFor({ ...params, view: "pond", stage: "pod", mood: "happy", overrides: {} }).standing;
}

/** Each pocket's leaves by band, as laid out (the layout tries a few hundred places: the Meadow asks again often). */
const padsMade = new Map<string, FloatLeaf[]>();

/**
 * The floating leaves on a Meadow pocket's water for the snapshot's band, in the pocket's frame centred on the plot (the
 * lotus line), turned by `turn`: a seed has none (its seed of light floats there), a sprout a few small ones, a grown
 * plant a dozen or so, a resting plant's few browned and curling. The same for the instanced pads and the visit. Laid
 * out once per pocket and band and shared: read them, never change them.
 */
export function pocketPads(band: MeadowBand, index: number, turn = 0): FloatLeaf[] {
  if (band === "seed") return [];
  const key = `${band}|${index}`;
  let leaves = padsMade.get(key);
  if (!leaves) {
    const laid = pocketFloats(urliStageOf(null, band), index, false, POCKET_LOTUS_OUT);
    leaves = band === "resting" ? laid.map((f) => ({ ...f, brown: 0.75 })) : laid;
    padsMade.set(key, leaves);
  }
  if (turn === 0) return leaves;
  // (as pocketFloats turns them)
  const c = Math.cos(turn), sn = Math.sin(turn);
  return leaves.map((f) => ({ ...f, x: f.x * c + f.z * sn, z: f.z * c - f.x * sn, yaw: f.yaw + turn }));
}

/** Where a visited pocket's lotus stands: its plot number (its leaves' layout) and the turn from its pocket's frame. */
export interface PocketPlace {
  index: number;
  turn: number;
}

/**
 * The pocket lotus's look at IST clock hour `clock` (v: the visit's PondVisual, or null), in the plant's frame (y = 0 on
 * the river's surface, +z toward the open channel once turned by `at.turn`).
 */
export function pocketLookFromVisual(v: PondVisual | null, band: MeadowBand, clock: number, seed: string, at: PocketPlace): LotusLook {
  void seed; // the pocket's leaf places come from its plot; the seed varies the leaves' own textures in the build
  const stage = urliStageOf(v, band);
  const resting = band === "resting" || (v !== null && !v.alive);
  const droop = v ? clamp(v.droop) : resting ? 0.55 : 0;
  // the river: always at its level, always clear
  const o: Overrides = { water: 0, algae: 0, moisture: 0.6, droop };
  let day: FlowerDay = "auto";
  if (v && stage === "bloom") {
    day = String(v.flowerDay) as FlowerDay;
    o.open = clamp(Math.pow(clamp(v.bloom), 1.6));
  }
  if (v) o.warmth = clamp(v.warmth);
  if (v && stage === "pod") o.podDry = clamp(v.podDry);
  const base = lookFor({ ...DEFAULTS, view: "pond", stage, time: timeOfDay(clock), mood: "happy", day, overrides: o });
  const look: LotusLook = {
    ...riverLook(base, at.index, false, pondStandingLeaves(3, droop, 0)),
    floating: pocketPads(band, at.index, at.turn),
    // no jar on a coping here (the seed's light floats on the pocket), no pot's water, no fallen petals on a current
    jar: { ...base.jar, show: false },
    fallen: [],
    rolled: base.standing.length > 0 ? base.rolled.map((r) => ({ ...r, foot: [r.foot[0], r.foot[1] * STAND_LIFT, r.foot[2]] as V3, tip: [r.tip[0], r.tip[1] * STAND_LIFT, r.tip[2]] as V3 })) : [],
    potWaterMM: null,
  };
  if (!resting) return look;
  // asleep: the leaves browned and curling, no flower, no light
  return {
    ...look,
    standing: look.standing.map((s) => ({ ...s, wilt: Math.max(s.wilt, 0.7), crisp: Math.max(s.crisp, 0.6) })),
    flower: { ...look.flower, kind: "none", warmth: 0 },
    glowAt: "none",
    summary: "Resting: the leaves browned, the lotus asleep",
  };
}
