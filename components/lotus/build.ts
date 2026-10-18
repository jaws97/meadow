// The lotus plant's geometry for one look (look.ts), built in the look's frame (the urli's, or the pot's in the pond):
// floating leaves and their thin stalks, standing leaves on prickly stalks (with rain beads when it rains), the flower
// stalk and its head (the 18 petals in three whorls, the receptacle with its stigmas, the stamens, the four outer
// tepals), the seed pod, and fallen petals. Pure three.js, so the triangle budgets can be checked without a browser
// (geometry.test.ts); the materials and the frame loop are LotusPlant.tsx's.
import * as THREE from "three";
import { makeSepalGeometry } from "@/lib/plant/geometry";
import { Rng } from "@/lib/plant/prng";
import {
  BAND_SEGS,
  floatingPad,
  makeJarGeometry,
  makeLotusPetalGeometry,
  makeMudGeometry,
  makePadGeometry,
  makeReceptacleGeometry,
  makeStalkGeometry,
  makeStamenGeometry,
  makeUrliGeometry,
  makeWallBand,
  makeWaterDisc,
  MUD_TESS,
  PAD_TESS,
  STAMENS,
  stalkCurve,
  standingPad,
  triangles,
  WATER_TESS,
  smoothLathe,
  type LotusPetalShape,
  type ProfilePoint,
  type Tier,
} from "@/components/lotus/geometry";
import type { FloatLeaf, LotusLook, RolledLeaf, StandLeaf } from "@/components/lotus/look";
import { KOI, koiTriangles } from "@/components/lotus/koi";
import {
  makeBasinGeometry,
  makePebblesGeometry,
  makePondWaterGeometry,
  makePotGeometry,
  makePotMudGeometry,
  POND_TESS,
} from "@/components/lotus/pondGeometry";
import { URLI, waterY } from "@/components/lotus/frame";
import { POND } from "@/components/lotus/pond";
import type { Vessel } from "@/components/lotus/params";

// ---------------------------------------------------------------------------------------------------------------------
// The flower's build (art direction 10.4: hero metres, the three days about 13, 20 and 25 cm across on petals attached
// outside the stamens, as section 5 asks). v2: the petals are the lotus's own (geometry makeLotusPetalGeometry): broad
// (width about 0.6 of the length, against the first renders' 0.5), rounded at the tip, boat-cupped and hooded.

export interface Whorl {
  count: number;
  shape: LotusPetalShape;
  /** open angle at o = 1, radians */
  open: number;
  /** stagger s: the outer whorl leads (section 5) */
  s: number;
  /** the closed bud's lean inward, so the tips meet in a point */
  lean: number;
  radius: number;
  y: number;
  yaw0: number;
}

export const WHORLS: Whorl[] = [
  { count: 7, shape: { length: 0.102, width: 0.064, cup: 0.85, curve: 0.5, hood: 0.5, claw: 0.3, peak: 0.6, tip: 0.34 }, open: 1.3, s: 0, lean: 0.25, radius: 0.029, y: -0.008, yaw0: 0 },
  { count: 6, shape: { length: 0.093, width: 0.058, cup: 0.9, curve: 0.55, hood: 0.55, claw: 0.3, peak: 0.6, tip: 0.34 }, open: 0.95, s: 0.5, lean: 0.24, radius: 0.026, y: -0.005, yaw0: 0.72 },
  { count: 5, shape: { length: 0.077, width: 0.048, cup: 0.95, curve: 0.6, hood: 0.6, claw: 0.32, peak: 0.6, tip: 0.34 }, open: 0.55, s: 1, lean: 0.26, radius: 0.023, y: -0.002, yaw0: 0.31 },
];
/**
 * The angle the ripe bud's petals leave the base at; their closed form (the petal geometry's own) curves them in so
 * the tips meet over the axis about 11 cm up, the bud about 6.5 cm across at its widest.
 */
const BUD_BASE_ANGLE = 0.1;
/** The ripe bud stands 10-11 cm tall (section 4.5): its closed petals are drawn a little longer than the open ones. */
const BUD_LENGTH = 1.18;

