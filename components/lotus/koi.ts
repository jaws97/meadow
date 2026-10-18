// The pond's three young koi (the pond model, section 3.1: three tosai, about 10 cm at the party, roughly 2 cm a month
// after; drawn here at 13-15 cm, a few weeks on), procedural and pure three.js: no DOM, so the triangle counts and the
// paths' rules can be checked in a unit test.
//
// Each fish is one body mesh and one fin mesh, skinned on the CPU every frame from a spine that follows its own slow
// closed path through the pond (like a train on its rails: the body bends exactly as the path turns), with a calm
// travelling wave down the body (a tail beat under 1 Hz), the pectoral fins paddling, and the long fins trailing a
// little behind the wave (a "butterfly" cut, between a standard koi's fins and a long-finned one's). Positions are in
// the pond frame (pond.ts POND_FRAME: the pond's centre at the fill line); KoiSchool.tsx places the group.
import * as THREE from "three";
import { smoothstep } from "@/lib/plant/prng";
import { POND } from "@/components/lotus/pond";

export type KoiVariety = "kohaku" | "ogon" | "sanke";

export interface KoiSpec {
  variety: KoiVariety;
  /** snout to the tail fin's tip, m */
  length: number;
  /** cruising speed along the path, m/s */
  speed: number;
  /** tail beats per second */
  beat: number;
  /** where along its path (arc length, m) the snout is at the page's still time (STILL_TIME, 37 s) */
  stillArc: number;
  /** the path's waypoints, closed: x, depth (negative, under the fill line), z in the pond frame */
  path: readonly (readonly [number, number, number])[];
  /** the waypoint where it noses up under the surface and leaves a soft ring */
  surfaceAt: number;
  seed: number;
}

/** The page's still time (LotusScene STILL_TIME): the koi hold their places there. */
export const KOI_STILL_TIME = 37;

/**
 * The three koi: a kohaku (white, red patches), a yamabuki ogon (metallic gold) and a sanke (white, red, small black
 * marks), cruising the courtyard tank. Their paths keep at least 6 cm clear of the tank's walls (inside 0.58 x 0.45 of
 * its 0.64 x 0.51 half-extents), at least 30 cm from the lotus pot's centre (at z = 0.27), and over the front shelf at
 * least 9 cm above its floor; they run shallow (5-13 cm down) so they show through the water, under and between the
 * floating leaves. The still frames (the clock at 37 s) are planned against the pond view's cameras (desktop, phone
 * and the close koi framing: what the coping, the floating leaves, the standing leaves and the flower hide from each):
 * every fish in open water at least 15 cm inside the walls, side-on or across the view rather than nose-on: the kohaku
 * crossing the front left toward the pot, just past the ring it left at the front-left corner; the ogon at the front
 * right, turning along the right wall after nosing up behind it; the sanke along the left wall, just past its ring.
 * (The water behind the standing leaves and the flower is hidden from the product camera, wherever a fish swims.)
 */
export const KOI: readonly KoiSpec[] = [
  {
    variety: "kohaku",
    length: 0.17,
    speed: 0.075,
    beat: 0.75,
    stillArc: 1.995,
    path: [
      [0.47, -0.055, 0.0],
      [0.43, -0.07, -0.2],
      [0.3, -0.1, -0.36],
      [0.02, -0.12, -0.4],
      [-0.28, -0.12, -0.34],
      [-0.48, -0.1, -0.16],
      [-0.52, -0.08, 0.14],
      [-0.44, -0.05, 0.36],
      [-0.32, -0.1, 0.1],
      [0.0, -0.13, -0.06],
      [0.32, -0.1, 0.06],
    ],
    surfaceAt: 7,
    seed: 3,
  },
  {
    variety: "ogon",
    length: 0.16,
    speed: 0.085,
    beat: 0.85,
    stillArc: 1.599,
    path: [
      [0.46, -0.06, 0.1],
      [0.42, -0.07, -0.18],
      [0.22, -0.1, -0.36],
      [-0.02, -0.11, -0.32],
      [-0.06, -0.1, -0.15],
      [0.12, -0.08, -0.07],
      [0.35, -0.055, 0.11],
    ],
    surfaceAt: 6,
    seed: 7,
  },
  {
    variety: "sanke",
    length: 0.15,
    speed: 0.07,
    beat: 0.8,
    stillArc: 1.14,
    path: [
      [0.46, -0.1, -0.12],
      [0.34, -0.055, -0.3],
      [0.1, -0.07, -0.34],
      [-0.16, -0.1, -0.3],
      [-0.4, -0.055, -0.2],
      [-0.5, -0.09, 0.08],
      [-0.34, -0.08, 0.14],
      [-0.1, -0.12, -0.1],
      [0.2, -0.1, -0.1],
    ],
    surfaceAt: 4,
    seed: 11,
  },
];

