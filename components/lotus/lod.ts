// The lotus as the Meadow's near light plant (L1, art direction 9.3): posed once for its band from a typical seed,
// merged into one vertex-coloured mesh of about 940 triangles, in line with the other species' 888-1,868. Built the
// way components/meadow/lod/bake.ts builds them (paint + merge, a glow weight per vertex: strongest at the petal
// bases and the receptacle, none for the urli or the water). The Meadow's detail levels take it from bake.ts (the light
// plant near, and its picture in the atlas farther off), and the concepts page shows it beside the full plant so the
// two can be judged together. Also here, the cheap urli shapes the Meadow's Plants.tsx draws instanced for a lotus
// that is not a growing plant (makeLotusPlot): the seed of light over the water while the seed is in its jar, and the
// browned leaves of a lotus at rest. A lotus in a river pocket has its own light plant (makeLodLotus(band, "river"):
// the pond view's plant on its pocket-length stalks, with no urli), and its floating leaves are drawn on the water
// as instances of one leaf (pocketPadGeometry). Pure three.js.
import * as THREE from "three";
import { lathe } from "@/lib/garden/dressing";
import { makePetalGeometry, makeSepalGeometry } from "@/lib/plant/geometry";
import { merge, paint } from "@/components/meadow/parts";
import { floatingPad, makePadGeometry, makeStalkGeometry, stalkCurve, standingPad } from "@/components/lotus/geometry";
import { innerR, URLI, waterY } from "@/components/lotus/frame";
import { FLOWER_LIFT, riverStand } from "@/components/lotus/live/pocketLook";
import { POND_FLOWER, pondStandingLeaves, type StandLeaf } from "@/components/lotus/look";
import type { Stage } from "@/components/lotus/params";

export type LodBand = "seed" | "sprout" | "leafy" | "bud" | "bloom" | "pod";

/** The Meadow band each concepts-page stage reads as (the Meadow has no pod band: a pod plant stays in leaf). */
export function bandOf(stage: Stage): LodBand {
  switch (stage) {
    case "jar":
      return "seed";
    case "floating":
      return "sprout";
    case "aerial":
      return "leafy";
    case "bud":
      return "bud";
    case "bloom":
      return "bloom";
    case "pod":
      return "pod";
  }
}

const BRASS = "#a9843f";
const BRASS_RIM = "#e2c27a";
const SLATE = "#3a4b55";
const PAD = "#5f8a73";
const PAD_FLOAT = "#6b9475";
const STALK = "#6c8a4a";
const PETAL_TIP = "#e0789b";
const PETAL_BASE = "#f6dfd0";
const TEPAL = "#6f8f4c";
const RECEPTACLE = "#e8d84a";
const POD = "#8fae4a";
const STAMEN = "#f2c84b";
const BROWN_PAD = "#8f7a55";
const SEED_LIGHT = "#ffd27a";

/** The urli's foot stands this far below its frame's origin (VESSEL_OUTER.a.footY): the Meadow lifts it onto the soil. */
export const LOTUS_FOOT = 0.005;

/** The urli (a 10-sided lathe of the outer wall, the rim and the inner band down to the water) and its slate water. */
function urliParts(parts: THREE.BufferGeometry[]): void {
  const urli = lathe(
    [
      [0.11, -0.005],
      [0.15, 0.03],
      [0.183, 0.085],
      [0.19, 0.122],
      [0.195, 0.132],
      [0.187, 0.1375],
      [0.176, 0.135],
      [innerR(URLI.fillY + 0.004), URLI.fillY + 0.004],
    ],
    10,
  );
  const urliPainted = paint(urli, BRASS, 0);
  // the rim crest burnished: the vertices above the belly take the brighter brass
  const up = urliPainted.attributes.position as THREE.BufferAttribute;
  const uc = urliPainted.attributes.color as THREE.BufferAttribute;
  const rim = new THREE.Color(BRASS_RIM);
  for (let i = 0; i < up.count; i++) if (up.getY(i) > 0.128) uc.setXYZ(i, rim.r, rim.g, rim.b);
  parts.push(urliPainted);
  // the water: a 10-sided fan, a dark slate mirror (as the full urli's water reads from the Meadow camera)
  const water = new THREE.CircleGeometry(innerR(URLI.fillY), 10);
  water.rotateX(-Math.PI / 2);
  water.translate(0, URLI.fillY, 0);
  parts.push(paint(water, SLATE));
}

