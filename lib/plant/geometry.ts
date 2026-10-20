// Procedural botanical geometry. Petals and leaves are parametric surfaces:
// a width profile along the length, then cupping, rolling, recurve, the
// reflexed lip and undulating margins layered on top. Every petal carries a
// second, "bud" shape as a morph target so the same mesh wraps tight in the
// bud and unfurls into the open form as the bloom opens. Stems are tapered
// tubes along a gentle bezier.
import * as THREE from "three";
import { lerp, smoothstep, vnoise2 } from "./prng";

export interface PetalShape {
  length: number;
  width: number;
  bend: number;
  cup: number;
  ruffle: number;
  tip: number;
  twist?: number;
  roll?: number;
  lip?: number;
}

export interface LeafShape {
  length: number;
  width: number;
  serration: number;
  fold: number;
  tip?: number;
}

function gridIndices(nu: number, nv: number, idx: number[]) {
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + (nu + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
}

function buildGeometry(pos: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Where the petal is widest along its length. */
const PEAK = 0.62;
/** Where the reflexed lip starts to curl back. */
const LIP_START = 0.58;
/** Full curl of the lip at the tip, radians, for lip = 1: the tip folds right back. */
const LIP_CURL = 2.7;

/** Broad and rounded, widest two thirds of the way up, with a faint point. */
function petalWidth(v: number, tip: number): number {
  if (v < PEAK) {
    const s = v / PEAK;
    return 0.3 + 0.7 * Math.pow(Math.sin((s * Math.PI) / 2), 0.9);
  }
  const s = (v - PEAK) / (1 - PEAK);
  return Math.max(0.015, Math.pow(Math.cos((s * Math.PI) / 2), lerp(0.55, 1.5, tip)));
}

/**
 * Tangent angle of the petal's spine, from +y toward +z (outward), at `v`
 * along the column `au` = |u| from the midline. A gentle recurve runs the
 * whole blade; the lip's curl starts at LIP_START and tightens toward the
 * tip, the corners a little harder than the middle so the tip keeps a point.
 */
function spineAngle(v: number, bend: number, lip: number, au: number): number {
  let a = bend * 1.15 * Math.pow(v, 1.6);
  if (lip > 0 && v > LIP_START) {
    const s = (v - LIP_START) / (1 - LIP_START);
    a += lip * LIP_CURL * Math.pow(s, 1.4) * (0.72 + 0.28 * Math.pow(au, 1.5));
  }
  return a;
}

/**
 * Positions of one petal surface. `relax` = 1 gives the bud form: no lip,
 * barely any recurve or ruffle, tighter cupping; 0 gives the open bloom.
 *
 * Each column of vertices follows its own spine, integrated up the blade from
 * the tangent angle, and the cross-section (cupping, rolling, ruffle, twist)
 * is laid out in that spine's moving frame. Curling is therefore a smooth
 * roll with no crease, and the base row always sits flat at the origin.
 */
function petalPositions(shape: PetalShape, seed: number, nu: number, nv: number, relax: number): number[] {
  const { length, width, tip } = shape;
  const bend = shape.bend * (1 - 0.75 * relax);
  const ruffle = shape.ruffle * (1 - 0.7 * relax);
  const lip = (shape.lip ?? 0) * (1 - 0.9 * relax);
  const twist = (shape.twist ?? 0) * (1 - 0.3 * relax);
  const roll = Math.min(1, (shape.roll ?? 0) + 0.12 * relax);
  const cup = shape.cup * (1 + 0.3 * relax);
  const p1 = (seed * 1.37) % 6.283;
  const p2 = (seed * 2.71) % 6.283;
  const pos: number[] = [];
  const dv = 1 / nv;
  // running spine position per column
  const sy = new Float64Array(nu + 1);
  const sz = new Float64Array(nu + 1);

  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const halfW = (width / 2) * petalWidth(v, tip);
    // Reflexed petals also roll their margins back toward the tip, so the
    // cupping fades out and reverses where the lip curls.
    const cupV = cup * (1 - roll) * (1 - 1.5 * lip * smoothstep(0.4, 1, v)) * (0.75 + 0.25 * (1 - v));
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      const au = Math.abs(u);
      const theta = spineAngle(v, bend, lip, au);
      if (j > 0) {
        const mid = 0.5 * (theta + spineAngle(v - dv, bend, lip, au));
        sy[i] += Math.cos(mid) * length * dv;
        sz[i] += Math.sin(mid) * length * dv;
      }
      // cross-section: cx across the blade, cn toward the inner face
      let cx = u * halfW;
      let cn = cupV * halfW * 0.9 * u * u;
      if (roll > 0) {
        const thr = roll * Math.PI * (0.5 + 0.5 * v);
        const r = halfW / thr;
        cx = r * Math.sin(u * thr);
        cn += r * (1 - Math.cos(u * thr));
      }
      const edge = Math.pow(au, 1.6);
      cn -=
        ruffle *
        length *
        0.035 *
        (Math.sin(v * 9 + u * 2.5 + p1) * 0.6 + Math.sin(v * 16 - u * 4 + p2) * 0.4) *
        (0.15 + 0.85 * edge) *
        (0.15 + 0.85 * v);
      cx += Math.sin(v * 5 + p2) * 0.012 * length * v;
      if (twist) {
        const a = twist * v;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const tx = cx * ca + cn * sa;
        const tn = -cx * sa + cn * ca;
        cx = tx;
        cn = tn;
      }
      // frame of the spine: tangent (0, cos, sin), inner normal (0, sin, -cos)
      const st = Math.sin(theta);
      const ct = Math.cos(theta);
      pos.push(cx, sy[i] + cn * st, sz[i] - cn * ct);
    }
  }
  return pos;
}