/**
 * Where the petals attach: outside the stamens, which ring the receptacle (4 cm across, its flat top 2.3 cm up), so
 * even the inner whorl's near-upright petals stand clear of it. The flower's base, a short green cone, carries them
 * from the stalk's top.
 */
const FLOWER_BASE: ProfilePoint[] = [
  { r: 0.0036, y: -0.026 },
  { r: 0.0075, y: -0.018 },
  { r: 0.019, y: -0.011 },
  { r: 0.028, y: -0.0075, crease: true },
  { r: 0.012, y: -0.004 },
  { r: 0.001, y: -0.003 },
];

export const PETAL_TESS: Record<Tier, [number, number]> = { cinematic: [16, 28], balanced: [12, 22], lite: [8, 14] };
export const STALK_TESS: Record<Tier, { tubular: number; radial: number; prickles: number }> = {
  cinematic: { tubular: 16, radial: 8, prickles: 30 },
  balanced: { tubular: 10, radial: 6, prickles: 10 },
  lite: { tubular: 6, radial: 5, prickles: 0 },
};
export const TEPAL_TESS: Record<Tier, [number, number]> = { cinematic: [6, 14], balanced: [4, 10], lite: [3, 6] };
/** Rain beads per standing leaf (and the silver pool over the navel): none on lite. */
export const BEADS: Record<Tier, number> = { cinematic: 12, balanced: 8, lite: 0 };

const RECEPTACLE = new THREE.Color("#e8d84a");
const STIGMA = new THREE.Color("#cfd25a");
const STIGMA_DRY = new THREE.Color("#7a5a32");
const POD_COLOURS = ["#8fae4a", "#7d8a3e", "#6b4a2e", "#3a2a1e"].map((c) => new THREE.Color(c));
const SEED_TOP = [new THREE.Color("#4d5a2a"), new THREE.Color("#1e1610")];

function podColour(dry: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.999, Math.max(0, dry)) * (POD_COLOURS.length - 1);
  const i = Math.floor(x);
  return out.copy(POD_COLOURS[i]).lerp(POD_COLOURS[i + 1], x - i);
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpE = new THREE.Euler();

/** The blade's orientation: tilted toward the camera (+z) and sideways (+x), then turned about its own normal. */
function bladeQuat(leaf: StandLeaf): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromEuler(tmpE.set(leaf.tiltZ, 0, -leaf.tiltX, "XYZ"));
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, leaf.yaw));
}

export interface BuiltFloat {
  leaf: FloatLeaf;
  pad: THREE.BufferGeometry;
  stalk: THREE.BufferGeometry | null;
  quat: THREE.Quaternion;
}

export interface BuiltStand {
  leaf: StandLeaf;
  pad: THREE.BufferGeometry;
  stalk: THREE.BufferGeometry;
  quat: THREE.Quaternion;
  beads: THREE.Matrix4[];
}

export interface BuiltFlower {
  stalk: THREE.BufferGeometry;
  head: THREE.Vector3;
  quat: THREE.Quaternion;
  petals: THREE.BufferGeometry[][];
  receptacle: THREE.BufferGeometry | null;
  stamen: THREE.BufferGeometry | null;
  stamenMatrices: THREE.Matrix4[];
  tepal: THREE.BufferGeometry | null;
  /** the green cone from the stalk's top to the petals' bases */
  base: THREE.BufferGeometry;
}

export interface BuiltRolled {
  leaf: RolledLeaf;
  scroll: THREE.BufferGeometry;
  stalk: THREE.BufferGeometry;
}

/**
 * A young lotus leaf still rolled: both halves rolled in toward the midrib into a slim scroll, widest a little below
 * its middle and drawn to a point at the tip, along a gently curving axis from `foot` to `tip`. The cross-section is an
 * open spiral (the radius steps out by an eighth round each turn), so the rolled edge shows as a fine line down one
 * side; uv maps a strip of the leaf's own canvas onto it.
 */
