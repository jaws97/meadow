// The lotus's procedural geometry, all original: the three urli options as lathes on the model's inner shape
// (frame.ts), the mud and the water's disc, the round peltate leaf, prickly stalks, the turbinate receptacle and its
// seed pod, the stamens, the seed's glass jar and its stone. Petals and the outer tepals come from the garden's own
// builders (lib/plant/geometry: makePetalGeometry's bud-to-open morph suits a lotus petal). Pure three.js: no DOM,
// so the triangle budgets can be checked in a unit test (geometry.test.ts).
//
// Local frames, as the rest of the garden's flower code:
// - lathes: y up, the profile as [radius, y] pairs from the outside foot over the rim and down the inner wall;
// - a leaf blade: centre (the stalk's attachment, the navel) at the origin, upper face +y;
// - a stamen: base at the origin along +y, curving out toward +z;
// - the receptacle: base at the origin, flat top at y = height.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeThornGeometry } from "@/lib/plant/geometry";
import { Rng, smoothstep, vnoise2 } from "@/lib/plant/prng";
import { innerR, URLI, VESSEL_OUTER } from "@/components/lotus/frame";
import type { Vessel } from "@/components/lotus/params";

export type Tier = "cinematic" | "balanced" | "lite";

/** Triangles in an indexed or plain geometry (instances not counted). */
export function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("lotus: parts could not be merged");
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Smooth lathes with creases and arc-length v

export interface ProfilePoint {
  r: number;
  y: number;
  /** a hard edge here: the surface on either side gets its own normal */
  crease?: boolean;
}

/**
 * A surface of revolution with smooth normals along the profile except at creases, and v running by arc length
 * (0 at the first point, 1 at the last), so a texture painted in profile bands lands where it is meant to. The
 * profile's direction decides the front face: the surface faces right of travel (outward going up the outside,
 * inward coming down the inside).
 */
