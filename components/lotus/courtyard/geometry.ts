// The courtyard's stonework, all original and pure three.js (no DOM), so its triangles can be counted in a test:
// - the granite steps round the tank, the coping's chamfered lip over the water, the landing's and the terraces'
//   slabs: every block its own chamfered box, laid in courses with 5 mm joints over a dark bedding, tinted block by
//   block and weathered by where it lies (dark and green at the waterline, paler and dustier up on the terraces);
// - the laterite walls (their faces carry the block courses in the texture) with the niche's arched opening cut in the
//   back wall, the niche's sooted interior, its granite frame and sill, and the walls' granite coping;
// - the veranda plinth behind the camera, its wooden pillars and the eave of its tiled roof, for a look round.
// uv is world-planar in metres (the dominant axis of each face's normal picks the plane), so the textures keep one
// scale on every face; colour carries the tint and the weathering.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng, smoothstep, vnoise2 } from "@/lib/plant/prng";
import type { Tier } from "@/components/lotus/geometry";
import { POND } from "@/components/lotus/pond";
import { COURT, LEVEL, NICHE, STEP, TANK } from "@/components/lotus/courtyard/plan";

const JOINT = 0.005;

/** A non-indexed copy (the parts are merged flat), disposing the indexed original. */
function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.index) return g;
  const out = g.toNonIndexed();
  g.dispose();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocks

/** A block's unit geometry for a tier: chamfered (rounded with one segment) where the edges catch the light. */
function blockGeometry(tier: Tier, w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  if (tier === "lite") return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, 1, r);
}

const tv = new THREE.Vector3();
const tn = new THREE.Vector3();
const tc = new THREE.Color();

/** Collects blocks in world space with a tint each, then writes world-planar uv and the weathering into colour. */
class StoneBuilder {
  private parts: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, m: THREE.Matrix4, tint: THREE.Color) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    if (geo !== g) g.dispose();
    geo.applyMatrix4(m);
    const n = geo.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tint.r;
      col[i * 3 + 1] = tint.g;
      col[i * 3 + 2] = tint.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(geo);
  }

  build(weather: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void): THREE.BufferGeometry {
    for (const g of this.parts) {
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color" && k !== "uv") g.deleteAttribute(k);
      if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    }
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) throw new Error("courtyard: blocks could not be merged");
    const pos = merged.getAttribute("position") as THREE.BufferAttribute;
    const nor = merged.getAttribute("normal") as THREE.BufferAttribute;
    const uv = merged.getAttribute("uv") as THREE.BufferAttribute;
    const col = merged.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      tv.fromBufferAttribute(pos, i);
      tn.fromBufferAttribute(nor, i);
      const ax = Math.abs(tn.x);
      const ay = Math.abs(tn.y);
      const az = Math.abs(tn.z);
      if (ay >= ax && ay >= az) uv.setXY(i, tv.x, tv.z);
      else if (ax >= az) uv.setXY(i, tv.z, tv.y);
      else uv.setXY(i, tv.x, tv.y);
      tc.fromBufferAttribute(col, i);
      weather(tv, tn, tc);
      col.setXYZ(i, tc.r, tc.g, tc.b);
    }
    merged.computeBoundingSphere();
    return merged;
  }
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();

function place(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): THREE.Matrix4 {
  e.set(pitch, yaw, roll, "YXZ");
  q.setFromEuler(e);
  return m4.compose(p3.set(x, y, z), q, s3.set(1, 1, 1));
}

/** Plan distance from the water's rectangle (square-cornered), 0 inside it. */
function fromWater(x: number, z: number): number {
  return Math.max(TANK.x0 - x, x - TANK.x1, TANK.zBack - z, z - TANK.zFront, 0);
}

/**
 * Granite's weathering by place: dark and faintly green where the water keeps it damp (the coping and the step under
 * it), lichen-dark blotches low on the risers, the treads a little paler where feet wear them, the terraces dustier.
 */