/** The lotus pot's centre in the pond frame, and how near a koi's path may come. */
export const KOI_POT = { x: POND.potX - POND.cx, z: POND.potZ - POND.cz, clear: 0.3 } as const;

export function koiCurve(spec: KoiSpec): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    spec.path.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true,
    "centripetal",
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The body plan, in shares of the length L (s: 0 at the snout, 1 at the tail fin's tip)

/** Where the body ends and the tail fin begins. */
const BODY_END = 0.8;
const MAX_W = 0.11;
const MAX_H = 0.112;
const WIDEST = 0.3;

/** The body's half-width (from above) at s, in L: a blunt rounded snout, broad shoulders, a slim tail stalk. */
export function koiHalfWidth(s: number): number {
  if (s <= WIDEST) return MAX_W * Math.sqrt(Math.max(0, 1 - ((WIDEST - s) / WIDEST) ** 2)) * (0.82 + 0.18 * (s / WIDEST));
  const t = Math.min(1, (s - WIDEST) / (0.78 - WIDEST));
  return MAX_W * (0.21 + 0.79 * Math.pow(Math.cos((t * Math.PI) / 2), 1.25));
}

/** The body's half-height at s, in L (the head a little lower than the shoulders). */
export function koiHalfHeight(s: number): number {
  if (s <= 0.34) return MAX_H * Math.sqrt(Math.max(0, 1 - ((0.34 - s) / 0.34) ** 2)) * (0.78 + 0.22 * (s / 0.34));
  const t = Math.min(1, (s - 0.34) / (0.78 - 0.34));
  return MAX_H * (0.24 + 0.76 * Math.pow(Math.cos((t * Math.PI) / 2), 1.15));
}

export const KOI_TESS = {
  cinematic: { rings: 30, segs: 16, fin: 1 },
  balanced: { rings: 22, segs: 12, fin: 0.75 },
  lite: { rings: 14, segs: 8, fin: 0.5 },
} as const;
export type KoiTier = keyof typeof KOI_TESS;

/** Fin kinds, for the flutter: 0 body, 1 dorsal, 2 tail, 3/4 pectoral (left/right), 5/6 pelvic, 7 anal. */
type FinKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A skinnable mesh: per vertex its s, its rest offsets across (lat) and up (vert) in the spine's frame, a flex weight. */
export interface KoiSkin {
  geometry: THREE.BufferGeometry;
  s: Float32Array;
  lat: Float32Array;
  vert: Float32Array;
  flex: Float32Array;
  kind: Uint8Array;
}

function skinFrom(rows: { s: number; lat: number; vert: number; flex: number; kind: FinKind; u: number; v: number }[], idx: number[]): KoiSkin {
  const n = rows.length;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const s = new Float32Array(n);
  const lat = new Float32Array(n);
  const vert = new Float32Array(n);
  const flex = new Float32Array(n);
  const kind = new Uint8Array(n);
  rows.forEach((r, i) => {
    s[i] = r.s;
    lat[i] = r.lat;
    vert[i] = r.vert;
    flex[i] = r.flex;
    kind[i] = r.kind;
    uv[i * 2] = r.u;
    uv[i * 2 + 1] = r.v;
    // a straight rest pose along -x (the snout at x = 0), so the bounding sphere is sane before the first frame
    pos[i * 3] = -r.s;
    pos[i * 3 + 1] = r.vert;
    pos[i * 3 + 2] = r.lat;
  });
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geometry: g, s, lat, vert, flex, kind };
}

/**
 * The body, in units of L: rings of an egg-shaped section along s (uv: u along the body, v round it from the belly, so
 * the pattern's dorsal band is v = 0.5), closed at the snout and the tail stalk.
 */