export function smoothLathe(profile: readonly ProfilePoint[], segs: number): THREE.BufferGeometry {
  const lens = [0];
  for (let j = 1; j < profile.length; j++) {
    lens.push(lens[j - 1] + Math.hypot(profile[j].r - profile[j - 1].r, profile[j].y - profile[j - 1].y));
  }
  const total = lens[lens.length - 1] || 1;
  // split into smooth strips at the creases
  const strips: number[][] = [];
  let cur: number[] = [0];
  for (let j = 1; j < profile.length; j++) {
    cur.push(j);
    if (profile[j].crease && j < profile.length - 1) {
      strips.push(cur);
      cur = [j];
    }
  }
  strips.push(cur);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cols = segs + 1;
  for (const strip of strips) {
    const base = pos.length / 3;
    for (let k = 0; k < strip.length; k++) {
      const j = strip[k];
      const a = profile[strip[Math.max(0, k - 1)]];
      const b = profile[strip[Math.min(strip.length - 1, k + 1)]];
      let dr = b.r - a.r;
      let dy = b.y - a.y;
      const l = Math.hypot(dr, dy) || 1;
      dr /= l;
      dy /= l;
      const nr = dy;
      const ny = -dr;
      const p = profile[j];
      for (let i = 0; i < cols; i++) {
        const ang = (i / segs) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        pos.push(p.r * c, p.y, p.r * s);
        nor.push(nr * c, ny, nr * s);
        uv.push(i / segs, lens[j] / total);
      }
    }
    for (let k = 0; k < strip.length - 1; k++) {
      for (let i = 0; i < segs; i++) {
        const a = base + k * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** v (arc length share) of profile point `i`. */
function arcV(profile: readonly ProfilePoint[], i: number): number {
  let total = 0;
  let at = 0;
  for (let j = 1; j < profile.length; j++) {
    total += Math.hypot(profile[j].r - profile[j - 1].r, profile[j].y - profile[j - 1].y);
    if (j === i) at = total;
  }
  return total > 0 ? at / total : 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The urli

/** Where each painted band of the vessel falls along its profile (v), for its texture (textures.ts). */
export interface UrliZones {
  /** the foot ring, from the bottom up to here */
  foot: number;
  /** the outside belly, up to the rim */
  rimStart: number;
  /** the rim's crest */
  crest: number;
  /** where the rim meets the inner wall */
  innerStart: number;
  /** the brim (40 mm of water) and the fill line (25 mm) on the inner wall */
  brim: number;
  fill: number;
  /** the mud's top */
  mud: number;
  /** an incised line or a lustre line under the rim, on the outside */
  band: number;
}

export interface UrliProfile {
  points: ProfilePoint[];
  zones: UrliZones;
}

const innerWall = (from: number, to: number, steps: number): ProfilePoint[] => {
  const out: ProfilePoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const y = from + (to - from) * (k / steps);
    out.push({ r: innerR(y), y });
  }
  return out;
};

/** The profile of each vessel option (art direction, section 2), all on the same inner shape. */
export function urliProfile(vessel: Vessel): UrliProfile {
  const pts: ProfilePoint[] = [];
  const mark: Partial<Record<keyof UrliZones, number>> = {};
  const at = (k: keyof UrliZones) => {
    mark[k] = pts.length - 1;
  };
  const below = URLI.mudY - 0.012;
  if (vessel === "a") {
    // Mannar bell metal: a foot ring 0.22 m across and 1.2 cm high, a 6 mm wall with a soft bell belly, a rolled
    // bead 1.2 cm round standing proud of the wall, cast and turned.
    pts.push({ r: 0.094, y: -0.005 }, { r: 0.11, y: -0.005, crease: true }, { r: 0.1125, y: 0.0065 }, { r: 0.108, y: 0.009, crease: true });
    at("foot");
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const y = 0.012 + (0.1235 - 0.012) * t;
      const bulge = 0.0045 * Math.sin(Math.PI * Math.pow(t, 0.85));
      pts.push({ r: innerR(Math.max(URLI.floorY, y)) + 0.006 + bulge - (k === 0 ? 0.002 : 0), y, crease: k === steps });
      if (k === steps - 2) at("band");
    }
    at("rimStart");
    // the bead: a circle of 6.5 mm round (0.187, 0.131), from under it, over the crest, to the inside
    const cr = 0.0065;
    for (let k = 0; k <= 8; k++) {
      const a = -1.75 + (k / 8) * (1.75 + 2.6);
      pts.push({ r: 0.187 + cr * Math.cos(a), y: 0.131 + cr * Math.sin(a) });
      if (k === 4) at("crest");
    }
    pts.push({ r: 0.177, y: 0.1355 }, { r: innerR(0.1335) + 0.0006, y: 0.1335 });
    at("innerStart");
  } else if (vessel === "b") {
    // Bangalore granite: a flat base set 2 cm into the mulch, a slightly convex pick-dressed body, a flat rim 3.2 cm
    // wide with 4 mm chamfers, worn smooth on top.
    pts.push({ r: 0.15, y: -0.02 }, { r: 0.188, y: -0.02, crease: true });
    at("foot");
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const y = -0.02 + (0.134 + 0.02) * t;
      pts.push({ r: 0.188 + 0.027 * t + 0.006 * Math.sin(Math.PI * t), y });
      if (k === steps - 2) at("band");
    }
    pts[pts.length - 1].crease = true;
    at("rimStart");
    pts.push({ r: 0.211, y: 0.138, crease: true });
    pts.push({ r: 0.195, y: 0.1381 });
    at("crest");
    pts.push({ r: 0.179, y: 0.138, crease: true });
    pts.push({ r: innerR(0.134), y: 0.134, crease: true });
    at("innerStart");
  } else {
    // Duck-egg glazed stoneware: a 1.2 cm wall, a rounded rolled rim, a foot ring 0.20 m across; the glaze breaks to
    // toasted clay on the rim's edge and the foot.
    pts.push({ r: 0.085, y: -0.004 }, { r: 0.1, y: -0.004, crease: true }, { r: 0.1015, y: 0.008 }, { r: 0.098, y: 0.0105, crease: true });
    at("foot");
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const y = 0.013 + (0.126 - 0.013) * t;
      const bulge = 0.008 * Math.sin(Math.PI * Math.pow(t, 0.9));
      pts.push({ r: innerR(Math.max(URLI.floorY, y)) + 0.012 + bulge - (k === 0 ? 0.004 : 0), y, crease: k === steps });
      if (k === steps - 2) at("band");
    }
    at("rimStart");
    const cr = 0.0068;
    for (let k = 0; k <= 8; k++) {
      const a = -1.5 + (k / 8) * (1.5 + 2.75);
      pts.push({ r: 0.186 + cr * Math.cos(a), y: 0.1317 + cr * Math.sin(a) });
      if (k === 4) at("crest");
    }
    pts.push({ r: innerR(0.1335) + 0.001, y: 0.1335 });
    at("innerStart");
  }
  // the inner wall, from just under the rim past the brim and the fill line to below the mud (the mud hides the rest)
  const wall = innerWall(0.132, below, 10);
  const first = pts.length;
  pts.push(...wall);
  // the brim and fill line marks, by height
  const nearest = (y: number) => {
    let best = first;
    for (let k = first; k < pts.length; k++) if (Math.abs(pts[k].y - y) < Math.abs(pts[best].y - y)) best = k;
    return best;
  };
  // the brim (40 mm) is the rim's inner lip itself, 1.5 cm over the fill line
  const fillI = nearest(URLI.fillY);
  const mudI = nearest(URLI.mudY);
  // snap the marked points to the exact heights so the painted lines sit on them
  pts[fillI] = { r: innerR(URLI.fillY), y: URLI.fillY };
  pts[mudI] = { r: innerR(URLI.mudY), y: URLI.mudY };
  const zones: UrliZones = {
    foot: arcV(pts, mark.foot ?? 0),
    rimStart: arcV(pts, mark.rimStart ?? 0),
    crest: arcV(pts, mark.crest ?? 0),
    innerStart: arcV(pts, mark.innerStart ?? 0),
    brim: arcV(pts, mark.innerStart ?? 0),
    fill: arcV(pts, fillI),
    mud: arcV(pts, mudI),
    band: arcV(pts, mark.band ?? 0),
  };
  return { points: pts, zones };
}

export const URLI_SEGS: Record<Tier, number> = { cinematic: 96, balanced: 64, lite: 40 };

/** The vessel, with option A's two cast loop lugs turned to sit left and right across the camera. */
export function makeUrliGeometry(vessel: Vessel, tier: Tier): THREE.BufferGeometry {
  const { points, zones } = urliProfile(vessel);
  const body = smoothLathe(points, URLI_SEGS[tier]);
  if (vessel !== "a") return body;
  const parts = [body];
  const radial = tier === "lite" ? 4 : 6;
  const tubular = tier === "lite" ? 10 : 18;
  for (const side of [-1, 1]) {
    const lug = new THREE.TorusGeometry(0.0145, 0.0033, radial, tubular);
    // in the x-y plane, so it reads as an open loop from the camera; half sunk into the bead
    lug.translate(side * (VESSEL_OUTER.a.outerR + 0.0085), 0.124, 0);
    const uv = lug.attributes.uv as THREE.BufferAttribute;
    // burnished like the rim: the texture's crest band
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.25 + 0.5 * (side > 0 ? 1 : 0), zones.crest);
    parts.push(lug);
  }
  return merged(parts);
}