export function makeRolledLeafGeometry(foot: THREE.Vector3, tip: THREE.Vector3, r: number, rings: number, radial: number): THREE.BufferGeometry {
  const axis = new THREE.Vector3().subVectors(tip, foot);
  const len = axis.length();
  const dir = axis.clone().normalize();
  // a gentle bow away from the vertical, as the stalk carries it
  const bend = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(len * 0.06);
  const curve = new THREE.QuadraticBezierCurve3(foot.clone(), foot.clone().addScaledVector(axis, 0.5).add(bend), tip.clone());
  const frames = curve.computeFrenetFrames(rings, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    curve.getPointAt(t, p);
    const prof = Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.55) * (1 - 0.35 * t);
    const rr = r * Math.max(0.05, prof);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const k = rr * (0.88 + 0.12 * (i / radial));
      const n = frames.normals[j];
      const b = frames.binormals[j];
      pos.push(p.x + k * (Math.cos(a) * n.x + Math.sin(a) * b.x), p.y + k * (Math.cos(a) * n.y + Math.sin(a) * b.y), p.z + k * (Math.cos(a) * n.z + Math.sin(a) * b.z));
      uv.push(0.2 + 0.6 * (i / radial), 0.25 + 0.5 * t);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export interface Built {
  floats: BuiltFloat[];
  stands: BuiltStand[];
  flower: BuiltFlower | null;
  rolled: BuiltRolled[];
  fallen: THREE.BufferGeometry | null;
  bead: THREE.BufferGeometry | null;
  /** where the standing stalks and the flower stalk pass through the water's surface (x, z in the look's frame) */
  pierce: THREE.Vector2[];
}

/** Where a stalk's curve rises through the height y, as x and z; null if it never does. */
function crossing(curve: THREE.Curve<THREE.Vector3>, y: number): THREE.Vector2 | null {
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  curve.getPoint(0, q);
  for (let i = 1; i <= 48; i++) {
    curve.getPoint(i / 48, p);
    if (q.y < y && p.y >= y) {
      const t = (y - q.y) / Math.max(1e-6, p.y - q.y);
      return new THREE.Vector2(q.x + (p.x - q.x) * t, q.z + (p.z - q.z) * t);
    }
    q.copy(p);
  }
  return null;
}

export function buildPlant(look: LotusLook, tier: Tier, rain: boolean): Built {
  const st = STALK_TESS[tier];
  const pond = look.frame === "pond";
  const pierce: THREE.Vector2[] = [];
  const floats: BuiltFloat[] = look.floating.map((leaf) => {
    const [rings, segs] = PAD_TESS[tier].float;
    const pad = makePadGeometry(floatingPad(leaf.r, leaf.brown * 0.9), leaf.seed, rings, segs);
    let stalk: THREE.BufferGeometry | null = null;
    if (!leaf.onMud) {
      // the stalk ends just under the blade's navel, so its cut end never shows through it
      const top = new THREE.Vector3(leaf.x, leaf.y - 0.007, leaf.z);
      if (pond) {
        // out of the pot's pebbles near the crown, rising at a slant through the water (over the rim where it must,
        // which stands 2.5 cm down), and up to the leaf's navel from below, not along the surface: a stalk lying just
        // under the surface read as a wire the leaf hung from
        const d = Math.hypot(leaf.x, leaf.z) || 1;
        const ux = leaf.x / d;
        const uz = leaf.z / d;
        const at = (r: number, y: number) => new THREE.Vector3(ux * r, y, uz * r);
        const r0 = Math.min(0.07, d * 0.3);
        const rim = POND.potR + POND.potWall * 0.5;
        const pts = [at(r0, look.mudY + 0.002)];
        if (d > rim + 0.02) {
          // over the rim (2.5 cm down) and down into the open water beyond it, then up to the leaf; with the pond
          // fallen under the rim, over it and down the pot's side to the leaf on the low water
          pts.push(at(r0 + (rim - r0) * 0.55, -POND.rimDepth - 0.012));
          pts.push(at(rim, -POND.rimDepth + 0.0075));
          if (look.surfaceY > -POND.rimDepth) {
            pts.push(at(rim + (d - rim) * 0.5, Math.max(-0.045, -POND.rimDepth - 0.4 * (d - rim))));
            pts.push(at(d - 0.012, top.y - 0.014));
          } else {
            pts.push(at(rim + 0.02, -POND.rimDepth - 0.006));
          }
        } else {
          pts.push(at(r0 + (d - r0) * 0.6, (look.mudY + top.y) * 0.45));
        }
        pts.push(top);
        const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
        stalk = makeStalkGeometry(curve, 0.0022, 0.0018, Math.max(8, st.tubular >> 1), Math.max(4, st.radial - 2), 0, leaf.seed);
      } else {
        const bottom = new THREE.Vector3(leaf.x * 0.35, URLI.mudY + 0.002, leaf.z * 0.35);
        stalk = makeStalkGeometry(stalkCurve(bottom, top, UP), 0.0016, 0.0012, Math.max(4, st.tubular >> 1), Math.max(4, st.radial - 2), 0, leaf.seed);
      }
    }
    // a leaf too wide for the shrinking water leans on the wall: its normal tips inward (its outer edge up); a young
    // leaf lying on an older one is raised toward it (tiltDir)
    const phi = leaf.tiltDir ?? Math.atan2(leaf.z, leaf.x);
    tmpV.set(-Math.cos(phi) * Math.sin(leaf.tilt), Math.cos(leaf.tilt), -Math.sin(phi) * Math.sin(leaf.tilt));
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, tmpV).multiply(new THREE.Quaternion().setFromAxisAngle(UP, leaf.yaw));
    return { leaf, pad, stalk, quat };
  });

  // rain beads every standing leaf; otherwise the first carries the look's dew (none on lite)
  const beadsFor = (i: number) => (rain ? BEADS[tier] : i === 0 ? Math.min(look.dew, BEADS[tier]) : 0);
  const stands: BuiltStand[] = look.standing.map((leaf, li) => {
    const beadCount = beadsFor(li);
    const [rings, segs] = PAD_TESS[tier].stand;
    const pad = makePadGeometry(standingPad(leaf.r, leaf.cup, leaf.wilt, leaf.crisp), leaf.seed, rings, segs);
    const quat = bladeQuat(leaf);
    const dir = UP.clone().applyQuaternion(quat);
    const base = new THREE.Vector3(...leaf.base);
    // (ending a little under the navel, inside the blade's dip)
    const top = new THREE.Vector3(...leaf.top).addScaledVector(dir, -0.012);
    const curve = stalkCurve(base, top, dir, leaf.bow);
    const stalk = makeStalkGeometry(curve, 0.0032, 0.0027, st.tubular, st.radial, st.prickles, leaf.seed);
    const at = pond ? crossing(curve, look.surfaceY) : null;
    if (at) pierce.push(at);
    // water beads (7.7): near-spheres standing on the wax (a contact angle of about 162 degrees: Ensikat et al. 2011,
    // Beilstein J. Nanotechnol. 2:152), gathering into one silver pool over the navel; rain scatters them over the
    // blade, dew and a splash's few lie nearer the middle of the cup, where they roll
    const beads: THREE.Matrix4[] = [];
    if (beadCount > 0) {
      const p = pad.attributes.position as THREE.BufferAttribute;
      const rng = new Rng(leaf.seed * 3 + 1);
      const reach = rain ? 0.8 : 0.55;
      beads.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.004, 0), new THREE.Quaternion(), new THREE.Vector3(rain ? 0.011 : 0.008, 0.0045, rain ? 0.011 : 0.008)));
      for (let k = 0, tries = 0; k < beadCount - 1 && tries < 200; tries++) {
        const i = Math.floor(rng.next() * p.count);
        const x = p.getX(i);
        const z = p.getZ(i);
        if (Math.hypot(x, z) > leaf.r * reach || Math.hypot(x, z) < 0.022) continue;
        k++;
        const s = rain ? 0.0012 + 0.0013 * rng.next() : 0.0018 + 0.0017 * rng.next();
        beads.push(new THREE.Matrix4().compose(new THREE.Vector3(x, p.getY(i) + s * 0.8, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.85, s)));
      }
    }
    return { leaf, pad, stalk, quat, beads };
  });

  let flower: BuiltFlower | null = null;
  const f = look.flower;
  if (f.kind !== "none") {
    // the top third of the stalk bends with drought (and as a dry pod nods): the head drops and comes forward
    const head = new THREE.Vector3(...f.head);
    head.y -= 0.15 * (1 - Math.cos(f.neck));
    head.z += 0.15 * Math.sin(f.neck);
    const quat = new THREE.Quaternion().setFromEuler(tmpE.set(f.leanX + f.neck, 0, f.leanZ, "XYZ"));
    const dir = UP.clone().applyQuaternion(quat);
    // in the pond the stalk leaves the pot right of the crown and leans left as it rises, in one gentle S
    let fCurve: THREE.Curve<THREE.Vector3>;
    if (pond && f.neck < 0.05) {
      const from = new THREE.Vector3(...f.base);
      const h = head.distanceTo(from);
      const side = new THREE.Vector3(head.x - from.x, 0, head.z - from.z);
      const c1 = from.clone().add(new THREE.Vector3(0, h * 0.4, 0)).addScaledVector(side, -0.6);
      const c2 = head.clone().addScaledVector(dir, -h * 0.34);
      fCurve = new THREE.CubicBezierCurve3(from, c1, c2, head.clone());
    } else fCurve = stalkCurve(new THREE.Vector3(...f.base), head, dir, f.neck);
    const stalk = makeStalkGeometry(fCurve, 0.0038, 0.0034, st.tubular, st.radial, f.kind === "pod" ? Math.round(st.prickles * 0.6) : st.prickles, 77);
    const at = pond ? crossing(fCurve, look.surfaceY) : null;
    if (at) pierce.push(at);
    const [nu, nv] = PETAL_TESS[tier];
    // the ripe bud's petals are drawn a little longer, a little wider (so the closed whorl overlaps with no gap) and
    // running to a point; their closed form curves them in to a teardrop drawn to a point
    const shapeOf = (w: Whorl): LotusPetalShape => (f.kind === "bud" ? { ...w.shape, length: w.shape.length * BUD_LENGTH, width: w.shape.width * 1.14, tip: 0.85, peak: 0.45 } : w.shape);
    const petals = f.kind === "pod" ? [] : WHORLS.map((w, wi) => [0, 1].map((v) => makeLotusPetalGeometry(shapeOf(w), wi * 10 + v * 3 + 1, nu, nv)));
    let receptacle: THREE.BufferGeometry | null = null;
    let stamen: THREE.BufferGeometry | null = null;
    const stamenMatrices: THREE.Matrix4[] = [];
    if (f.kind === "flower") {
      receptacle = makeReceptacleGeometry({ radius: 0.02, height: 0.025, pits: 16, pod: 0, body: RECEPTACLE, nub: f.day >= 3 ? STIGMA_DRY : STIGMA }, tier);
      stamen = makeStamenGeometry();
      const n = STAMENS[tier];
      for (let i = 0; i < n; i++) stamenMatrices.push(stamenMatrix(i, f.open, new THREE.Matrix4()));
    } else if (f.kind === "pod") {
      const body = podColour(f.podDry, new THREE.Color());
      const nub = SEED_TOP[0].clone().lerp(SEED_TOP[1], f.podDry);
      receptacle = makeReceptacleGeometry({ radius: 0.02, height: 0.025, pits: 16, pod: f.podSwell, body, nub }, tier);
    }
    const tepal = f.tepals < 2 ? makeSepalGeometry(0.03, 0.02, 5, TEPAL_TESS[tier][0], TEPAL_TESS[tier][1]) : null;
    const base = smoothLathe(FLOWER_BASE, tier === "cinematic" ? 28 : tier === "balanced" ? 18 : 12);
    flower = { stalk, head, quat, petals, receptacle, stamen, stamenMatrices, tepal, base };
  }

  // young leaves still rolled, on their stalks
  const rolled: BuiltRolled[] = look.rolled.map((leaf) => {
    const foot = new THREE.Vector3(...leaf.foot);
    const tip = new THREE.Vector3(...leaf.tip);
    const dir = tip.clone().sub(foot).normalize();
    const curve = stalkCurve(new THREE.Vector3(...leaf.base), foot, dir);
    const stalk = makeStalkGeometry(curve, 0.0024, 0.002, Math.max(6, st.tubular >> 1), st.radial, Math.round(st.prickles * 0.3), leaf.seed);
    const at = pond ? crossing(curve, look.surfaceY) : null;
    if (at) pierce.push(at);
    const [rings, radial] = tier === "cinematic" ? [14, 14] : tier === "balanced" ? [10, 10] : [6, 8];
    return { leaf, scroll: makeRolledLeafGeometry(foot, tip, leaf.r, rings, radial), stalk };
  });

  const fallen = look.fallen.length > 0 ? makeLotusPetalGeometry(WHORLS[0].shape, 9, PETAL_TESS.lite[0], PETAL_TESS.lite[1]) : null;
  const bead = stands.some((s) => s.beads.length > 0) ? new THREE.IcosahedronGeometry(1, tier === "cinematic" ? 1 : 0) : null;
  return { floats, stands, flower, rolled, fallen, bead, pierce };
}