function weatherGranite(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) {
  const d = fromWater(p.x, p.z);
  const damp = (1 - smoothstep(0.0, 0.22, d)) * (1 - smoothstep(0.0, 0.16, p.y - POND.waterY));
  const blot = smoothstep(0.15, 0.65, vnoise2(p.x * 3.1 + p.y * 2.3, p.z * 3.1 - p.y * 1.7) * 0.5 + 0.5);
  const up = n.y > 0.7 ? 1 : 0;
  let k = 1 + 0.05 * up - 0.08 * (1 - up) * blot * (1 - smoothstep(0.2, 0.6, p.y));
  k *= 1 - 0.3 * damp;
  out.multiplyScalar(k);
  // algae and moss at the waterline: green-black on the coping's faces, cushions of moss in the treads' back corners
  out.lerp(MOSS, 0.35 * damp * (0.5 + 0.5 * blot));
  // the risers darken toward their feet, where splashes and dust gather
  if (up === 0 && n.y > -0.5) {
    const above = p.y - LEVEL.coping;
    const inStep = above > 0 ? (above % STEP.rise) / STEP.rise : 0;
    out.multiplyScalar(0.93 + 0.07 * smoothstep(0, 0.6, inStep));
  }
  // the terraces: a warm dust, more toward the walls
  const dust = up * smoothstep(0.5, 1.4, d);
  out.lerp(DUST, 0.12 * dust);
}

const DUST = new THREE.Color(0.7, 0.67, 0.62);
/** a faint pink, as the potash feldspar in a grey granite gives some blocks */
const WARM = new THREE.Color("#b7a69e");
const MOSS = new THREE.Color(0.3, 0.36, 0.2);

/** Light grey granite, block by block a little greyer, cooler or paler (the first courtyard read as brown concrete). */
const GRANITE_TINTS = ["#b9b7b2", "#afada8", "#c2c0ba", "#a9a7a3", "#bcb8b2", "#b3b1ad", "#c6c3bd", "#a5a29d"].map((c) => new THREE.Color(c));

function graniteTint(rng: Rng): THREE.Color {
  // block by block: greyer or warmer, lighter or darker, now and then a block weathered dark
  const c = rng.pick(GRANITE_TINTS).clone().multiplyScalar(0.9 + 0.16 * rng.next());
  if (rng.next() < 0.12) c.multiplyScalar(0.84);
  return c.lerp(WARM, 0.35 * rng.next() * rng.next());
}

/** Lays a run of blocks from a to b along one axis (lengths 0.38-0.62 m), each `across` wide, its top at `top`. */
function run(
  b: StoneBuilder,
  rng: Rng,
  tier: Tier,
  axis: "x" | "z",
  from: number,
  to: number,
  across0: number,
  across1: number,
  top: number,
  height: number,
  lens: [number, number] = [0.6, 0.95],
) {
  let a = from;
  const width = across1 - across0;
  const mid = (across0 + across1) / 2;
  while (a < to - 0.02) {
    let len = rng.range(lens[0], lens[1]);
    if (to - (a + len) < 0.2) len = to - a;
    const L = len - JOINT;
    const jitter = (rng.next() - 0.5) * 0.003;
    const tilt = (rng.next() - 0.5) * 0.004;
    const c = a + len / 2;
    const g = blockGeometry(tier, axis === "x" ? L : width - JOINT, height, axis === "x" ? width - JOINT : L, 0.005);
    const m = axis === "x" ? place(c, top - height / 2 + jitter, mid, 0, tilt, tilt * 0.5) : place(mid, top - height / 2 + jitter, c, 0, tilt * 0.5, tilt);
    b.add(g, m, graniteTint(rng));
    a += len;
  }
}

export interface CourtStones {
  /** every granite block: the steps, the coping, the landing's and the terraces' slabs */
  granite: THREE.BufferGeometry;
  /** the dark bedding the joints show */
  bedding: THREE.BufferGeometry;
}

/** The terraces' and the landing's slabs are laid in courses this wide. */
const SLAB_COURSE = 0.6;