/** The light-play band's segments round the wall (none drawn on lite). */
export const BAND_SEGS: Record<Tier, number> = { cinematic: 72, balanced: 48, lite: 32 };

/**
 * A band of the inner wall from the water's surface up to the brim, a hair inside the wall, facing inward: the
 * far side, which the camera sees, carries the light thrown up off the rippled water (section 3.5).
 */
export function makeWallBand(fromY: number, toY: number, segs: number): THREE.BufferGeometry {
  const pts: ProfilePoint[] = [];
  const n = 3;
  for (let k = 0; k <= n; k++) {
    const y = toY + (fromY - toY) * (k / n);
    pts.push({ r: innerR(y) - 0.0008, y });
  }
  return smoothLathe(pts, segs);
}

// ---------------------------------------------------------------------------------------------------------------------
// Mud and water

export const WATER_TESS: Record<Tier, [number, number]> = { cinematic: [8, 64], balanced: [6, 48], lite: [4, 32] };
export const MUD_TESS: Record<Tier, [number, number]> = { cinematic: [10, 64], balanced: [7, 48], lite: [5, 32] };

/**
 * The mud's top: a disc a little wider than the wall at the mud line (its edge tucks under the wall), very slightly
 * dished, with a few pebbles at the edge. UV planar over the disc.
 */
export function makeMudGeometry(rings: number, segs: number, seed: number): THREE.BufferGeometry {
  const R = innerR(URLI.mudY) + 0.003;
  const rng = new Rng(seed);
  const pebbles = Array.from({ length: 7 }, () => ({ a: rng.next() * Math.PI * 2, r: 0.8 + 0.15 * rng.next(), s: 0.05 + 0.04 * rng.next(), h: 0.003 + 0.003 * rng.next() }));
  const height = (rr: number, a: number) => {
    let y = -0.003 * (1 - rr * rr) + 0.0012 * vnoise2(Math.cos(a) * rr * 9 + seed, Math.sin(a) * rr * 9);
    for (const p of pebbles) {
      const dx = rr * Math.cos(a) - p.r * Math.cos(p.a);
      const dz = rr * Math.sin(a) - p.r * Math.sin(p.a);
      const d = Math.hypot(dx, dz) / p.s;
      if (d < 1) y += p.h * Math.sqrt(1 - d * d);
    }
    // rises a touch into the wall so no gap shows at the edge
    return y + 0.004 * smoothstep(0.93, 1, rr);
  };
  return polarDisc(rings, segs, (rr, a) => [rr * R * Math.cos(a), height(rr, a), rr * R * Math.sin(a)], R);
}

