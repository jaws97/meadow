// Geometry for the lazy river's hard landscape and dressing (plan.ts gives every measure): the water's ring, the
// granite copings in blocks with a small arris (a bevel) and a 4 cm overhang over the water, the stone walls, the
// bridges' slabs, parapets, end posts and piers with pointed cutwaters, the lamp posts, river stones and reed clumps.
// Each repeated part is built once and either merged or instanced by its user (River.tsx). Pure three.js.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { P2 } from "@/components/meadow/layout";
import { merge, paint } from "@/components/meadow/parts";

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/** Collects triangles with per-vertex normals, uvs and colours, each face winding checked against its normal. */
class Tris {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  /** A triangle whose front face must agree with `n` (it is flipped if it does not). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, ua: number[], ub: number[], uc: number[], col: THREE.Color) {
    tmpA.subVectors(b, a);
    tmpB.subVectors(c, a);
    tmpN.crossVectors(tmpA, tmpB);
    tmpC.copy(na).add(nb).add(nc);
    if (tmpN.dot(tmpC) < 0) {
      this.push(a, na, ua, col);
      this.push(c, nc, uc, col);
      this.push(b, nb, ub, col);
    } else {
      this.push(a, na, ua, col);
      this.push(b, nb, ub, col);
      this.push(c, nc, uc, col);
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, nd: THREE.Vector3, ua: number[], ub: number[], uc: number[], ud: number[], col: THREE.Color) {
    this.tri(a, b, c, na, nb, nc, ua, ub, uc, col);
    this.tri(a, c, d, na, nc, nd, ua, uc, ud, col);
  }

  private push(p: THREE.Vector3, n: THREE.Vector3, u: number[], c: THREE.Color) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u[0], u[1]);
    this.col.push(c.r, c.g, c.b);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A profile in (radius, height) swept round the vertical axis from angle a0 to a1, with flat end caps: crisp across
 * the profile's corners, smooth along the arc. The profile runs clockwise (radius to the right, height up), so each
 * edge's outward normal is (-dy, dr). uv: metres along the arc and round the profile, over `tile`.
 */
export function sweepBlock(profile: ReadonlyArray<readonly [number, number]>, a0: number, a1: number, tile: number, color: THREE.Color, out = new Tris()): Tris {
  const rMid = profile.reduce((s, p) => s + p[0], 0) / profile.length;
  const segs = Math.max(1, Math.ceil((Math.abs(a1 - a0) * rMid) / 0.25));
  const at = (r: number, y: number, a: number) => v3(r * Math.cos(a), y, r * Math.sin(a));
  let around = 0;
  for (let i = 0; i < profile.length; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[(i + 1) % profile.length];
    const len = Math.hypot(r1 - r0, y1 - y0);
    const nr = -(y1 - y0) / len, ny = (r1 - r0) / len;
    for (let j = 0; j < segs; j++) {
      const ta = a0 + ((a1 - a0) * j) / segs;
      const tb = a0 + ((a1 - a0) * (j + 1)) / segs;
      const na = v3(nr * Math.cos(ta), ny, nr * Math.sin(ta));
      const nb = v3(nr * Math.cos(tb), ny, nr * Math.sin(tb));
      out.quad(
        at(r0, y0, ta),
        at(r1, y1, ta),
        at(r1, y1, tb),
        at(r0, y0, tb),
        na,
        na,
        nb,
        nb,
        [(ta - a0) * r0 / tile, around / tile],
        [(ta - a0) * r1 / tile, (around + len) / tile],
        [(tb - a0) * r1 / tile, (around + len) / tile],
        [(tb - a0) * r0 / tile, around / tile],
        color,
      );
    }
    around += len;
  }
  // end caps
  const contour = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, sign] of [
    [a0, -Math.sign(a1 - a0)],
    [a1, Math.sign(a1 - a0)],
  ] as const) {
    const n = v3(-Math.sin(a) * sign, 0, Math.cos(a) * sign);
    for (const [i, j, k] of faces) {
      const p = [profile[i], profile[j], profile[k]];
      out.tri(at(p[0][0], p[0][1], a), at(p[1][0], p[1][1], a), at(p[2][0], p[2][1], a), n, n, n, [p[0][0] / tile, p[0][1] / tile], [p[1][0] / tile, p[1][1] / tile], [p[2][0] / tile, p[2][1] / tile], color);
    }
  }
  return out;
}

