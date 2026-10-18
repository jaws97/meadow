// The courtyard's brass and clay, pure three.js (no DOM): the standing oil lamp (the form of a South Indian
// nilavilakku, drawn from scratch: a broad domed foot, a slender stem with three knops, a shallow dish whose rim draws
// out into five wick spouts, a short spike with a bud finial), its small cousin for the niche, the clay lamps for the
// steps, a teardrop flame for every wick, and the brass water pot (a kodam: the pond's 15 L top-up, as the pond model
// has it) on the side step.
import * as THREE from "three";
import { smoothstep } from "@/lib/plant/prng";
import type { Tier } from "@/components/lotus/geometry";

/** A profile point: radius, height. */
type P = readonly [number, number];

/**
 * A surface of revolution whose rim can draw out into lobes: every profile point's radius is pushed out by
 * `amp(r, y)` at `lobes` evenly spaced angles (sharp, as a spout is), and its height lifted with it; smooth normals,
 * the seam's normals averaged. u runs round, v up the profile by arc length.
 */
function lobedLathe(profile: readonly P[], segs: number, lobes: number, amp: (r: number, y: number) => number, lift = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const lens = [0];
  for (let j = 1; j < profile.length; j++) lens.push(lens[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  const total = lens[lens.length - 1] || 1;
  const cols = segs + 1;
  for (let j = 0; j < profile.length; j++) {
    const [r, y] = profile[j];
    const a = lobes > 0 ? amp(r, y) : 0;
    for (let i = 0; i < cols; i++) {
      const th = (i / segs) * Math.PI * 2;
      const lobe = lobes > 0 ? Math.pow(Math.max(0, Math.cos(lobes * th)), 8) : 0;
      const rr = r * (1 + a * lobe);
      pos.push(Math.cos(th) * rr, y + lift * a * lobe, Math.sin(th) * rr);
      uv.push(i / segs, lens[j] / total);
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam: the first and last column are the same points; give them the same normal
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let j = 0; j < profile.length; j++) {
    const a = j * cols;
    const b = a + segs;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  g.computeBoundingSphere();
  return g;
}

/** The standing lamp's profile, foot to finial, in metres for the tall lamp (0.44 m to the spouts). */
const LAMP_PROFILE: readonly P[] = [
  [0.0, 0.0],
  [0.074, 0.0],
  [0.079, 0.006],
  [0.078, 0.014],
  [0.072, 0.019],
  [0.06, 0.024],
  [0.052, 0.04],
  [0.038, 0.062],
  [0.024, 0.084],
  [0.016, 0.1],
  [0.024, 0.108],
  [0.03, 0.119],
  [0.024, 0.13],
  [0.013, 0.138],
  [0.011, 0.22],
  [0.02, 0.231],
  [0.026, 0.243],
  [0.02, 0.255],
  [0.011, 0.264],
  [0.011, 0.33],
  [0.018, 0.339],
  [0.023, 0.35],
  [0.018, 0.361],
  [0.012, 0.37],
  [0.02, 0.384],
  [0.046, 0.395],
  [0.066, 0.405],
  [0.075, 0.414],
  [0.077, 0.42],
  [0.071, 0.422],
  [0.05, 0.414],
  [0.022, 0.407],
  [0.008, 0.408],
  [0.0065, 0.425],
  [0.0058, 0.468],
  [0.011, 0.476],
  [0.017, 0.49],
  [0.016, 0.505],
  [0.009, 0.52],
  [0.0, 0.53],
];

/** The dish's rim radius and height (tall lamp), and how far the spouts draw out. */
const DISH = { r: 0.077, y: 0.42, spout: 0.36 };

export interface LampGeometry {
  brass: THREE.BufferGeometry;
  /** where each wick's flame stands, in the lamp's frame */
  wicks: THREE.Vector3[];
  /** where its light comes from (over the dish) */
  glow: THREE.Vector3;
}

/** The standing lamp, scaled: `h` its height to the spouts, `w` a radial scale. */
export function makeLamp(tier: Tier, h: number, w: number): LampGeometry {
  const k = h / DISH.y;
  const prof = LAMP_PROFILE.map(([r, y]) => [r * w, y * k] as const);
  const segs = tier === "lite" ? 20 : tier === "balanced" ? 30 : 40;
  const brass = lobedLathe(prof, segs, 5, (r, y) => DISH.spout * smoothstep(0.05 * w, DISH.r * w, r) * smoothstep(0.39 * k, 0.405 * k, y), 0.035);
  const wicks: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const th = (i / 5) * Math.PI * 2;
    const r = DISH.r * w * (1 + DISH.spout * 0.86);
    wicks.push(new THREE.Vector3(Math.cos(th) * r, DISH.y * k + 0.004 + 0.035 * DISH.spout * 0.7, Math.sin(th) * r));
  }
  return { brass, wicks, glow: new THREE.Vector3(0, DISH.y * k + 0.05, 0) };
}

/**
 * A clay lamp: a small shallow cup, its rim pinched out into a pointed, lifted spout where the wick lies, and the dark
 * oil standing in its well; the wick's flame at the spout's tip.
 */
export function makeDiya(tier: Tier): { clay: THREE.BufferGeometry; oil: THREE.BufferGeometry; wick: THREE.Vector3 } {
  const prof: P[] = [
    [0.0, 0.0],
    [0.026, 0.0],
    [0.032, 0.006],
    [0.036, 0.016],
    [0.037, 0.02],
    [0.033, 0.021],
    [0.025, 0.013],
    [0.0, 0.011],
  ];
  const segs = tier === "lite" ? 12 : 20;
  const g = lobedLathe(prof, segs, 1, (r, y) => 0.75 * smoothstep(0.02, 0.036, r) * smoothstep(0.008, 0.018, y), 0.012);
  // the oil: a disc in the well, a few millimetres under the rim, reaching a little way into the spout
  const oil = new THREE.CircleGeometry(0.027, segs);
  oil.rotateX(-Math.PI / 2);
  oil.translate(0.002, 0.0155, 0);
  return { clay: g, oil, wick: new THREE.Vector3(0.058, 0.03, 0) };
}

/** A flame: a teardrop 26 mm tall (a cotton wick in oil), its base at the origin; colour runs blue-white-amber up it. */
export function makeFlame(): THREE.BufferGeometry {
  const prof: P[] = [
    [0.0, -0.001],
    [0.0028, 0.002],
    [0.0046, 0.006],
    [0.005, 0.01],
    [0.0043, 0.015],
    [0.0028, 0.02],
    [0.0012, 0.024],
    [0.0, 0.026],
  ];
  const g = lobedLathe(prof, 10, 0, () => 0);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const base = new THREE.Color(0.25, 0.3, 1.0);
  const core = new THREE.Color(3.2, 2.5, 1.3);
  const tip = new THREE.Color(2.4, 1.0, 0.28);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, p.getY(i) / 0.026));
    if (t < 0.18) c.copy(base).lerp(core, t / 0.18);
    else c.copy(core).lerp(tip, (t - 0.18) / 0.82);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** The brass water pot (kodam): a round belly, a narrow neck and a flared lip, about 30 cm tall (a 15 L vessel). */
export function makeKodam(tier: Tier): THREE.BufferGeometry {
  const prof: P[] = [
    [0.0, 0.0],
    [0.09, 0.0],
    [0.13, 0.02],
    [0.16, 0.07],
    [0.168, 0.12],
    [0.158, 0.17],
    [0.125, 0.215],
    [0.075, 0.245],
    [0.06, 0.262],
    [0.062, 0.285],
    [0.085, 0.3],
    [0.088, 0.305],
    [0.07, 0.302],
    [0.055, 0.28],
  ];
  return lobedLathe(prof, tier === "lite" ? 20 : 40, 0, () => 0);
}