/** A unit disc facing +y, for the water (scaled to the level's radius each frame). */
export function makeWaterDisc(rings: number, segs: number): THREE.BufferGeometry {
  return polarDisc(rings, segs, (rr, a) => [rr * Math.cos(a), 0, rr * Math.sin(a)], 1);
}

/**
 * A polar grid (a centre and `rings` rings of `segs`) from a position function of the normalised radius and angle;
 * front faces up (+y), uv planar over radius `uvR`.
 */
function polarDisc(rings: number, segs: number, at: (rr: number, a: number) => readonly [number, number, number], uvR: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const c = at(0, 0);
  pos.push(c[0], c[1], c[2]);
  uv.push(0.5 + c[0] / (2 * uvR), 0.5 + c[2] / (2 * uvR));
  for (let k = 1; k <= rings; k++) {
    const rr = k / rings;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const p = at(rr, a);
      pos.push(p[0], p[1], p[2]);
      uv.push(0.5 + p[0] / (2 * uvR), 0.5 + p[2] / (2 * uvR));
    }
  }
  const ring = (k: number, i: number) => 1 + (k - 1) * segs + (i % segs);
  for (let i = 0; i < segs; i++) idx.push(0, ring(1, i + 1), ring(1, i));
  for (let k = 1; k < rings; k++) {
    for (let i = 0; i < segs; i++) {
      const a = ring(k, i);
      const b = ring(k, i + 1);
      const cc = ring(k + 1, i);
      const d = ring(k + 1, i + 1);
      idx.push(a, b, cc, b, d, cc);
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

// ---------------------------------------------------------------------------------------------------------------------
// The leaf

export interface PadSpec {
  radius: number;
  /** bowl depth as a share of the radius */
  cup: number;
  waves: number;
  waveAmp: number;
  edgeLift: number;
  navelDip: number;
  asym: number;
  /** 0 .. 1: the cup turned in like an umbrella, the edges curled under, a slight fold along a diameter */
  wilt: number;
  /** 0 .. 1: the edges curled up and a little ragged, like drying paper */
  crisp: number;
}

/** A standing leaf's blade: a shallow funnel with six to nine broad waves round the edge (section 4.0). */
export function standingPad(radius: number, cup: number, wilt: number, crisp: number): PadSpec {
  // v2: broader, deeper waves round a wavy rim (the first renders read as flat discs)
  return { radius, cup, waves: 8, waveAmp: 0.075, edgeLift: 0.035, navelDip: 0.008, asym: 0.04, wilt, crisp };
}

/** A floating leaf: flat on the water, its slightly wavy edge just turned up. */
export function floatingPad(radius: number, crisp: number): PadSpec {
  return { radius, cup: 0.02, waves: 7, waveAmp: 0.022, edgeLift: 0.07, navelDip: 0.003, asym: 0.04, wilt: 0, crisp };
}

export const PAD_TESS: Record<Tier, { stand: [number, number]; float: [number, number] }> = {
  cinematic: { stand: [14, 56], float: [8, 40] },
  balanced: { stand: [10, 40], float: [6, 28] },
  lite: { stand: [6, 24], float: [4, 18] },
};

/**
 * The round peltate leaf: the stalk joins the centre (the navel) and there is no slit, unlike a water lily; the
 * margin is entire, gently undulate. Polar grid, upper face +y, uv planar so one square canvas holds the radial
 * veins (textures.padTexture). The wilted and crisp forms are baked in from the spec, for the concepts page; the build
 * can carry them as morph targets instead (art direction 10.3).
 */
export function makePadGeometry(spec: PadSpec, seed: number, rings: number, segs: number): THREE.BufferGeometry {
  const R = spec.radius;
  const ph1 = (seed * 1.618) % (Math.PI * 2);
  const ph2 = (seed * 2.414) % (Math.PI * 2);
  const uvR = R * (1 + Math.abs(spec.asym)) * 1.03;
  const jag = (a: number) => (spec.crisp > 0 ? spec.crisp * (0.035 + 0.035 * vnoise2(a * 5 + seed, seed * 0.3)) : 0);
  const at = (rr: number, a: number): [number, number, number] => {
    const rim = R * (1 + spec.asym * Math.sin(a + ph2)) * (1 - jag(a) * smoothstep(0.7, 1, rr));
    const r = rr * rim;
    const n = rr;
    const cupped =
      spec.cup * R * n * n +
      spec.waveAmp * R * n * n * n * Math.sin(spec.waves * a + ph1) +
      spec.edgeLift * R * smoothstep(0.85, 1, n) -
      spec.navelDip * Math.exp(-((n / 0.06) ** 2));
    const wilted =
      -0.36 * R * n * n - 0.22 * R * smoothstep(0.6, 1, n) ** 2 - 0.06 * R * n * Math.abs(Math.sin(a + ph1)) + 0.02 * R * n * Math.sin(spec.waves * a + ph1);
    let y = cupped + (wilted - cupped) * spec.wilt;
    // drying paper: the rim curls up, unevenly
    y += spec.crisp * R * (0.16 + 0.08 * vnoise2(a * 3 + seed, 1.7)) * smoothstep(0.72, 1, n) ** 2;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  return polarDisc(rings, segs, at, uvR);
}

// ---------------------------------------------------------------------------------------------------------------------
// Stalks

const tubeN = new THREE.Vector3();
const thornS = new THREE.Vector3();
const tubeP = new THREE.Vector3();
const thornM = new THREE.Matrix4();
const thornX = new THREE.Vector3();
const thornY = new THREE.Vector3();
const thornZ = new THREE.Vector3();

/**
 * A tapered tube along `curve`, with sparse short prickles (1.5-2.5 mm, a little denser near the top) merged in:
 * the leaf stalks carry hard scattered papillae, the flower stalk is sparsely spinulate (Flora of China).
 */
export function makeStalkGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  r0: number,
  r1: number,
  tubular: number,
  radial: number,
  prickles: number,
  seed: number,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, tubeP);
    const r = r0 + (r1 - r0) * t;
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a);
      const c = -Math.cos(a);
      tubeN.set(c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z);
      pos.push(tubeP.x + r * tubeN.x, tubeP.y + r * tubeN.y, tubeP.z + r * tubeN.z);
      nor.push(tubeN.x, tubeN.y, tubeN.z);
      uv.push(j / radial, t * 4);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const tube = new THREE.BufferGeometry();
  tube.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  tube.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  tube.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  tube.setIndex(idx);
  if (prickles <= 0) {
    tube.computeBoundingSphere();
    return tube;
  }
  const rng = new Rng(seed);
  const unit = makeThornGeometry(4, 3);
  const parts = [tube];
  for (let k = 0; k < prickles; k++) {
    // above the water line (the lowest fifth stays bare), denser toward the top
    const t = 0.2 + 0.8 * Math.sqrt(rng.next());
    const a = rng.next() * Math.PI * 2;
    const len = 0.0015 + 0.001 * rng.next();
    curve.getPointAt(t, tubeP);
    const fi = Math.min(tubular, Math.round(t * tubular));
    const N = frames.normals[fi];
    const B = frames.binormals[fi];
    const T = frames.tangents[fi];
    const r = r0 + (r1 - r0) * t;
    // the prickle stands out of the surface (+y) and hooks up the stalk (+z)
    thornY.set(0, 0, 0).addScaledVector(N, -Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
    const along = T.dot(thornY);
    thornZ.copy(T).addScaledVector(thornY, -along).normalize();
    thornX.crossVectors(thornY, thornZ);
    thornM
      .makeBasis(thornX, thornY, thornZ)
      .scale(thornS.set(len, len, len))
      .setPosition(tubeP.x + thornY.x * r * 0.85, tubeP.y + thornY.y * r * 0.85, tubeP.z + thornY.z * r * 0.85);
    const p = unit.clone().applyMatrix4(thornM);
    parts.push(p);
  }
  unit.dispose();
  return merged(parts);
}

/** A stalk from `from` to `to` that leaves the mud upright and arrives along `endDir` (a unit vector). */
export function stalkCurve(from: THREE.Vector3, to: THREE.Vector3, endDir: THREE.Vector3, bow = 0): THREE.CubicBezierCurve3 {
  const h = to.distanceTo(from);
  const c1 = from.clone().add(new THREE.Vector3(0, h * 0.42, 0));
  const c2 = to.clone().addScaledVector(endDir, -h * (0.32 + 0.1 * bow));
  return new THREE.CubicBezierCurve3(from.clone(), c1, c2, to.clone());
}

// ---------------------------------------------------------------------------------------------------------------------
// The flower's heart

export interface ReceptacleSpec {
  radius: number;
  height: number;
  pits: number;
  /** 0 the flower's receptacle .. 1 the swollen pod: wider, its top a little concave, deeper pits with dark seed tops */
  pod: number;
  body: THREE.Color;
  nub: THREE.Color;
}

/**
 * The turbinate receptacle (an inverted cone with a flat top), with stigma nubs on a sunflower spiral in shallow pits;
 * as a pod, the same shape swollen. Vertex colours carry the body and nub colours.
 */
export function makeReceptacleGeometry(spec: ReceptacleSpec, tier: Tier): THREE.BufferGeometry {
  const segs = tier === "cinematic" ? 32 : tier === "balanced" ? 20 : 12;
  const R = spec.radius * (1 + 0.75 * spec.pod);
  const H = spec.height * (1 + 0.35 * spec.pod);
  const dish = 0.06 * spec.pod * H;
  const prof: ProfilePoint[] = [
    { r: 0.35 * R, y: 0 },
    { r: 0.6 * R, y: 0.3 * H },
    { r: 0.85 * R, y: 0.7 * H },
    { r: 1.0 * R, y: 0.95 * H },
    { r: 0.97 * R, y: 1.0 * H, crease: true },
    { r: 0.6 * R, y: H - dish * 0.6 },
    { r: 0.001, y: H - dish },
  ];
  const body = smoothLathe(prof, segs);
  paintGeometry(body, spec.body);
  const parts = [body];
  const nubDetail = tier === "lite" ? [5, 2] : [7, 3];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < spec.pits; i++) {
    const rr = 0.8 * R * Math.sqrt((i + 0.5) / spec.pits);
    const a = i * golden;
    const nubR = (0.0024 + 0.0024 * spec.pod) * (R / spec.radius) * 0.6;
    const n = new THREE.SphereGeometry(nubR, nubDetail[0], nubDetail[1], 0, Math.PI * 2, 0, Math.PI / 2);
    n.scale(1, 0.75 - 0.4 * spec.pod, 1);
    const yTop = H - dish * (1 - (rr / R) ** 2) - 0.0015 * spec.pod;
    n.translate(Math.cos(a) * rr, yTop, Math.sin(a) * rr);
    paintGeometry(n, spec.nub);
    parts.push(n);
  }
  return merged(parts);
}