/** Where the floating leaves lie on the water: x, z and radius in the urli frame. */
const SPOTS = [
  [-0.07, -0.07, 0.056],
  [0.083, -0.058, 0.05],
  [-0.104, 0.034, 0.044],
  [0.1, 0.05, 0.046],
  [0.018, -0.122, 0.037],
  [-0.02, 0.075, 0.033],
] as const;

/** `count` floating leaves on the water at the fill line, each `scale` of its full size, dried and curled by `dry` (0..1). */
function floatingPads(parts: THREE.BufferGeometry[], count: number, scale: number, color: string, dry = 0): void {
  const wy = waterY(URLI.fillMM);
  for (let i = 0; i < count; i++) {
    const [x, z, r] = SPOTS[i];
    const spec = floatingPad(r * scale, dry);
    // a resting leaf's edges turn up and in as it dries
    spec.edgeLift += 0.25 * dry;
    const pad = makePadGeometry(spec, 11 + i * 7, 2, 10);
    pad.translate(x, wy + 0.002 + i * 0.0008, z);
    parts.push(paint(pad, color));
  }
}

/**
 * Paints a petal from its base colour to its tip by its own height, with the glow at the base, never quite dark (as
 * bake.ts's petals: the Meadow's materials tell flower from foliage by the glow).
 */
function paintPetal(g: THREE.BufferGeometry, length: number): THREE.BufferGeometry {
  const flat = paint(g, PETAL_BASE, 0);
  const p = flat.attributes.position as THREE.BufferAttribute;
  const col = flat.attributes.color as THREE.BufferAttribute;
  const glow = flat.attributes.glow as THREE.BufferAttribute;
  const base = new THREE.Color(PETAL_BASE);
  const tip = new THREE.Color(PETAL_TIP);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, p.getY(i) / length));
    c.copy(base).lerp(tip, t * t);
    col.setXYZ(i, c.r, c.g, c.b);
    glow.setX(i, 0.24 + 0.76 * (1 - t));
  }
  return flat;
}

/** The open form of a petal (its morph target) as plain geometry. */
function openPetal(shape: Parameters<typeof makePetalGeometry>[0], seed: number, open: boolean): THREE.BufferGeometry {
  const g = makePetalGeometry(shape, seed, 3, 4);
  const openForm = g.morphAttributes.position?.[0];
  if (open && openForm) g.setAttribute("position", openForm);
  g.morphAttributes = {};
  g.computeVertexNormals();
  return g;
}