/**
 * Petal in local space: base at the origin, grows along +y, inner face toward -z.
 * Opening the flower rotates the petal about x so the tip travels outward (+z).
 * The geometry's own vertices are the bud form; morph target 0 is the open
 * bloom, so `morphTargetInfluences[0]` is how far the petal has unfurled.
 */
export function makePetalGeometry(shape: PetalShape, seed = 0, nu = 16, nv = 28): THREE.BufferGeometry {
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) uv.push(i / nu, j / nv);
  gridIndices(nu, nv, idx);

  const open = buildGeometry(petalPositions(shape, seed, nu, nv, 0), uv, idx);
  const bud = buildGeometry(petalPositions(shape, seed, nu, nv, 1), uv, idx);
  bud.morphAttributes.position = [open.getAttribute("position") as THREE.BufferAttribute];
  bud.morphAttributes.normal = [open.getAttribute("normal") as THREE.BufferAttribute];
  // The open form is the larger of the two; cull against it.
  bud.boundingSphere = open.boundingSphere;
  return bud;
}

/**
 * Leaf blade in local space: base at the origin, grows along +y, upper face toward +z.
 * Edges fold up, the tip bends down, serration cuts saw teeth into the margin.
 */
export function makeLeafGeometry(shape: LeafShape, seed = 0, nu = 10, nv = 18): THREE.BufferGeometry {
  const { length, width, serration, fold } = shape;
  const tip = shape.tip ?? 0.6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const teeth = 14;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const ovate = Math.pow(Math.sin(Math.PI * Math.pow(v, 0.72)), 0.85);
    const round = Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.5) / 0.5, 2)));
    const w = Math.max(0.02, lerp(round, ovate, tip));
    const halfW = (width / 2) * w;
    // Teeth lean toward the tip: a slow rise to the point, a quick drop.
    const f = (v * teeth + seed * 0.37) % 1;
    const saw = f < 0.68 ? 1 - f / 0.68 : (f - 0.68) / 0.32;
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      const edgeMask = smoothstep(0.55, 1, Math.abs(u));
      const notch = serration * 0.11 * saw * edgeMask * smoothstep(0.04, 0.22, v) * (1 - smoothstep(0.9, 1, v));
      const x = u * halfW * (1 - notch);
      const y = v * length;
      let z = fold * halfW * Math.pow(Math.abs(u), 1.3);
      z -= 0.2 * length * v * v;
      z += 0.015 * length * Math.sin(v * 9 + u * 2 + seed) * v;
      pos.push(x, y, z);
      uv.push(i / nu, v);
    }
  }
  gridIndices(nu, nv, idx);
  return buildGeometry(pos, uv, idx);
}

/**
 * Sepal: a narrow lance, base at the origin along +y, inner face toward -z,
 * folded along its midrib with the tip peeling outward (+z).
 */
export function makeSepalGeometry(length: number, width: number, seed = 0, nu = 6, nv = 14): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const w = Math.max(0.03, Math.pow(Math.sin(Math.PI * Math.pow(v, 0.6)), 0.7) * (0.55 + 0.45 * smoothstep(0, 0.3, v)));
    const halfW = (width / 2) * w;
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      const x = u * halfW;
      const y = v * length;
      let z = -0.5 * halfW * u * u;
      z += 0.3 * length * Math.pow(v, 2.5);
      z += 0.01 * length * Math.sin(v * 7 + seed) * v;
      pos.push(x, y, z);
      uv.push(i / nu, v);
    }
  }
  gridIndices(nu, nv, idx);
  return buildGeometry(pos, uv, idx);
}

/**
 * Unit thorn: base ring at the origin, length 1 along +y, hooking toward +z,
 * base radius 0.36 with a broad flared foot. Scale it to size and aim it
 * with the mesh transform.
 */