export function makeKoiBody(tier: KoiTier): KoiSkin {
  const { rings, segs } = KOI_TESS[tier];
  const rows: Parameters<typeof skinFrom>[0] = [];
  const idx: number[] = [];
  // the snout's tip
  rows.push({ s: 0, lat: 0, vert: -0.012, flex: 0, kind: 0, u: 0, v: 0.5 });
  const cols = segs + 1;
  for (let k = 0; k < rings; k++) {
    // denser at the head, where the shape turns fastest
    const t = (k + 1) / rings;
    const s = 0.006 + (BODY_END - 0.006) * Math.pow(t, 1.25);
    const w = koiHalfWidth(s);
    const h = koiHalfHeight(s);
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const c = -Math.cos(th);
      // the back is a touch flatter and broader than the belly; the head's underside flatter still
      const vert = c * h * (c > 0 ? 0.96 : 1 - 0.18 * (1 - smoothstep(0.05, 0.4, s))) - 0.012 * (1 - smoothstep(0, 0.35, s));
      const lat = Math.sin(th) * w * (1 + 0.06 * c);
      rows.push({ s, lat, vert, flex: 0, kind: 0, u: s / BODY_END, v: j / segs });
    }
  }
  // the snout's fan
  for (let j = 0; j < segs; j++) idx.push(0, 1 + j + 1, 1 + j);
  for (let k = 0; k < rings - 1; k++) {
    for (let j = 0; j < segs; j++) {
      const a = 1 + k * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // the tail stalk's cap
  const tip = rows.length;
  rows.push({ s: BODY_END + 0.008, lat: 0, vert: 0, flex: 0, kind: 0, u: 1, v: 0.5 });
  const last = 1 + (rings - 1) * cols;
  for (let j = 0; j < segs; j++) idx.push(last + j, last + j + 1, tip);
  return skinFrom(rows, idx);
}

/** A fin grid: `at(u, v)` gives its rest s, lat, vert and flex for u (root to edge) and v (across, 0..1). */
function finGrid(
  rows: Parameters<typeof skinFrom>[0],
  idx: number[],
  nu: number,
  nv: number,
  kind: FinKind,
  at: (u: number, v: number) => { s: number; lat: number; vert: number; flex: number },
) {
  const start = rows.length;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const p = at(u, v);
      rows.push({ ...p, kind, u, v });
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = start + j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
}

/**
 * The fins, in units of L, one translucent double-sided mesh (uv: u from the root to the edge, v across, for the fin
 * rays): the dorsal along the back, the forked tail, the paddle-like pectorals low behind the head, the small pelvics
 * and the anal fin. The long fins are drawn a little long, as a butterfly koi's, so they flow.
 */
export function makeKoiFins(tier: KoiTier): KoiSkin {
  const q = KOI_TESS[tier].fin;
  const n = (x: number) => Math.max(2, Math.round(x * q));
  const rows: Parameters<typeof skinFrom>[0] = [];
  const idx: number[] = [];
  // dorsal: from the shoulders to the tail stalk, highest at the front
  finGrid(rows, idx, n(3), n(12), 1, (u, v) => {
    const s = 0.33 + 0.36 * v;
    const height = 0.085 * smoothstep(0.0, 0.12, v) * (1 - 0.62 * smoothstep(0.15, 1, v)) + 0.004;
    return { s: s + 0.03 * u * u, lat: 0, vert: koiHalfHeight(s) * 0.94 + height * u, flex: u };
  });
  // tail: a broad fork from the tail stalk, its middle shorter than its lobes
  finGrid(rows, idx, n(8), n(12), 2, (u, v) => {
    const w = v * 2 - 1;
    const aw = Math.abs(w);
    const reach = 0.235 * (1 - 0.3 * Math.pow(1 - aw, 1.6)) * (0.96 + 0.04 * aw);
    const s = 0.772 + reach * u;
    const rootH = koiHalfHeight(0.78) * 0.9;
    const vert = w * (rootH + (0.15 - rootH) * Math.pow(u, 0.85) * (0.75 + 0.25 * aw)) - 0.008 * u;
    return { s, lat: 0, vert, flex: u };
  });
  // pectorals: low on each side behind the head, reaching out, back and a little down
  for (const side of [-1, 1] as const) {
    finGrid(rows, idx, n(6), n(5), side < 0 ? 3 : 4, (u, v) => {
      const s0 = 0.2;
      const span = 0.2;
      const chord = 0.12 * Math.sqrt(Math.max(0, Math.sin(Math.PI * (0.12 + 0.88 * u)))) * (1 - 0.2 * u);
      const c = (v - 0.3) * chord;
      const s = s0 + span * 0.5 * u + c;
      const lat = side * (koiHalfWidth(s0) * 0.82 + span * 0.84 * u);
      const vert = -koiHalfHeight(s0) * 0.5 - span * 0.16 * u - 0.008 * Math.sin(Math.PI * v) * u;
      return { s, lat, vert, flex: u };
    });
  }
  // pelvics: small, under the belly
  for (const side of [-1, 1] as const) {
    finGrid(rows, idx, n(4), n(3), side < 0 ? 5 : 6, (u, v) => {
      const s0 = 0.45;
      const chord = 0.055 * Math.sqrt(Math.max(0, Math.sin(Math.PI * (0.1 + 0.9 * u))));
      const s = s0 + 0.06 * u + (v - 0.3) * chord;
      const lat = side * (koiHalfWidth(s0) * 0.45 + 0.05 * u);
      const vert = -koiHalfHeight(s0) * 0.85 - 0.04 * u;
      return { s, lat, vert, flex: u };
    });
  }
  // anal fin
  finGrid(rows, idx, n(3), n(4), 7, (u, v) => {
    const s = 0.64 + 0.1 * v;
    const height = 0.045 * Math.sin(Math.PI * (0.15 + 0.85 * v)) * (1 - 0.3 * v);
    return { s: s + 0.02 * u, lat: 0, vert: -koiHalfHeight(s) * 0.92 - height * u, flex: u };
  });
  return skinFrom(rows, idx);
}

// ---------------------------------------------------------------------------------------------------------------------
// Swimming

const SPINE_N = 17;

export interface KoiPose {
  /** the snout's arc position along the path, m */
  arc: number;
  time: number;
}

/** Scratch shared by every fish (the frame loop is single-threaded and allocates nothing). */
const sp = Array.from({ length: SPINE_N }, () => new THREE.Vector3());
const tg = Array.from({ length: SPINE_N }, () => new THREE.Vector3());
const nl = Array.from({ length: SPINE_N }, () => new THREE.Vector3());
const up = Array.from({ length: SPINE_N }, () => new THREE.Vector3());
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

/** The snout's arc position at time t (seconds) for a fish, wrapped to its path. */
export function koiArc(spec: KoiSpec, length: number, t: number): number {
  const a = spec.stillArc + spec.speed * (t - KOI_STILL_TIME);
  return ((a % length) + length) % length;
}

/**
 * Lays the spine for a fish whose snout is at `arc` along `curve` (of arc length `total`), with the body wave at time
 * `t`: SPINE_N points from the snout (0) to the tail fin's tip, each with its tangent (toward the snout), its lateral
 * and its up. The body follows the path behind the snout, so it bends as the path turns.
 */
function laySpine(curve: THREE.Curve<THREE.Vector3>, total: number, spec: KoiSpec, arc: number, t: number) {
  const L = spec.length;
  const omega = Math.PI * 2 * spec.beat;
  for (let k = 0; k < SPINE_N; k++) {
    const s = k / (SPINE_N - 1);
    const a = (((arc - s * L) % total) + total) % total;
    curve.getPointAt(a / total, sp[k]);
  }
  for (let k = 0; k < SPINE_N; k++) {
    const a = sp[Math.max(0, k - 1)];
    const b = sp[Math.min(SPINE_N - 1, k + 1)];
    tg[k].subVectors(a, b).normalize();
    nl[k].crossVectors(tg[k], WORLD_UP).normalize();
    up[k].crossVectors(nl[k], tg[k]).normalize();
  }
  // the travelling wave: small at the head, growing toward the tail, one wavelength along the body
  for (let k = 0; k < SPINE_N; k++) {
    const s = k / (SPINE_N - 1);
    const amp = L * 0.075 * (0.06 + s * s);
    sp[k].addScaledVector(nl[k], amp * Math.sin((Math.PI * 2 * s) / 0.95 - omega * t + spec.seed));
  }
  // retangent after the wave, so the sections turn with it
  for (let k = 0; k < SPINE_N; k++) {
    const a = sp[Math.max(0, k - 1)];
    const b = sp[Math.min(SPINE_N - 1, k + 1)];
    tg[k].subVectors(a, b).normalize();
    nl[k].crossVectors(tg[k], WORLD_UP).normalize();
    up[k].crossVectors(nl[k], tg[k]).normalize();
  }
}

/** Writes a skinned mesh's positions for the current spine. */
function skin(m: KoiSkin, spec: KoiSpec, t: number) {
  const L = spec.length;
  const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const omega = Math.PI * 2 * spec.beat;
  const paddle = Math.PI * 2 * 0.45;
  for (let i = 0; i < m.s.length; i++) {
    const s = Math.min(1, Math.max(0, m.s[i]));
    const f = s * (SPINE_N - 1);
    const k = Math.min(SPINE_N - 2, Math.floor(f));
    const w = f - k;
    let lat = m.lat[i] * L;
    let vert = m.vert[i] * L;
    const flex = m.flex[i];
    switch (m.kind[i]) {
      case 1:
        lat += flex * L * 0.014 * Math.sin(omega * t * 1.3 + s * 9);
        break;
      case 2:
        // the tail trails the body's wave a little and ripples at its edge
        lat += Math.pow(flex, 1.4) * L * 0.07 * Math.sin((Math.PI * 2 * s) / 0.95 - omega * t + spec.seed - 1.1 * flex);
        vert += flex * L * 0.006 * Math.sin(omega * t * 2 + m.vert[i] * 40);
        break;
      case 3:
      case 4: {
        const side = m.kind[i] === 3 ? -1 : 1;
        const beat = Math.sin(paddle * t + side * 0.9 + spec.seed);
        vert += flex * L * 0.045 * beat;
        lat -= side * flex * L * 0.018 * (0.5 + 0.5 * beat);
        break;
      }
      case 5:
      case 6:
        vert += flex * L * 0.012 * Math.sin(paddle * t * 0.8 + m.kind[i]);
        break;
      case 7:
        lat += flex * L * 0.01 * Math.sin(omega * t + s * 7);
        break;
      default:
        break;
    }
    const ox = sp[k].x + (sp[k + 1].x - sp[k].x) * w;
    const oy = sp[k].y + (sp[k + 1].y - sp[k].y) * w;
    const oz = sp[k].z + (sp[k + 1].z - sp[k].z) * w;
    tmp.copy(nl[k]).lerp(nl[k + 1], w);
    const nx = tmp.x;
    const ny = tmp.y;
    const nz = tmp.z;
    tmp.copy(up[k]).lerp(up[k + 1], w);
    arr[i * 3] = ox + nx * lat + tmp.x * vert;
    arr[i * 3 + 1] = oy + ny * lat + tmp.y * vert;
    arr[i * 3 + 2] = oz + nz * lat + tmp.z * vert;
  }
  pos.needsUpdate = true;
  m.geometry.computeVertexNormals();
  m.geometry.computeBoundingSphere();
}

/** Poses one fish (its body and fins) at time t along its curve. */
export function poseKoi(spec: KoiSpec, curve: THREE.Curve<THREE.Vector3>, total: number, body: KoiSkin, fins: KoiSkin, t: number) {
  poseKoiAt(spec, curve, total, body, fins, koiArc(spec, total, t), t);
}

/**
 * Poses one fish with its snout at `arc` along `curve` (of arc length `total`) and the body wave at time t: for a fish
 * whose place along its path is kept by its caller (the product's koi, components/lotus/product, whose paths change
 * shape as they gather and circle) rather than read off the clock.
 */
export function poseKoiAt(spec: KoiSpec, curve: THREE.Curve<THREE.Vector3>, total: number, body: KoiSkin, fins: KoiSkin, arc: number, t: number) {
  laySpine(curve, total, spec, arc, t);
  skin(body, spec, t);
  skin(fins, spec, t);
}

/** Where a posed fish's snout is now (the spine's first point, in the pond frame), into `out`. */
export function koiSnout(out: THREE.Vector3): THREE.Vector3 {
  return out.copy(sp[0]);
}

/** The arc position (m) along a fish's path of its surfacing waypoint: worked out once per path. */
export function koiSurfaceArc(spec: KoiSpec, curve: THREE.CatmullRomCurve3, total: number): number {
  const target = curve.points[spec.surfaceAt];
  const n = curve.points.length * 60;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(i / n, tmp);
    const d = tmp.distanceToSquared(target);
    if (d < bestD) {
      bestD = d;
      best = (i / n) * total;
    }
  }
  return best;
}

/**
 * How long ago (seconds) the fish last nosed up under the surface at its surfacing waypoint, the soft ring's age;
 * deterministic in t, so a still frame holds its ring.
 */
export function koiRingAge(spec: KoiSpec, total: number, surfaceArc: number, t: number): number {
  const period = total / spec.speed;
  const since = ((t - KOI_STILL_TIME) * spec.speed + spec.stillArc - surfaceArc) / spec.speed;
  return ((since % period) + period) % period;
}

/** Triangles in one fish (body and fins) at a tier. */
export function koiTriangles(tier: KoiTier): number {
  const b = makeKoiBody(tier);
  const f = makeKoiFins(tier);
  const n = (b.geometry.index!.count + f.geometry.index!.count) / 3;
  b.geometry.dispose();
  f.geometry.dispose();
  return n;
}