/** The L1 flower head for a band (the bud, the open flower or the pod), laid out by `headM` (its foot and lean). */
function headParts(band: LodBand, headM: THREE.Matrix4, parts: THREE.BufferGeometry[]): void {
  const add = (g: THREE.BufferGeometry, color: string, glow = 0) => parts.push(paint(g, color, glow));
  if (band === "pod") {
    const pod = lathe(
      [
        [0.012, 0],
        [0.022, 0.012],
        [0.032, 0.026],
        [0.034, 0.031],
        [0.0, 0.033],
      ],
      6,
    );
    pod.applyMatrix4(headM);
    add(pod, POD);
  } else {
    const open = band === "bloom";
    const whorls = [
      { n: 7, len: 0.11, w: 0.055, ang: open ? 1.15 : -0.1, r: 0.02 },
      { n: 6, len: 0.1, w: 0.05, ang: open ? 0.75 : -0.12, r: 0.016 },
      { n: 5, len: 0.08, w: 0.042, ang: open ? 0.4 : -0.14, r: 0.012 },
    ];
    whorls.forEach((wh, wi) => {
      for (let k = 0; k < wh.n; k++) {
        const g = openPetal({ length: wh.len, width: wh.w, bend: -0.06, cup: 1.15, ruffle: 0.03, tip: 0.35 }, wi * 10 + k, open);
        const painted = paintPetal(g, wh.len);
        const yaw = (k / wh.n) * Math.PI * 2 + wi * 0.45;
        const pm = new THREE.Matrix4().compose(
          new THREE.Vector3(Math.sin(yaw) * wh.r, -0.002 * (2 - wi), Math.cos(yaw) * wh.r),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(wh.ang, yaw, 0, "YXZ")),
          new THREE.Vector3(1, 1, 1),
        );
        painted.applyMatrix4(pm).applyMatrix4(headM);
        parts.push(painted);
      }
    });
    if (!open) {
      for (let k = 0; k < 4; k++) {
        const t = makeSepalGeometry(0.03, 0.02, k, 2, 3);
        const yaw = (k / 4) * Math.PI * 2;
        t.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(yaw) * 0.018, -0.004, Math.cos(yaw) * 0.018), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, yaw, 0, "YXZ")), new THREE.Vector3(1, 1, 1)));
        t.applyMatrix4(headM);
        add(t, TEPAL);
      }
    } else {
      // the receptacle (a 6-facet lathe) and the stamens as one short ring band
      const rec = lathe(
        [
          [0.007, 0],
          [0.012, 0.008],
          [0.017, 0.017],
          [0.02, 0.023],
          [0.0, 0.025],
        ],
        6,
      );
      rec.applyMatrix4(headM);
      add(rec, RECEPTACLE, 1);
      const ring = new THREE.CylinderGeometry(0.03, 0.02, 0.02, 6, 1, true);
      ring.translate(0, 0.01, 0);
      ring.applyMatrix4(headM);
      add(ring, STAMEN, 0.8);
    }
  }
}

/** Which lotus a light plant is: in its urli on a bed plot, or standing in a river pocket. */
export type LodFrame = "urli" | "river";

/**
 * The L1 lotus for a band at garden scale (the Meadow scales it with every plant): in the urli frame, its foot on the
 * soil; or, for a river pocket, in the pond view's frame (y = 0 on the water) without its urli or its floating leaves.
 */
export function makeLodLotus(band: LodBand, frame: LodFrame = "urli"): THREE.BufferGeometry {
  if (frame === "river") return makeRiverLotus(band);
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const add = (g: THREE.BufferGeometry, color: string, glow = 0) => parts.push(paint(g, color, glow));

  urliParts(parts);

  const wy = waterY(URLI.fillMM);
  floatingPads(parts, band === "seed" ? 0 : band === "sprout" ? 4 : 6, band === "sprout" ? 0.8 : 1, PAD_FLOAT);

  if (band === "seed") {
    // the jar on its stone: an 8-sided tapered glass cylinder, pale
    const jar = new THREE.CylinderGeometry(0.04, 0.037, 0.11, 8, 1, true);
    jar.translate(0.235, 0.055, 0.17);
    add(jar, "#cfe0e4", 0.2);
    const seed = new THREE.OctahedronGeometry(0.009, 0);
    seed.translate(0.229, 0.01, 0.174);
    add(seed, "#ffd27a", 1);
  }

  const standing = band === "leafy" ? 2 : band === "bud" || band === "bloom" ? 2 : band === "pod" ? 3 : 0;
  const leaves = [
    { base: [-0.014, URLI.mudY, -0.018], top: [-0.04, wy + 0.33, -0.125], r: 0.125, tz: 0.34, tx: -0.08 },
    { base: [0.022, URLI.mudY, 0.004], top: [0.178, wy + 0.275, -0.012], r: 0.118, tz: 0.16, tx: 0.32 },
    { base: [-0.03, URLI.mudY, 0.012], top: [-0.165, wy + 0.305, -0.06], r: 0.11, tz: 0.22, tx: -0.3 },
  ];
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < standing; i++) {
    const L = leaves[i];
    from.set(L.base[0], L.base[1], L.base[2]);
    to.set(L.top[0], L.top[1], L.top[2]);
    e.set(L.tz, 0, -L.tx);
    q.setFromEuler(e);
    dir.set(0, 1, 0).applyQuaternion(q);
    add(makeStalkGeometry(stalkCurve(from, to, dir), 0.0035, 0.003, 3, 4, 0, 1), STALK);
    const pad = makePadGeometry(standingPad(L.r, 0.3, 0, 0), 101 + i * 13, 2, 10);
    pad.applyMatrix4(m.compose(to, q, new THREE.Vector3(1, 1, 1)));
    add(pad, PAD);
  }

  if (band === "bud" || band === "bloom" || band === "pod") {
    const head = new THREE.Vector3(0, wy + (band === "pod" ? 0.43 : 0.45), 0.045);
    from.set(0.012, URLI.mudY, 0.006);
    dir.set(0, Math.cos(0.2), Math.sin(0.2));
    add(makeStalkGeometry(stalkCurve(from, head, dir), 0.0042, 0.0036, 3, 4, 0, 2), STALK);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    headParts(band, new THREE.Matrix4().compose(head, q, new THREE.Vector3(1, 1, 1)), parts);
  }
  return merge(parts);
}