/**
 * The tank's steps and the court's paving. Rings of steps (pond.ts, plan.ts): the coping round the water with its lip,
 * steps 1 and 2 running along both sides (on toward the veranda) and across the back, the terraces at the top; the
 * front coping slab and the landing between the side steps.
 */
export function makeCourtStones(tier: Tier): CourtStones {
  const rng = new Rng(1789);
  const b = new StoneBuilder();
  const t = STEP.tread;
  const lip = POND.lip;
  const front = COURT.zFront;
  // the coping round the water: its lip over the water on the sides and the back, its foot 2 cm under the fill line
  const copeH = LEVEL.coping - (POND.waterY - 0.02);
  for (const s of [-1, 1]) {
    const inner = s < 0 ? TANK.x0 + lip : TANK.x1 - lip;
    const outer = s < 0 ? TANK.x0 - t : TANK.x1 + t;
    run(b, rng, tier, "z", TANK.zBack - t, TANK.zFront, Math.min(inner, outer), Math.max(inner, outer), LEVEL.coping, copeH);
    // along the landing the same course sits flush with the slabs
    const innerL = s < 0 ? TANK.x0 : TANK.x1;
    run(b, rng, tier, "z", TANK.zFront, front, Math.min(innerL, outer), Math.max(innerL, outer), LEVEL.coping, 0.16);
  }
  run(b, rng, tier, "x", TANK.x0 + lip, TANK.x1 - lip, TANK.zBack - t, TANK.zBack + lip, LEVEL.coping, copeH);
  // the front coping slab, a little proud of the landing
  run(b, rng, tier, "x", TANK.x0 + lip, TANK.x1 - lip, TANK.zFront - lip, TANK.zFront + 0.15, LEVEL.coping, copeH, [0.6, 0.7]);
  // steps 1 and 2
  for (let k = 1; k < STEP.count; k++) {
    const top = LEVEL.coping + k * STEP.rise;
    const h = STEP.rise + 0.07;
    for (const s of [-1, 1]) {
      const a0 = s < 0 ? TANK.x0 - k * t : TANK.x1 + k * t;
      const a1 = s < 0 ? TANK.x0 - (k + 1) * t : TANK.x1 + (k + 1) * t;
      run(b, rng, tier, "z", TANK.zBack - (k + 1) * t, front, Math.min(a0, a1) - (s < 0 ? 0.02 : 0), Math.max(a0, a1) + (s > 0 ? 0.02 : 0), top, h);
    }
    run(b, rng, tier, "x", TANK.x0 - k * t, TANK.x1 + k * t, TANK.zBack - (k + 1) * t - 0.02, TANK.zBack - k * t, top, h);
  }
  // the terraces: courses parallel to the tank's edges; their first course makes the top riser
  const terrace = LEVEL.terrace;
  const edge = STEP.count * t;
  const slabH = STEP.rise + 0.06;
  for (const s of [-1, 1]) {
    const inner = s < 0 ? TANK.x0 - edge : TANK.x1 + edge;
    const wall = s < 0 ? COURT.xMin : COURT.xMax;
    let a = inner;
    while (Math.abs(wall - a) > 0.05) {
      const w = Math.min(SLAB_COURSE * (0.85 + 0.3 * rng.next()), Math.abs(wall - a));
      const a1 = a + s * w;
      run(b, rng, tier, "z", COURT.zBack, front, Math.min(a, a1), Math.max(a, a1), terrace, slabH, [0.8, 1.2]);
      a = a1;
    }
  }
  {
    let z = TANK.zBack - edge;
    while (z - COURT.zBack > 0.05) {
      const w = Math.min(0.42, z - COURT.zBack);
      run(b, rng, tier, "x", TANK.x0 - edge, TANK.x1 + edge, z - w, z, terrace, slabH, [0.8, 1.2]);
      z -= w;
    }
  }
  // the landing between the side steps
  {
    let z = TANK.zFront + 0.15;
    while (front - z > 0.05) {
      const w = Math.min(SLAB_COURSE * (0.9 + 0.25 * rng.next()), front - z);
      run(b, rng, tier, "x", TANK.x0, TANK.x1, z, z + w, LEVEL.coping - 0.006, 0.12, [0.8, 1.1]);
      z += w;
    }
  }
  const granite = b.build(weatherGranite);

  // the bedding under the joints: one dark box per course of the steps and the terraces' and landing's floor
  const bed: THREE.BufferGeometry[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    bed.push(g);
  };
  const dip = 0.012;
  // under the coping the bedding stays out of the water and clear of the tank's walls (no faces share a plane)
  const keep = 0.02;
  const copeFoot = POND.waterY + 0.012;
  box(TANK.x0 - t, TANK.x1 + t, copeFoot, LEVEL.coping - dip, TANK.zBack - t, TANK.zBack - keep);
  for (const s of [-1, 1]) {
    const a0 = s < 0 ? TANK.x0 - t : TANK.x1 + keep;
    const a1 = s < 0 ? TANK.x0 - keep : TANK.x1 + t;
    box(a0, a1, copeFoot, LEVEL.coping - dip, TANK.zBack - t, TANK.zFront + keep);
    const b0 = s < 0 ? TANK.x0 - t : TANK.x1;
    const b1 = s < 0 ? TANK.x0 : TANK.x1 + t;
    box(b0, b1, 0.0, LEVEL.coping - dip, TANK.zFront + keep, front);
    for (let k = 1; k <= STEP.count; k++) {
      const top = LEVEL.coping + k * STEP.rise - dip;
      const b0 = s < 0 ? (k === STEP.count ? COURT.xMin : TANK.x0 - (k + 1) * t) : TANK.x1 + k * t;
      const b1 = s < 0 ? TANK.x0 - k * t : k === STEP.count ? COURT.xMax : TANK.x1 + (k + 1) * t;
      box(b0, b1, 0.0, top, COURT.zBack, front);
    }
  }
  for (let k = 1; k <= STEP.count; k++) {
    const top = LEVEL.coping + k * STEP.rise - dip;
    box(TANK.x0 - k * t, TANK.x1 + k * t, 0.0, top, k === STEP.count ? COURT.zBack : TANK.zBack - (k + 1) * t, TANK.zBack - k * t);
  }
  box(TANK.x0, TANK.x1, 0.0, LEVEL.coping - dip - 0.006, TANK.zFront + keep, front);
  const bedding = mergeGeometries(bed, false)!;
  for (const g of bed) g.dispose();
  bedding.computeBoundingSphere();
  return { granite, bedding };
}