export function disposeBuilt(b: Built) {
  for (const f of b.floats) {
    f.pad.dispose();
    f.stalk?.dispose();
  }
  for (const s of b.stands) {
    s.pad.dispose();
    s.stalk.dispose();
  }
  if (b.flower) {
    b.flower.stalk.dispose();
    for (const w of b.flower.petals) for (const g of w) g.dispose();
    b.flower.receptacle?.dispose();
    b.flower.stamen?.dispose();
    b.flower.tepal?.dispose();
    b.flower.base.dispose();
  }
  for (const r of b.rolled) {
    r.scroll.dispose();
    r.stalk.dispose();
  }
  b.fallen?.dispose();
  b.bead?.dispose();
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const stamenAt = new THREE.Vector3();
const stamenQuat = new THREE.Quaternion();
const stamenScale = new THREE.Vector3();
const stamenEuler = new THREE.Euler();

/**
 * Stamen `i`'s place in the head for open fraction `open`, written into `out`: they ring the receptacle and splay
 * outward as the flower opens, never inside the receptacle's own flare; a closed cup holds them in (spread as an open
 * flower's, their anthers showed between the closed petals' bases), the change eased over the last few hundredths of
 * the opening so a live flower (LotusPlant moves them with it) never snaps.
 */
export function stamenMatrix(i: number, open: number, out: THREE.Matrix4): THREE.Matrix4 {
  const splay = open < 0.1 ? 0.18 + 0.37 * Math.max(0, (open - 0.06) / 0.04) : 0.55 + 0.45 * open;
  const ring = i % 4;
  const a = i * GOLDEN;
  const r = 0.0095 + 0.0026 * ring;
  stamenEuler.set(splay - 0.05 * ring + 0.06 * Math.sin(i * 1.7), Math.PI / 2 - a, 0, "YXZ");
  return out.compose(
    stamenAt.set(Math.cos(a) * r, -0.002 + 0.0012 * ring, Math.sin(a) * r),
    stamenQuat.setFromEuler(stamenEuler),
    stamenScale.set(1, 0.92 + (0.12 * ((i * 7) % 5)) / 4, 1),
  );
}

/** The angle of a petal of whorl `w` for open fraction `o` (section 5): the outer whorl leads; closed petals lean in. */
export function petalAngle(w: Whorl, o: number, morph: number, relax: number, bud = false): number {
  if (bud) return BUD_BASE_ANGLE;
  const ow = Math.min(1, Math.max(0, (o - w.s * 0.25) / (1 - w.s * 0.25)));
  // a virgin bud closes to a point; a flower that has opened and closed keeps a looser cup (morph >= 0.3)
  const lean = morph < 0.2 ? w.lean : 0.12;
  return ow * w.open - (1 - ow) * lean + (w.s === 0 ? relax : 0);
}

/**
 * Triangles the concepts page draws for one look, part by part, counted exactly as LotusPlant, Urli and Jar draw
 * them (the bud's hidden inner whorl and fallen petals left out, instances counted). Builds and disposes.
 */
export function potTriangles(look: LotusLook, vessel: Vessel, tier: Tier, rain: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string, n: number) => (out[k] = (out[k] ?? 0) + Math.round(n));
  const urli = makeUrliGeometry(vessel, tier);
  add("urli", triangles(urli));
  urli.dispose();
  const mud = makeMudGeometry(MUD_TESS[tier][0], MUD_TESS[tier][1], 5);
  add("mud", triangles(mud));
  mud.dispose();
  if (look.waterMM > 0.5) {
    const water = makeWaterDisc(WATER_TESS[tier][0], WATER_TESS[tier][1]);
    add("water", triangles(water));
    water.dispose();
    if (tier !== "lite") {
      const band = makeWallBand(waterY(look.waterMM), URLI.brimY - 0.0015, BAND_SEGS[tier]);
      add("lightPlay", triangles(band));
      band.dispose();
    }
  }
  if (look.jar.show) {
    const j = makeJarGeometry(tier);
    add("jar", triangles(j.glass) + triangles(j.water) + triangles(j.seed) + triangles(j.root) + triangles(j.stone) + 2);
    for (const g of [j.glass, j.water, j.seed, j.root, j.stone]) g.dispose();
  }
  plantTriangles(look, tier, rain, add);
  out.total = Object.values(out).reduce((a, n) => a + n, 0);
  return out;
}