/**
 * A coping of granite blocks, `length` metres apiece (evened out to fit), between angles a0 and a1: each block's top
 * from r0 to r1 at `top`, its base at `base`, a 2 cm arris along both top edges, a hair's joint between blocks and a
 * slightly different tone each.
 */
export function copingGeometry(stretches: ReadonlyArray<readonly [number, number]>, r0: number, r1: number, base: number, top: number, length: number, seed: number): THREE.BufferGeometry {
  const b = 0.02;
  const profile: Array<[number, number]> = [
    [r0, base],
    [r0, top - b],
    [r0 + b, top],
    [r1 - b, top],
    [r1, top - b],
    [r1, base],
  ];
  const out = new Tris();
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const rm = (r0 + r1) / 2;
  const joint = 0.006 / rm;
  for (const [a0, a1] of stretches) {
    const n = Math.max(1, Math.round((Math.abs(a1 - a0) * rm) / length));
    for (let i = 0; i < n; i++) {
      const ba = a0 + ((a1 - a0) * i) / n + joint;
      const bb = a0 + ((a1 - a0) * (i + 1)) / n - joint;
      const tone = 0.9 + rnd() * 0.16;
      sweepBlock(profile, ba, bb, 1.4, new THREE.Color(tone, tone * (0.985 + rnd() * 0.02), tone * (0.96 + rnd() * 0.03)), out);
    }
  }
  return out.geometry();
}

/** A wall face at radius r, facing `facing` (+1 outward), from y0 up to y1 all the way round: uv u in metres along over `tile`, v 0 at y0 to 1 at y1. */
export function wallGeometry(r: number, facing: 1 | -1, y0: number, y1: number, tile: number): THREE.BufferGeometry {
  const segs = Math.ceil((Math.PI * 2 * r) / 0.4);
  const out = new Tris();
  const white = new THREE.Color(1, 1, 1);
  for (let j = 0; j < segs; j++) {
    const ta = (j / segs) * Math.PI * 2;
    const tb = ((j + 1) / segs) * Math.PI * 2;
    const na = v3(Math.cos(ta) * facing, 0, Math.sin(ta) * facing);
    const nb = v3(Math.cos(tb) * facing, 0, Math.sin(tb) * facing);
    const ua = (ta * r) / tile, ub = (tb * r) / tile;
    out.quad(
      v3(r * Math.cos(ta), y0, r * Math.sin(ta)),
      v3(r * Math.cos(tb), y0, r * Math.sin(tb)),
      v3(r * Math.cos(tb), y1, r * Math.sin(tb)),
      v3(r * Math.cos(ta), y1, r * Math.sin(ta)),
      na,
      nb,
      nb,
      na,
      [ua, 0],
      [ub, 0],
      [ub, 1],
      [ua, 1],
      white,
    );
  }
  return out.geometry();
}

/** A solid prism over a plan polygon (closed, either winding) from y0 to y1, with uvs in metres over `tile`. */
export function prism(poly: readonly P2[], y0: number, y1: number, tile: number, color: THREE.Color, out = new Tris()): Tris {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.z - b.x * a.z;
  }
  const ccw = area > 0;
  const up = v3(0, 1, 0), down = v3(0, -1, 0);
  const faces = THREE.ShapeUtils.triangulateShape(
    poly.map((p) => new THREE.Vector2(p.x, p.z)),
    [],
  );
  for (const [i, j, k] of faces) {
    const a = poly[i], b = poly[j], c = poly[k];
    out.tri(v3(a.x, y1, a.z), v3(b.x, y1, b.z), v3(c.x, y1, c.z), up, up, up, [a.x / tile, a.z / tile], [b.x / tile, b.z / tile], [c.x / tile, c.z / tile], color);
    out.tri(v3(a.x, y0, a.z), v3(b.x, y0, b.z), v3(c.x, y0, c.z), down, down, down, [a.x / tile, a.z / tile], [b.x / tile, b.z / tile], [c.x / tile, c.z / tile], color);
  }
  let along = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 1e-5) continue;
    // outward: right of the edge for an anticlockwise (x, z) outline
    const s = ccw ? 1 : -1;
    const n = v3((dz / len) * s, 0, (-dx / len) * s);
    out.quad(
      v3(a.x, y0, a.z),
      v3(b.x, y0, b.z),
      v3(b.x, y1, b.z),
      v3(a.x, y1, a.z),
      n,
      n,
      n,
      n,
      [along / tile, y0 / tile],
      [(along + len) / tile, y0 / tile],
      [(along + len) / tile, y1 / tile],
      [along / tile, y1 / tile],
      color,
    );
    along += len;
  }
  return out;
}