// ---------------------------------------------------------------------------------------------------------------------
// Walls

/** The niche's opening outline in the back wall's plane (x along the wall, y up), anticlockwise from the sill's left. */
export function nicheOutline(grow = 0, segs = 18): THREE.Vector2[] {
  const hw = NICHE.width / 2 + grow;
  const sill = NICHE.sillY - grow;
  const spring = NICHE.springY;
  const crown = NICHE.crownY + grow * 1.2;
  const pts: THREE.Vector2[] = [new THREE.Vector2(NICHE.x - hw, sill), new THREE.Vector2(NICHE.x + hw, sill), new THREE.Vector2(NICHE.x + hw, spring)];
  // a softly pointed arch: two arcs meeting at the crown
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const a = t * Math.PI;
    // from the right springing over the crown to the left, a round arch lifted into a slight point
    const x = Math.cos(a) * hw;
    const lift = 1 - Math.pow(Math.abs(Math.cos(a)), 1.6);
    const y = spring + (crown - spring) * (Math.sin(a) * 0.82 + 0.18 * lift);
    pts.push(new THREE.Vector2(NICHE.x + x, y));
  }
  pts.push(new THREE.Vector2(NICHE.x - hw, spring));
  return pts;
}

export interface CourtWalls {
  /** the laterite faces and bodies (uv in metres along the face and up) */
  laterite: THREE.BufferGeometry;
  /** the niche's interior: its jambs, its arch's soffit and its back */
  niche: THREE.BufferGeometry;
  /** dressed granite: the niche's frame and sill, the walls' coping */
  dressed: THREE.BufferGeometry;
}