/** Adds the plant's triangles (as LotusPlant draws them) to a count, part by part. */
function plantTriangles(look: LotusLook, tier: Tier, rain: boolean, add: (k: string, n: number) => void) {
  const b = buildPlant(look, tier, rain);
  for (const f of b.floats) {
    add("floatingLeaves", triangles(f.pad));
    if (f.stalk) add("stalks", triangles(f.stalk));
  }
  for (const s of b.stands) {
    add("standingLeaves", triangles(s.pad));
    add("stalks", triangles(s.stalk));
    if (b.bead) add("rainBeads", triangles(b.bead) * s.beads.length);
  }
  const fl = b.flower;
  if (fl) {
    add("stalks", triangles(fl.stalk));
    let slot = 0;
    WHORLS.forEach((w, wi) => {
      for (let k = 0; k < w.count; k++, slot++) {
        if (fl.petals.length === 0) continue;
        if ((look.flower.kind === "bud" && wi === 2) || slot < look.flower.fallen) continue;
        add("petals", triangles(fl.petals[wi][k % 2]));
      }
    });
    if (fl.receptacle) add(look.flower.kind === "pod" ? "pod" : "receptacle", triangles(fl.receptacle));
    if (fl.stamen) add("stamens", triangles(fl.stamen) * fl.stamenMatrices.length);
    if (fl.tepal) add("tepals", triangles(fl.tepal) * 4);
    add("flowerBase", triangles(fl.base));
  }
  for (const r of b.rolled) {
    add("rolledLeaves", triangles(r.scroll));
    add("stalks", triangles(r.stalk));
  }
  if (b.fallen) add("fallenPetals", triangles(b.fallen) * look.fallen.length);
  disposeBuilt(b);
}