function paintGeometry(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/** Stamens per tier (art direction 10.7). */
export const STAMENS: Record<Tier, number> = { cinematic: 160, balanced: 90, lite: 48 };

/**
 * One stamen for instancing: a slender cream filament grading into the long yellow anther, curving outward (+z),
 * with the white club-shaped appendage at its tip turned in (Flora of China: connective appendage clavate,
 * incurved). About 26 triangles; vertex colours.
 */
export function makeStamenGeometry(): THREE.BufferGeometry {
  const filament = new THREE.Color("#f5e3a0");
  const anther = new THREE.Color("#f2c84b");
  const club = new THREE.Color("#fbf3dc");
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.014, 0.001), new THREE.Vector3(0, 0.024, 0.0065));
  const tubular = 3;
  const radial = 3;
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, tubeP);
    const r = 0.00045 + 0.0005 * smoothstep(0.3, 0.7, t);
    const c = filament.clone().lerp(anther, smoothstep(0.35, 0.6, t));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const N = frames.normals[i];
      const B = frames.binormals[i];
      tubeN.set(-Math.cos(a) * N.x + Math.sin(a) * B.x, -Math.cos(a) * N.y + Math.sin(a) * B.y, -Math.cos(a) * N.z + Math.sin(a) * B.z);
      pos.push(tubeP.x + r * tubeN.x, tubeP.y + r * tubeN.y, tubeP.z + r * tubeN.z);
      nor.push(tubeN.x, tubeN.y, tubeN.z);
      col.push(c.r, c.g, c.b);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const stem = new THREE.BufferGeometry();
  stem.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  stem.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  stem.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  stem.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  stem.setIndex(idx);
  // the club: an octahedron drawn long, leaning in over the tip
  const tip = new THREE.OctahedronGeometry(0.0013, 0);
  tip.scale(1, 1.9, 1);
  tip.rotateX(-0.5);
  tip.translate(0, 0.0258, 0.0056);
  const tipIndexed = withIndex(tip);
  paintGeometry(tipIndexed, club);
  return merged([stem, tipIndexed]);
}