/** Where the L1 lotus's flower head is for a band (or, without one, its highest leaf), in its frame. */
export function lodLotusHead(band: LodBand, frame: LodFrame = "urli"): THREE.Vector3 {
  if (frame === "river") {
    const p = riverPose(band);
    return p.head ? p.head.clone() : new THREE.Vector3(...p.stands[0].top);
  }
  const wy = waterY(URLI.fillMM);
  if (band === "bud" || band === "bloom") return new THREE.Vector3(0, wy + 0.45, 0.045);
  if (band === "pod") return new THREE.Vector3(0, wy + 0.43, 0.045);
  if (band === "leafy") return new THREE.Vector3(-0.04, wy + 0.33, -0.125);
  return new THREE.Vector3(0, wy, 0);
}

/** Where a river pocket's light plant's stalks start, just under the water. */
const WATER_CUT = -0.006;

/** A river pocket's light plant as posed: its three standing leaves and its flower head (none before the bud), lifted. */
interface RiverPose {
  stands: StandLeaf[];
  head: THREE.Vector3 | null;
  lean: { x: number; z: number };
}

function riverPose(band: LodBand): RiverPose {
  // a pocket's lotus is all floating leaves until it stands (Plants.tsx draws those on the water at every distance)
  if (band === "seed" || band === "sprout") return { stands: [], head: null, lean: { x: 0, z: 0 } };
  const stands = pondStandingLeaves(3, 0, 0).map(riverStand);
  const f = band === "pod" ? POND_FLOWER.pod : band === "bud" ? POND_FLOWER.bud : band === "bloom" ? POND_FLOWER.flower : null;
  if (!f) return { stands, head: null, lean: { x: 0, z: 0 } };
  return { stands, head: new THREE.Vector3(f.head[0], f.head[1] * FLOWER_LIFT, f.head[2]), lean: { x: f.leanX, z: "leanZ" in f ? f.leanZ : 0 } };
}

/**
 * The L1 lotus standing in a river pocket (live/pocketLook.ts, the visit's look): the pond's three standing leaves on
 * their pocket-length stalks and the flower on its gentle S, the head at the pond flower's size (1.2), about 690
 * triangles in bloom. No urli and no floating leaves: those lie on the water as the instanced pads every plant has.
 */