function planarUv(g: THREE.BufferGeometry, axis: "x" | "z") {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ny = Math.abs(nor.getY(i));
    const nx = Math.abs(nor.getX(i));
    const nz = Math.abs(nor.getZ(i));
    if (ny > nx && ny > nz) {
      uv[i * 2] = pos.getX(i);
      uv[i * 2 + 1] = pos.getZ(i);
    } else {
      uv[i * 2] = axis === "x" ? (nx > nz ? pos.getZ(i) : pos.getX(i)) : nz > nx ? pos.getX(i) : pos.getZ(i);
      uv[i * 2 + 1] = pos.getY(i);
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** A vertex colour from the height: the laterite's damp, darker foot and the soot over the niche's lamp. */
function shadeWall(g: THREE.BufferGeometry, soot = false) {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const foot = 1 - smoothstep(LEVEL.terrace, LEVEL.terrace + 0.5, y);
    const streak = 0.5 + 0.5 * vnoise2(x * 2.3 + z * 2.3, 7.1);
    let k = (0.97 - 0.3 * foot) * (0.93 + 0.1 * streak);
    // rain streaks under the coping
    k *= 1 - 0.12 * smoothstep(LEVEL.terrace + COURT.wallH - 0.5, LEVEL.terrace + COURT.wallH, y) * streak;
    let r = k;
    let gg = k;
    let bb = k;
    // moss green low down
    gg *= 1 + 0.08 * foot;
    r *= 1 - 0.06 * foot;
    bb *= 1 - 0.04 * foot;
    if (soot) {
      // the lamp's soot: dark over the flame, up into the arch
      const sx = (x - NICHE.x) / (NICHE.width * 0.5);
      const sy = (y - (NICHE.sillY + 0.22)) / 0.3;
      const s = Math.exp(-(sx * sx * 1.6 + Math.max(0, sy) * Math.max(0, sy) * 0.6)) * smoothstep(-0.6, 0.2, sy);
      r *= 1 - 0.6 * s;
      gg *= 1 - 0.62 * s;
      bb *= 1 - 0.64 * s;
    }
    col[i * 3] = r;
    col[i * 3 + 1] = gg;
    col[i * 3 + 2] = bb;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/**
 * The walls: the back wall (its inner face a shape with the niche's frame cut out of it, so the frame sits in it),
 * the two side walls, their tops under a granite coping; the niche's sooted interior; the frame, with a fillet and a
 * flat band round the opening, and the sill.
 */
export function makeCourtWalls(): CourtWalls {
  const top = LEVEL.terrace + COURT.wallH;
  const foot = LEVEL.terrace - 0.03;
  const T = COURT.wallThick;
  const lat: THREE.BufferGeometry[] = [];
  const dressed: THREE.BufferGeometry[] = [];

  // the back wall's face, with a hole for the niche's frame
  const face = new THREE.Shape([
    new THREE.Vector2(COURT.xMin - T, foot),
    new THREE.Vector2(COURT.xMax + T, foot),
    new THREE.Vector2(COURT.xMax + T, top),
    new THREE.Vector2(COURT.xMin - T, top),
  ]);
  const frameOuter = nicheOutline(NICHE.frame);
  face.holes.push(new THREE.Path([...frameOuter].reverse()));
  const faceGeo = new THREE.ShapeGeometry(face, 4);
  faceGeo.translate(0, 0, COURT.zBack);
  lat.push(faceGeo);
  // the back wall's top and the side walls (inner faces, tops, ends)
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, into: THREE.BufferGeometry[]) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    into.push(flat(g));
  };
  // the back wall's body stands behind the niche (its own front would close the opening); the coping covers the slot
  // over the face's top
  box(COURT.xMin - T, COURT.xMax + T, foot, top, COURT.zBack - T, COURT.zBack - NICHE.depth - 0.01, lat);
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? COURT.xMin - T : COURT.xMax;
    box(x0, x0 + T, foot, top, COURT.zBack - T, COURT.zFront + COURT.plinthDepth, lat);
  }
  // the coping on the walls: a granite slab a little wider than the wall, chamfered
  const cope = (x0: number, x1: number, z0: number, z1: number) => {
    const g = new RoundedBoxGeometry(x1 - x0, 0.07, z1 - z0, 1, 0.012);
    g.translate((x0 + x1) / 2, top + 0.035, (z0 + z1) / 2);
    dressed.push(flat(g));
  };
  cope(COURT.xMin - T - 0.03, COURT.xMax + T + 0.03, COURT.zBack - T - 0.03, COURT.zBack + 0.04);
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? COURT.xMin - T - 0.03 : COURT.xMax - 0.04;
    cope(x0, x0 + T + 0.07, COURT.zBack - T + 0.04, COURT.zFront + COURT.plinthDepth);
  }

  // the niche: jambs and soffit round the opening, back into the wall, and its back
  const inner = nicheOutline(0);
  const zf = COURT.zBack + NICHE.proud;
  const zb = COURT.zBack - NICHE.depth;
  const pos: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b2 = inner[(i + 1) % inner.length];
    if (i === 0) continue; // the sill is a slab of its own
    // facing into the niche (toward its axis): a, b at the front and at the back
    pos.push(a.x, a.y, zf, b2.x, b2.y, zb, a.x, a.y, zb, a.x, a.y, zf, b2.x, b2.y, zf, b2.x, b2.y, zb);
  }
  const jamb = new THREE.BufferGeometry();
  jamb.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  jamb.computeVertexNormals();
  const back = new THREE.ShapeGeometry(new THREE.Shape(inner), 4);
  back.translate(0, 0, zb);
  const backFlat = flat(back);
  for (const k of Object.keys(backFlat.attributes)) if (k !== "position" && k !== "normal") backFlat.deleteAttribute(k);
  const nicheGeo = mergeGeometries([jamb, backFlat], false)!;
  jamb.dispose();
  backFlat.dispose();
  planarUv(nicheGeo, "x");
  shadeWall(nicheGeo, true);

  // the frame: a flat band round the opening, a fillet stepping back to the wall
  const band = new THREE.Shape(frameOuter);
  band.holes.push(new THREE.Path([...inner].reverse()));
  const frame = new THREE.ExtrudeGeometry(band, { depth: NICHE.proud, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 4 });
  frame.translate(0, 0, COURT.zBack - 0.004);
  dressed.push(flat(frame));
  // an inner fillet: a thin raised bead just outside the opening
  const bead = new THREE.Shape(nicheOutline(0.022));
  bead.holes.push(new THREE.Path([...nicheOutline(0.008)].reverse()));
  const beadGeo = new THREE.ExtrudeGeometry(bead, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 });
  beadGeo.translate(0, 0, COURT.zBack + NICHE.proud - 0.002);
  dressed.push(flat(beadGeo));
  // the sill: a slab across the opening, projecting
  const sill = new RoundedBoxGeometry(NICHE.width + 2 * NICHE.frame + 0.06, 0.04, NICHE.depth + NICHE.proud + 0.06, 1, 0.008);
  sill.translate(NICHE.x, NICHE.sillY - 0.02, COURT.zBack - NICHE.depth / 2 + (NICHE.proud + 0.06) / 2);
  dressed.push(flat(sill));

  const latFlat = lat.map(flat);
  const laterite = mergeGeometries(latFlat, false)!;
  for (const g of latFlat) g.dispose();
  planarUv(laterite, "x");
  shadeWall(laterite);
  laterite.computeBoundingSphere();
  for (const g of dressed) {
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
  }
  const dressedGeo = mergeGeometries(dressed, false)!;
  for (const g of dressed) g.dispose();
  planarUv(dressedGeo, "x");
  dressedGeo.computeBoundingSphere();
  nicheGeo.computeBoundingSphere();
  return { laterite, niche: nicheGeo, dressed: dressedGeo };
}