/** Polyhedra come unindexed; merging wants every part alike. */
function withIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// The seed's jar and its stone

export interface JarGeometry {
  glass: THREE.BufferGeometry;
  water: THREE.BufferGeometry;
  seed: THREE.BufferGeometry;
  root: THREE.BufferGeometry;
  stone: THREE.BufferGeometry;
  /** the jar's base above its stone, and the water's surface height in the jar's frame */
  waterTop: number;
}

/**
 * A plain kitchen glass jar, 8 cm across and 11 cm tall (props drawn at 1.15, like the can), slightly tapered, with a
 * thick base and no lid; water to 80%; the seed (an ovoid 1.8 cm long) on the bottom with its short white root; the
 * flat fieldstone it stands on (section 4.1). The jar's frame: base of the glass at y = 0.
 */
export function makeJarGeometry(tier: Tier): JarGeometry {
  const segs = tier === "cinematic" ? 40 : tier === "balanced" ? 28 : 18;
  const H = 0.11;
  const rB = 0.037;
  const rT = 0.04;
  const wall = 0.0022;
  const glassProfile: ProfilePoint[] = [
    { r: 0.0005, y: 0 },
    { r: rB - 0.003, y: 0, crease: true },
    { r: rB, y: 0.004 },
    { r: rB + (rT - rB) * 0.5, y: H * 0.5 },
    { r: rT, y: H - 0.003 },
    { r: rT - 0.0004, y: H, crease: true },
    { r: rT - wall - 0.0004, y: H, crease: true },
    { r: rT - wall, y: H - 0.003 },
    { r: rB - wall + (rT - rB) * 0.5, y: H * 0.5 },
    { r: rB - wall, y: 0.012 },
    { r: rB - wall - 0.004, y: 0.0085, crease: true },
    { r: 0.0005, y: 0.0085 },
  ];
  const glass = smoothLathe(glassProfile, segs);
  const waterTop = 0.0085 + (H - 0.0085) * 0.8;
  const inner = (y: number) => rB - wall - 0.0006 + (rT - rB) * (y / H);
  const water = smoothLathe(
    [
      { r: 0.0005, y: waterTop },
      { r: inner(waterTop), y: waterTop, crease: true },
      { r: inner(0.012), y: 0.012 },
      { r: inner(0.012) - 0.004, y: 0.009, crease: true },
      { r: 0.0005, y: 0.009 },
    ],
    segs,
  );
  // the seed: dark, glossy, an ovoid 1.8 cm long, lying on the bottom
  const seed = new THREE.SphereGeometry(0.0072, tier === "lite" ? 10 : 16, tier === "lite" ? 8 : 12);
  seed.scale(1.25, 0.85, 0.95);
  seed.rotateY(0.6);
  // the root: white, a couple of centimetres, curling down round the seed
  const rootCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0085, 0.001, 0.003),
    new THREE.Vector3(0.016, -0.002, 0.008),
    new THREE.Vector3(0.019, -0.0055, 0.015),
    new THREE.Vector3(0.016, -0.006, 0.022),
  ]);
  const root = makeStalkGeometry(rootCurve, 0.0011, 0.0004, 8, 4, 0, 1);
  // the stone: a flat fieldstone 12 x 9 x 2 cm, vertex-coloured for the kerb's stone material
  const stone = new THREE.SphereGeometry(1, tier === "lite" ? 12 : 20, tier === "lite" ? 6 : 10);
  const sp = stone.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const y = sp.getY(i);
    const z = sp.getZ(i);
    const n = 1 + 0.08 * vnoise2(x * 2.3 + 1.7, z * 2.3) + 0.04 * vnoise2(x * 6 + y * 3, z * 6);
    // flat on top and bottom, rounded at the sides
    const yy = Math.sign(y) * Math.pow(Math.abs(y), 0.55);
    sp.setXYZ(i, x * 0.06 * n, yy * 0.011 + 0.002 * vnoise2(x * 9, z * 9), z * 0.046 * n);
  }
  stone.computeVertexNormals();
  paintGeometry(stone, new THREE.Color("#b9b1a2"));
  return { glass, water, seed, root, stone, waterTop };
}