function makeRiverLotus(band: LodBand): THREE.BufferGeometry {
  const pose = riverPose(band);
  if (pose.stands.length === 0) throw new Error(`lotus: no light plant stands in a river pocket at ${band}`);
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string, glow = 0) => parts.push(paint(g, color, glow));
  const up = new THREE.Vector3(0, 1, 0);
  // the stalks start just under the surface (the water is opaque, and the picture of the plant must show nothing below it)
  const foot = (v: readonly [number, number, number]) => new THREE.Vector3(v[0], WATER_CUT, v[2]);
  for (const st of pose.stands) {
    // as the full plant stands its leaf (build.ts): tipped, then turned about its stalk; the stalk ends in the blade's dip
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(st.tiltZ, 0, -st.tiltX, "XYZ")).multiply(new THREE.Quaternion().setFromAxisAngle(up, st.yaw));
    const dir = up.clone().applyQuaternion(q);
    const top = new THREE.Vector3(...st.top);
    add(makeStalkGeometry(stalkCurve(foot(st.base), top.clone().addScaledVector(dir, -0.012), dir, st.bow), 0.0032, 0.0027, 4, 3, 0, st.seed), STALK);
    const pad = makePadGeometry(standingPad(st.r, st.cup, 0, 0), st.seed, 2, 10);
    pad.applyMatrix4(new THREE.Matrix4().compose(top, q, new THREE.Vector3(1, 1, 1)));
    add(pad, PAD);
  }
  if (pose.head) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.lean.x, 0, pose.lean.z, "XYZ"));
    const dir = up.clone().applyQuaternion(q);
    const from = foot(POND_FLOWER.base);
    const head = pose.head;
    const h = head.distanceTo(from);
    const side = new THREE.Vector3(head.x - from.x, 0, head.z - from.z);
    const c1 = from.clone().add(new THREE.Vector3(0, h * 0.4, 0)).addScaledVector(side, -0.6);
    const c2 = head.clone().addScaledVector(dir, -h * 0.34);
    add(makeStalkGeometry(new THREE.CubicBezierCurve3(from, c1, c2, head.clone()), 0.0042, 0.0036, 6, 3, 0, 2), STALK);
    headParts(band, new THREE.Matrix4().compose(head, q, new THREE.Vector3(1.2, 1.2, 1.2)), parts);
  }
  return merge(parts);
}

/**
 * One floating leaf of unit radius, flat on the water (y = 0), white: the Meadow draws a river pocket's floating leaves
 * as instances of it (Plants.tsx), each scaled, turned and coloured (green, or browned at rest) as live/pocketLook.ts
 * lays them out. About thirty triangles.
 */
export function pocketPadGeometry(): THREE.BufferGeometry {
  const g = paint(makePadGeometry(floatingPad(1, 0), 25, 2, 9), "#ffffff");
  if (g.attributes.uv) g.deleteAttribute("uv");
  g.computeBoundingSphere();
  return g;
}

/**
 * The cheap urli the Meadow's Plants.tsx draws instanced, with its foot on the soil (y = 0), about 400 triangles:
 * - "seed": the seed of light hovering over clear water while the seed is in its jar (a glow weight of 1 on the seed,
 *   for the Meadow's seed material);
 * - "pads": floating leaves on the water, for a growing lotus while the Meadow's pictures are still on their way;
 * - "resting": the floating leaves browned and curling, the lotus asleep.
 * With `vessel: false` the same without the urli, for a lotus in a river pocket: the water line at y = 0, so it lies
 * on the river's surface where the Meadow stands it.
 */
export type LotusPlotKind = "seed" | "pads" | "resting";

export function makeLotusPlot(kind: LotusPlotKind, { vessel = true }: { vessel?: boolean } = {}): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (vessel) urliParts(parts);
  if (kind === "seed") {
    const seed = new THREE.SphereGeometry(0.02, 8, 6);
    seed.scale(1, 0.8, 1);
    seed.translate(0, waterY(URLI.fillMM) + 0.018, 0);
    parts.push(paint(seed, SEED_LIGHT, 1));
  } else if (kind === "pads") floatingPads(parts, 6, 1, PAD_FLOAT);
  else floatingPads(parts, 5, 0.9, BROWN_PAD, 0.6);
  for (const p of parts) if (p.attributes.uv) p.deleteAttribute("uv");
  const g = merge(parts);
  g.translate(0, vessel ? LOTUS_FOOT : -waterY(URLI.fillMM), 0);
  g.computeBoundingSphere();
  return g;
}