export { Tris };

/**
 * A prism as `prism`, with a small arris (a 45-degree bevel `bevel` wide) round its top edge, as dressed granite has:
 * the bevel catches the light and keeps a slab's edge from reading as a cut in paper.
 */
export function bevelPrism(poly: readonly P2[], y0: number, y1: number, bevel: number, tile: number, color: THREE.Color, out = new Tris()): Tris {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  const inner = offsetPolygon(poly, -bevel);
  const yb = y1 - bevel;
  const up = v3(0, 1, 0), down = v3(0, -1, 0);
  const top = THREE.ShapeUtils.triangulateShape(inner.map((p) => new THREE.Vector2(p.x, p.z)), []);
  for (const [i, j, k] of top) {
    const a = inner[i], b = inner[j], c = inner[k];
    out.tri(v3(a.x, y1, a.z), v3(b.x, y1, b.z), v3(c.x, y1, c.z), up, up, up, [a.x / tile, a.z / tile], [b.x / tile, b.z / tile], [c.x / tile, c.z / tile], color);
  }
  const bottom = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p.x, p.z)), []);
  for (const [i, j, k] of bottom) {
    const a = poly[i], b = poly[j], c = poly[k];
    out.tri(v3(a.x, y0, a.z), v3(b.x, y0, b.z), v3(c.x, y0, c.z), down, down, down, [a.x / tile, a.z / tile], [b.x / tile, b.z / tile], [c.x / tile, c.z / tile], color);
  }
  let along = 0;
  for (let i = 0; i < poly.length; i++) {
    const i2 = (i + 1) % poly.length;
    const a = poly[i], b = poly[i2];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 1e-5) continue;
    const n = v3((dz / len) * s, 0, (-dx / len) * s);
    out.quad(v3(a.x, y0, a.z), v3(b.x, y0, b.z), v3(b.x, yb, b.z), v3(a.x, yb, a.z), n, n, n, n, [along / tile, y0 / tile], [(along + len) / tile, y0 / tile], [(along + len) / tile, yb / tile], [along / tile, yb / tile], color);
    const nb = v3(n.x, 1, n.z).normalize();
    const ia = inner[i], ib = inner[i2];
    out.quad(v3(a.x, yb, a.z), v3(b.x, yb, b.z), v3(ib.x, y1, ib.z), v3(ia.x, y1, ia.z), nb, nb, nb, nb, [along / tile, yb / tile], [(along + len) / tile, yb / tile], [(along + len) / tile, y1 / tile], [along / tile, y1 / tile], color);
    along += len;
  }
  return out;
}

/** Offsets a closed polygon outward by d (a mitred offset; fine for the bridges' gentle corners). */
export function offsetPolygon(poly: readonly P2[], d: number): P2[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  const n = poly.length;
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    const e1 = { x: p.x - prev.x, z: p.z - prev.z }, e2 = { x: next.x - p.x, z: next.z - p.z };
    const l1 = Math.hypot(e1.x, e1.z) || 1, l2 = Math.hypot(e2.x, e2.z) || 1;
    const n1 = { x: (e1.z / l1) * s, z: (-e1.x / l1) * s }, n2 = { x: (e2.z / l2) * s, z: (-e2.x / l2) * s };
    const m = { x: n1.x + n2.x, z: n1.z + n2.z };
    const ml = Math.hypot(m.x, m.z) || 1;
    const cos = (m.x / ml) * n1.x + (m.z / ml) * n1.z;
    const k = d / Math.max(0.3, cos);
    return { x: p.x + (m.x / ml) * k, z: p.z + (m.z / ml) * k };
  });
}

// ---- the lamp posts ---------------------------------------------------------------------------------------------------

const IRON = "#3b3631";
const LAMP_GLOW = "#ffc77e";

/**
 * A bridge lamp, 2.2 m from the paving to its finial, standing on its parapet end post (whose top is at `foot`): an
 * iron post with a collar, a six-sided glass lantern with a warm flame, a little roof and finial, the Meadow's plaza
 * lantern drawn taller. Painted, with a glow weight on the glass.
 */