// ---------------------------------------------------------------------------------------------------------------------
// The lotus petal (v2)

/**
 * A lotus petal (Flora of China: tepals oblong-elliptic to obovate, 5-10 x 3-5 cm; the art direction's "deeply
 * boat-cupped, with slightly incurved, hooded tips"): broad, widest a little past the middle, a narrow cream claw at
 * the base and a blunt rounded tip, deeply concave across (a boat) and spoon-curved along its length, the tip turned
 * in. Not the garden's petal (lib/plant makePetalGeometry), whose blade runs to a point.
 */
export interface LotusPetalShape {
  length: number;
  width: number;
  /** the boat: how far the margins stand forward of the midline, as a share of the half width (open form) */
  cup: number;
  /** the spoon: the spine's turn from base to tip, radians (open form) */
  curve: number;
  /** the hooded tip's extra incurve, radians */
  hood: number;
  /** the claw's width at the base, as a share of the full width */
  claw: number;
  /** where along its length it is widest (0..1) */
  peak: number;
  /**
   * the tip's roundness: the power on the outline near the end (under a half keeps it blunt and round; 0.42 by default;
   * the ripe bud's petals run to a point, about 0.8)
   */
  tip?: number;
}

function lotusPetalWidth(v: number, s: LotusPetalShape): number {
  const a = Math.log(0.5) / Math.log(s.peak);
  // a blunt, rounded tip (a power under a half keeps the outline's tangent upright at the end)
  const core = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(v, a))), s.tip ?? 0.42);
  return core + s.claw * (1 - smoothstep(0, 0.42, v)) * (1 - core);
}