export function makeThornGeometry(radial = 8, rings = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const cy = t;
    const cz = 0.5 * t * t;
    const r = 0.36 * Math.pow(1 - t, 1.15) + 0.005;
    // tangent (0, 1, t); binormal in the y-z plane
    const ty = 1;
    const tz = t;
    const tl = Math.hypot(ty, tz);
    const by = tz / tl;
    const bz = -ty / tl;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(r * ca, cy + r * sa * by, cz + r * sa * bz);
      uv.push(i / radial, t);
    }
  }
  gridIndices(radial, rings, idx);
  return buildGeometry(pos, uv, idx);
}

/**
 * Receptacle: the urn-shaped hypanthium the petals and sepals grow from,
 * narrow at the stem, swelling to a bulb, pinched at the neck and flaring to
 * the rim at y = height where the petals attach. Base at the origin.
 */
/**
 * Where a flower's receptacle and calyx sit in its head (the petals' bases at the origin): the urn just under the
 * petals with the sepals round its rim, or for a flower with a corolla tube (a jasmine's), the slender tube the petals
 * spread from with the calyx at its foot.
 */
export function receptacleShape(f: { center: { radius: number }; tube?: { radius: number; length: number } }): {
  radius: number;
  height: number;
  y: number;
  sepalY: number;
  sepalR: number;
} {
  const cr = f.center.radius;
  if (!f.tube) return { radius: cr * 1.25, height: cr * 2.1, y: -cr * 2.0, sepalY: -cr * 0.25, sepalR: cr * 0.95 };
  const foot = cr * 0.1 - f.tube.length;
  return { radius: f.tube.radius, height: f.tube.length, y: foot, sepalY: foot + f.tube.length * 0.12, sepalR: f.tube.radius * 1.1 };
}

export function makeReceptacleGeometry(radius: number, height: number, seed = 0): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0.42, 0],
    [0.72, 0.14],
    [0.95, 0.36],
    [1.0, 0.56],
    [0.9, 0.76],
    [0.82, 0.88],
    [0.9, 0.96],
    [0.98, 1.0],
    [0.3, 1.0],
    [0, 1.0],
  ];
  const points = profile.map(([r, y]) => new THREE.Vector2(r * radius, y * height));
  const g = new THREE.LatheGeometry(points, 24);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    // five shallow ribs, one behind each sepal, and a little grain
    const rib = 1 + 0.04 * Math.cos(a * 5 + seed) + 0.015 * vnoise2(a * 2 + seed, p.getY(i) * 40);
    p.setX(i, x * rib);
    p.setZ(i, z * rib);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function stemCurve(length: number, dx: number, dz: number): THREE.QuadraticBezierCurve3 {
  return new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(dx * 0.25, length * 0.5, dz * 0.25),
    new THREE.Vector3(dx, length, dz),
  );
}

/** Tapered tube from the origin to (dx, length, dz). */
export function makeStemGeometry(
  length: number,
  r0: number,
  r1: number,
  dx: number,
  dz: number,
  tubular = 12,
  radial = 10,
): THREE.BufferGeometry {
  const curve = stemCurve(length, dx, dz);
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const p = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const sin = Math.sin(a);
      const cos = -Math.cos(a);
      const nx = cos * N.x + sin * B.x;
      const ny = cos * N.y + sin * B.y;
      const nz = cos * N.z + sin * B.z;
      pos.push(p.x + r * nx, p.y + r * ny, p.z + r * nz);
      nor.push(nx, ny, nz);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, b, d, b, c, d);
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

/** Where the next segment attaches, and how it is oriented, in this segment's local frame. */
export function stemEndTransform(length: number, dx: number, dz: number) {
  const curve = stemCurve(length, dx, dz);
  const position = curve.getPoint(1);
  const tangent = curve.getTangent(1).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  return { position, quaternion };
}

/** Point and orientation at fraction t along a segment, for leaf attachment. */
export function stemPointAt(length: number, dx: number, dz: number, t: number) {
  const curve = stemCurve(length, dx, dz);
  const position = curve.getPoint(t);
  const tangent = curve.getTangent(t).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  return { position, quaternion };
}

/** A lumpy mound of soil, radius in metres. */
export function makeSoilGeometry(radius = 0.32, height = 0.07, seed = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = vnoise2(x * 9 + seed, z * 9 - seed);
    const n2 = vnoise2(x * 40 + seed * 2, z * 40);
    const ny = y * (height / radius) * (1 + 0.25 * n) + 0.004 * n2;
    p.setY(i, Math.max(0, ny));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** One grass blade, base at the origin, tapering to the tip, slightly bowed. */
export function makeGrassBladeGeometry(height = 0.14, width = 0.012): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 1, 5);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / height;
    p.setX(i, p.getX(i) * (1 - t * 0.9));
    p.setZ(i, t * t * 0.03);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