export function lampGeometry(foot: number, height: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = height;
  const base = new THREE.CylinderGeometry(0.075, 0.09, 0.08, 8);
  base.translate(0, foot + 0.04, 0);
  parts.push(paint(base, IRON));
  const postTop = top - 0.36;
  const post = new THREE.CylinderGeometry(0.032, 0.042, postTop - foot - 0.08, 8);
  post.translate(0, (foot + 0.08 + postTop) / 2, 0);
  parts.push(paint(post, IRON));
  const ring = new THREE.TorusGeometry(0.04, 0.008, 4, 10);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, foot + 0.45, 0);
  parts.push(paint(ring, IRON));
  const collar = new THREE.CylinderGeometry(0.075, 0.06, 0.04, 6);
  collar.translate(0, postTop + 0.02, 0);
  parts.push(paint(collar, IRON));
  const glass = new THREE.CylinderGeometry(0.095, 0.075, 0.22, 6);
  glass.translate(0, postTop + 0.15, 0);
  parts.push(paint(glass, LAMP_GLOW, 1));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bar = new THREE.BoxGeometry(0.012, 0.23, 0.012);
    bar.translate(Math.cos(a) * 0.088, postTop + 0.15, Math.sin(a) * 0.088);
    parts.push(paint(bar, IRON));
  }
  const roof = new THREE.ConeGeometry(0.135, 0.11, 6);
  roof.translate(0, postTop + 0.315, 0);
  parts.push(paint(roof, IRON));
  const finial = new THREE.SphereGeometry(0.024, 8, 5);
  finial.translate(0, top - 0.012, 0);
  parts.push(paint(finial, IRON));
  return merge(parts);
}

// ---- stones and reeds ------------------------------------------------------------------------------------------------

/** A river stone: a lumpy, slightly flattened rounded rock of unit size, smooth-shaded. */
export function rockGeometry(seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const merged = mergeVertices(g);
  g.dispose();
  const p = merged.attributes.position as THREE.BufferAttribute;
  const k = seed * 1.7;
  for (let i = 0; i < p.count; i++) {
    tmpA.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const n =
      1 +
      0.16 * Math.sin(tmpA.x * 2.3 + k) * Math.cos(tmpA.z * 2.1 - k * 0.7) +
      0.1 * Math.sin(tmpA.y * 3.7 + k * 1.3) +
      0.05 * Math.sin((tmpA.x + tmpA.z) * 6.1 + k);
    // rounded on top, flatter underneath, as water-worn stones lie
    const y = tmpA.y < 0 ? tmpA.y * 0.55 : tmpA.y;
    p.setXYZ(i, tmpA.x * n, y * n * 0.72, tmpA.z * n * (0.85 + 0.1 * Math.sin(k)));
  }
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * A clump of slender reeds rising from the wall's ledge: near-upright blades with a gentle arch, dark at the base,
 * green through the middle and straw at the tips; uv.y runs up each blade (the margins' sway reads it). The clump's
 * foot is at the origin; blades fan within about 0.18 m.
 */
export function reedClumpGeometry(blades: number, height: number, seed: number, segments: number): THREE.BufferGeometry {
  let s = seed * 7919 + 13;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const dark = new THREE.Color("#2e4424");
  const mid = new THREE.Color("#5c7e3a");
  const tip = new THREE.Color("#b9b06a");
  const c = new THREE.Color();
  for (let k = 0; k < blades; k++) {
    const yaw = rnd() * Math.PI * 2;
    const h = height * (0.62 + 0.38 * rnd());
    const lean = 0.06 + 0.22 * rnd();
    const w0 = 0.007 + 0.005 * rnd();
    const r = Math.sqrt(rnd()) * 0.12;
    const ox = Math.cos(yaw) * r, oz = Math.sin(yaw) * r;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const start = pos.length / 3;
    const tint = 0.85 + 0.3 * rnd();
    const straw = rnd() < 0.3;
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const out = lean * h * t * t;
      const up = h * (t - 0.18 * lean * t * t * t);
      const w = w0 * (1 - 0.95 * Math.pow(t, 1.6));
      for (const side of [-1, 1]) {
        pos.push(ox + cy * out - sy * w * side, up, oz + sy * out + cy * w * side);
        uv.push((side + 1) / 2, t);
        if (t < 0.45) c.copy(dark).lerp(mid, t / 0.45);
        else c.copy(mid).lerp(tip, Math.pow((t - 0.45) / 0.55, straw ? 0.8 : 1.8));
        c.multiplyScalar(tint);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < segments; j++) {
      const a = start + j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Merges geometries that share attributes (inputs disposed). */
export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("river: parts could not be merged");
  g.computeBoundingSphere();
  return g;
}