/**
 * One form of the petal. `closed` is the form the geometry keeps (the ripe bud's petal, or a closed flower's cup):
 * curved in from base to tip so the tips meet over the axis, cupped deeper; the open form is the morph target. Base at
 * the origin, the blade along +y, the inner (concave) face toward -z, as lib/plant's petals, so petalAngle's rotation
 * about x opens it outward.
 */
function lotusPetalPositions(s: LotusPetalShape, seed: number, nu: number, nv: number, closed: boolean): number[] {
  const pos: number[] = [];
  const p1 = (seed * 1.37) % 6.283;
  const p2 = (seed * 2.71) % 6.283;
  const dv = 1 / nv;
  const sy = new Float64Array(nu + 1);
  const sz = new Float64Array(nu + 1);
  const theta = (v: number, au: number) => {
    // closed: leaning out a little at the base and curving in to the tip; open: a spoon's arc with the hood
    const hood = s.hood * Math.pow(smoothstep(0.55, 1, v), 1.8) * (1 + 0.25 * au);
    return closed ? 0.15 - 0.98 * v - 0.6 * hood : s.curve * (0.5 - v) - hood;
  };
  const cup = closed ? Math.min(1.35, s.cup * 1.35) : s.cup;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const halfW = (s.width / 2) * lotusPetalWidth(v, s);
    // the boat holds its depth toward the tip, where it closes into the hood
    const depth = cup * (0.85 + 0.15 * smoothstep(0.2, 0.8, v));
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      const au = Math.abs(u);
      const th = theta(v, au);
      if (j > 0) {
        const mid = 0.5 * (th + theta(v - dv, au));
        sy[i] += Math.cos(mid) * s.length * dv;
        sz[i] += Math.sin(mid) * s.length * dv;
      }
      // a round-bottomed boat: the margins rise steeply, the keel stays broad
      const cx = u * halfW * (1 - 0.08 * depth * au * au);
      let cn = depth * halfW * (0.35 * u * u + 0.65 * Math.pow(au, 3.2));
      // a faint ripple at the margins of the upper half
      cn += s.length * 0.012 * Math.sin(v * 11 + u * 3 + p1) * Math.pow(au, 2) * smoothstep(0.3, 1, v) * (closed ? 0.3 : 1);
      const st = Math.sin(th);
      const ct = Math.cos(th);
      const wob = Math.sin(v * 4 + p2) * 0.006 * s.length * v;
      pos.push(cx + wob, sy[i] + cn * st, sz[i] - cn * ct);
    }
  }
  return pos;
}

/**
 * The petal with a closed-to-open morph, as lib/plant makePetalGeometry: the geometry is the closed form and morph
 * target 0 the open one, so `morphTargetInfluences[0]` is how far it has opened.
 */
export function makeLotusPetalGeometry(shape: LotusPetalShape, seed: number, nu: number, nv: number): THREE.BufferGeometry {
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) uv.push(i / nu, j / nv);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + (nu + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const build = (pos: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };
  const closed = build(lotusPetalPositions(shape, seed, nu, nv, true));
  const open = build(lotusPetalPositions(shape, seed, nu, nv, false));
  closed.morphAttributes.position = [open.getAttribute("position") as THREE.BufferAttribute];
  closed.morphAttributes.normal = [open.getAttribute("normal") as THREE.BufferAttribute];
  closed.boundingSphere = open.boundingSphere;
  return closed;
}