/**
 * Triangles the pond view's set piece draws for one look, part by part (instances counted): the tank's water and
 * basin, the pot with its mud and pebbles, the jar, the plant, and the koi (when shown); the courtyard round it is
 * counted on its own (courtyard/geometry courtTriangles, courtyard/plants plantTriangles). Builds and disposes.
 */
export function pondTriangles(look: LotusLook, tier: Tier, rain: boolean, koi: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string, n: number) => (out[k] = (out[k] ?? 0) + Math.round(n));
  const t = POND_TESS[tier];
  const parts: [string, THREE.BufferGeometry][] = [
    ["water", makePondWaterGeometry(t.water[0], t.water[1])],
    ["basin", makeBasinGeometry(t.basin[0], t.basin[1], t.basin[2])],
    ["pot", makePotGeometry(t.pot)],
    ["pot", makePotMudGeometry(Math.max(16, t.pot >> 1))],
    ["pebbles", makePebblesGeometry(t.pebbles, t.pebbleDetail, 5)],
  ];
  for (const [k, g] of parts) {
    add(k, triangles(g));
    g.dispose();
  }
  if (look.jar.show) {
    const j = makeJarGeometry(tier);
    // (the seed's filed spot: a 10 x 8 sphere, 140 triangles; the halo sprite 2)
    add("jar", triangles(j.glass) + triangles(j.water) + triangles(j.seed) + triangles(j.root) + 140 + 2);
    for (const g of [j.glass, j.water, j.seed, j.root, j.stone]) g.dispose();
  }
  plantTriangles(look, tier, rain, add);
  if (koi) add("koi", koiTriangles(tier) * KOI.length);
  out.total = Object.values(out).reduce((a, n) => a + n, 0);
  return out;
}