// ---------------------------------------------------------------------------------------------------------------------
// The veranda behind the camera

export interface Veranda {
  plinth: THREE.BufferGeometry;
  pillars: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  /** the house's lime-washed wall at the veranda's back, with its doorway's dark opening */
  house: THREE.BufferGeometry;
  door: THREE.BufferGeometry;
}

/** The veranda plinth across the court's front, four turned wooden pillars and the eave of a tiled roof. */
export function makeVeranda(tier: Tier): Veranda {
  const top = LEVEL.coping + COURT.plinthH;
  const z0 = COURT.zFront;
  const z1 = COURT.zFront + COURT.plinthDepth;
  const plinth = new RoundedBoxGeometry(COURT.xMax - COURT.xMin, top + 0.1, z1 - z0, 1, 0.015);
  plinth.translate(0, (top - 0.1) / 2, (z0 + z1) / 2);
  const plinthGeo = flat(plinth);
  planarUv(plinthGeo, "x");
  const segs = tier === "lite" ? 10 : 18;
  const pts: THREE.Vector2[] = [];
  const H = 2.15;
  const prof: [number, number][] = [
    [0.12, 0],
    [0.12, 0.06],
    [0.095, 0.08],
    [0.085, 0.2],
    [0.075, H - 0.25],
    [0.085, H - 0.2],
    [0.11, H - 0.12],
    [0.12, H],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-1.9, -0.65, 0.65, 1.9]) {
    const g = new THREE.LatheGeometry(pts, segs);
    g.translate(x, top, z0 + 0.25);
    parts.push(g);
  }
  // the beam over the pillars
  const beam = new THREE.BoxGeometry(COURT.xMax - COURT.xMin, 0.18, 0.2);
  beam.translate(0, top + H + 0.09, z0 + 0.25);
  parts.push(beam);
  const partsFlat = parts.map(flat);
  for (const g of partsFlat) for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
  const pillars = mergeGeometries(partsFlat, false)!;
  for (const g of partsFlat) g.dispose();
  // the eave: a plane sloping down toward the court, with the rafters' ends under it
  const roof = new THREE.PlaneGeometry(COURT.xMax - COURT.xMin + 0.6, 1.6, 1, 1);
  roof.rotateX(-Math.PI / 2 + 0.42);
  roof.translate(0, top + H + 0.42, z0 + 0.45);
  const roofGeo = flat(roof);
  planarUv(roofGeo, "x");
  // the house wall behind the veranda, to the eaves, and a doorway in it (a dark recess with a teak frame's colour)
  const house = new THREE.BoxGeometry(COURT.xMax - COURT.xMin + 2 * COURT.wallThick, H + 0.5, 0.25);
  house.translate(0, top + (H + 0.5) / 2, z1 + 0.125);
  const houseGeo = flat(house);
  planarUv(houseGeo, "x");
  const door = new THREE.PlaneGeometry(0.9, 1.95);
  door.rotateY(Math.PI);
  door.translate(0, top + 0.975, z1 - 0.004);
  const doorGeo = flat(door);
  return { plinth: plinthGeo, pillars, roof: roofGeo, house: houseGeo, door: doorGeo };
}

/** Triangles in the courtyard's stonework and walls for a tier (for the notes and the test's report). */
export function courtTriangles(tier: Tier): Record<string, number> {
  const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  const s = makeCourtStones(tier);
  const w = makeCourtWalls();
  const v = makeVeranda(tier);
  const out = { granite: tri(s.granite), bedding: tri(s.bedding), walls: tri(w.laterite) + tri(w.niche) + tri(w.dressed), veranda: tri(v.plinth) + tri(v.pillars) + tri(v.roof) + tri(v.house) + tri(v.door) };
  for (const g of [s.granite, s.bedding, w.laterite, w.niche, w.dressed, v.plinth, v.pillars, v.roof, v.house, v.door]) g.dispose();
  return out;
}
