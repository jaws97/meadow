// The courtyard's plants, pure three.js (no DOM), all original geometry:
// - a banana clump: pseudostems of rolled leaf sheaths, broad paddle leaves on short stalks that rise and arch over,
//   their blades torn into strips along the veins by the wind (the young leaves whole, the old ones ragged), and a
//   dry leaf or two hanging brown against the stem;
// - areca palms: slender ringed trunks with a smooth green crownshaft, and a crown of arching pinnate fronds;
// - a jasmine trained on a cane trellis against the wall: small glossy leaves, starry white flowers and buds.
// Positions are world metres (plan.ts); uv and vertex colour as each material wants.
import * as THREE from "three";
import { Rng, smoothstep } from "@/lib/plant/prng";
import type { Tier } from "@/components/lotus/geometry";
import { ARECAS, BANANA, COURT, JASMINE, LEVEL } from "@/components/lotus/courtyard/plan";

/** A growing mesh: positions, uv, colour and indices pushed in, built once. */
class Mesh {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  v(p: THREE.Vector3, u: number, w: number, c: THREE.Color) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, w);
    this.col.push(c.r, c.g, c.b);
  }
  grid(start: number, cols: number, rows: number) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = start + j * (cols + 1) + i;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** A tapering tube along a curve: rings of `radial` sides, radius from r0 to r1; uv u round, v = metres along / vScale. */
function tube(m: Mesh, curve: THREE.Curve<THREE.Vector3>, rows: number, radial: number, r0: number, r1: number, vScale: number, colour: (t: number, out: THREE.Color) => void) {
  const start = m.count;
  const frames = curve.computeFrenetFrames(rows, false);
  const len = curve.getLength();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * t;
    colour(t, c);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      n.copy(frames.normals[j]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[j], Math.sin(a));
      m.v(p.clone().addScaledVector(n, r), i / radial, (t * len) / vScale, c);
    }
  }
  m.grid(start, radial, rows);
}

// ---------------------------------------------------------------------------------------------------------------------
// Banana

export interface BananaGeometry {
  stems: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

interface LeafSpec {
  base: THREE.Vector3;
  yaw: number;
  /** the midrib's rise at the stalk, radians over horizontal */
  pitch: number;
  length: number;
  width: number;
  /** how far the blade has arched over at its tip (0 young and upright .. 1 old, drooping) */
  age: number;
  /** tears along each half */
  tears: number;
  /** a dry hanging leaf */
  dry: boolean;
}

/**
 * One banana leaf (stalk and blade). The midrib rises from the stalk at `pitch`, arching over with age; each half of
 * the blade hangs a little from the midrib and is cut by tears running out along the veins (toward the tip, at a
 * slant), each strip drooping on its own. u runs across the blade (0 one margin, 0.5 the midrib, 1 the other), v
 * along it.
 */
function bananaLeaf(m: Mesh, s: LeafSpec, rng: Rng, segs: number, across: number) {
  const dirH = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
  const side = new THREE.Vector3().crossVectors(UP, dirH).normalize();
  const stalk = 0.22 + 0.1 * rng.next();
  // the midrib as a function of t (0 the blade's base .. 1 its tip)
  const mid = (t: number, out: THREE.Vector3) => {
    if (s.dry) {
      // hanging: down along the stem from where it broke
      const d = t * s.length;
      out.copy(s.base).addScaledVector(dirH, 0.12 + 0.05 * Math.sin(t * 3)).addScaledVector(UP, -d * 0.95);
      return out;
    }
    const d = stalk + t * s.length;
    const rise = Math.tan(s.pitch);
    // a parabola that starts at the pitch and bends over by its age
    const y = d * rise * (1 - t * (0.35 + 0.95 * s.age)) - s.age * 0.35 * s.length * t * t;
    const h = d * (1 - 0.18 * s.age * t);
    return out.copy(s.base).addScaledVector(dirH, h * Math.cos(Math.atan(rise) * 0.3)).addScaledVector(UP, y);
  };
  const cGreen = new THREE.Color(1, 1, 1);
  const cDry = new THREE.Color(0.78, 0.6, 0.38);
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const t3 = new THREE.Vector3();
  const tint = s.dry ? cDry : cGreen.clone().multiplyScalar(0.9 + 0.15 * rng.next()).lerp(new THREE.Color(1.05, 1.0, 0.7), 0.25 * s.age);
  // the stalk: a short, slightly channelled green tube from the stem's top to the blade
  if (!s.dry) {
    const pts = [s.base.clone(), s.base.clone().addScaledVector(dirH, stalk * 0.5).addScaledVector(UP, stalk * 0.5 * Math.tan(s.pitch)), mid(0, new THREE.Vector3())];
    tube(m, new THREE.CatmullRomCurve3(pts), 4, 6, 0.018, 0.012, 1, (_t, out) => out.setRGB(0.62, 0.7, 0.42));
  }
  // the tears' positions along each half (at the midrib), sorted
  for (const half of [-1, 1]) {
    const cuts = [0];
    for (let i = 0; i < s.tears; i++) cuts.push(0.12 + 0.86 * rng.next());
    cuts.push(1.0001);
    cuts.sort((a, b) => a - b);
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k];
      const t1 = cuts[k + 1];
      const span = Math.max(1, Math.round((t1 - t0) * segs));
      const droop = (k === 0 ? 0.1 : 0.25 + 0.5 * rng.next()) * (0.4 + s.age);
      const start = m.count;
      for (let j = 0; j <= span; j++) {
        const tm = t0 + (t1 - t0) * (j / span) + (j === span && k < cuts.length - 2 ? -0.004 : 0) + (j === 0 && k > 0 ? 0.004 : 0);
        for (let i = 0; i <= across; i++) {
          const v = i / across;
          // the vein runs out toward the tip: the margin end of a strip sits further along than its midrib end
          const t = Math.min(1, tm + 0.12 * v * (1 - tm));
          mid(t, p);
          // the midrib's local frame
          mid(Math.min(1, t + 0.01), q);
          t3.subVectors(q, p).normalize();
          const out = new THREE.Vector3().crossVectors(t3, UP).normalize().multiplyScalar(-half);
          if (out.lengthSq() < 0.5) out.copy(side).multiplyScalar(half);
          const down = new THREE.Vector3().crossVectors(out, t3).normalize().multiplyScalar(half);
          const shape = Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.98)), 0.55) * (1 - 0.15 * t);
          const w = s.width * 0.5 * shape * v;
          // each half hangs from the midrib, more toward the margin, and the torn strips more again
          const hang = (0.22 + droop) * v * v + 0.05 * v;
          const pt = p.clone().addScaledVector(out, w * Math.cos(hang)).addScaledVector(down, w * Math.sin(hang) * (s.dry ? 0.3 : 1));
          m.v(pt, 0.5 + half * 0.5 * v, t, tint);
        }
      }
      m.grid(start, across, span);
    }
  }
}

/** The banana clump (plan.ts BANANA): three pseudostems of different ages and their leaves. */
export function makeBanana(tier: Tier): BananaGeometry {
  const rng = new Rng(2211);
  const stems = new Mesh();
  const leaves = new Mesh();
  const lite = tier === "lite";
  const segs = lite ? 9 : tier === "balanced" ? 12 : 16;
  const across = lite ? 2 : 4;
  const plants = [
    { dx: 0.0, dz: 0.0, h: 2.0, r: 0.105, leaves: lite ? 6 : 9, lean: 0.06 },
    { dx: 0.32, dz: 0.22, h: 1.45, r: 0.08, leaves: lite ? 4 : 7, lean: 0.12 },
    { dx: -0.18, dz: 0.34, h: 0.95, r: 0.06, leaves: lite ? 0 : 5, lean: 0.16 },
  ].slice(0, lite ? 2 : BANANA.stems);
  for (const pl of plants) {
    const x = BANANA.x + pl.dx;
    const z = BANANA.z + pl.dz;
    const y0 = LEVEL.terrace - 0.02;
    // lean toward the court (+x, +z)
    const lx = pl.lean * 0.8;
    const lz = pl.lean * 0.6;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, y0, z),
      new THREE.Vector3(x + lx * 0.3, y0 + pl.h * 0.5, z + lz * 0.3),
      new THREE.Vector3(x + lx, y0 + pl.h, z + lz),
    ]);
    tube(stems, curve, lite ? 4 : 8, lite ? 8 : 14, pl.r, pl.r * 0.62, 1.0, (t, out) => out.setScalar(0.92 + 0.08 * t));
    const top = new THREE.Vector3(x + lx, y0 + pl.h, z + lz);
    for (let i = 0; i < pl.leaves; i++) {
      const age = i / Math.max(1, pl.leaves - 1);
      // the youngest leaf rises steeply from the centre; older ones open out round the stem and arch over, their tips
      // hanging (a banana leaf is a broad paddle on a short stalk; held near upright it read as a green horn from the pond)
      const yaw = 0.9 + i * 2.39 + (rng.next() - 0.5) * 0.4;
      const L = (1.0 + 0.5 * rng.next()) * (pl.h / 2.0) * 1.25 + 0.3;
      bananaLeaf(
        leaves,
        {
          base: top.clone().addScaledVector(UP, -0.04 * i),
          yaw,
          pitch: 1.0 - 0.62 * age,
          length: L,
          width: L * 0.38,
          age: Math.min(1, 0.45 + age * 0.6),
          tears: Math.round((0.25 + age) * (lite ? 3 : 8) * (0.6 + 0.4 * rng.next())),
          dry: false,
        },
        rng,
        segs,
        across,
      );
    }
    if (!lite) {
      // a dry leaf hanging from the old stem
      bananaLeaf(
        leaves,
        { base: top.clone().addScaledVector(UP, -0.18), yaw: 2.6 + rng.next(), pitch: 0, length: pl.h * 0.5, width: 0.2, age: 1, tears: 3, dry: true },
        rng,
        Math.max(4, segs >> 1),
        2,
      );
    }
  }
  return { stems: stems.build(), leaves: leaves.build() };
}

// ---------------------------------------------------------------------------------------------------------------------
// Areca

export interface ArecaGeometry {
  trunks: THREE.BufferGeometry;
  crowns: THREE.BufferGeometry;
}

/** The areca palms (plan.ts ARECAS): ringed trunks, green crownshafts, and crowns of arching pinnate fronds. */
export function makeArecas(tier: Tier): ArecaGeometry {
  const rng = new Rng(4409);
  const trunks = new Mesh();
  const crowns = new Mesh();
  const lite = tier === "lite";
  const fronds = lite ? 6 : tier === "balanced" ? 7 : 9;
  const pairs = lite ? 16 : tier === "balanced" ? 26 : 34;
  const leafSegs = lite ? 1 : 2;
  const list = lite ? ARECAS.slice(0, 2) : ARECAS;
  const c = new THREE.Color();
  for (const a of list) {
    const y0 = LEVEL.terrace - 0.02;
    const lean = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(a.lean * a.h);
    const top = new THREE.Vector3(a.x, y0 + a.h, a.z).add(lean);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(a.x, y0, a.z),
      new THREE.Vector3(a.x, y0 + a.h * 0.5, a.z).addScaledVector(lean, 0.35),
      top.clone().addScaledVector(UP, -0.85),
    ]);
    tube(trunks, curve, lite ? 6 : 12, lite ? 7 : 10, 0.085, 0.066, 2.0, (t, out) => out.setScalar(0.95 + 0.05 * t));
    // the crownshaft: smooth, glossy green, a little swollen
    const shaft = new THREE.CatmullRomCurve3([top.clone().addScaledVector(UP, -0.86), top.clone().addScaledVector(UP, -0.4), top.clone()]);
    tube(crowns, shaft, 4, lite ? 7 : 10, 0.072, 0.06, 1, (t, out) => out.setRGB(0.32 + 0.06 * t, 0.46 + 0.04 * t, 0.2));
    for (let f = 0; f < fronds; f++) {
      const yaw = (f / fronds) * Math.PI * 2 + rng.next() * 0.5;
      const old = f % 3 === 0 ? 1 : 0;
      const pitch = 0.9 - 0.55 * (old ? 1 : rng.next() * 0.6);
      const L = 1.7 + 0.5 * rng.next();
      const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const d = t * L;
        const y = d * Math.tan(pitch) * (1 - t * 0.9) - 0.55 * L * t * t * (0.6 + 0.5 * old);
        pts.push(top.clone().addScaledVector(dir, d * 0.92).addScaledVector(UP, y));
      }
      const rach = new THREE.CatmullRomCurve3(pts);
      tube(crowns, rach, lite ? 4 : 8, 3, 0.014, 0.004, 1, (_t, out) => out.setRGB(0.48, 0.52, 0.28));
      const side = new THREE.Vector3().crossVectors(UP, dir).normalize();
      const p = new THREE.Vector3();
      const tng = new THREE.Vector3();
      for (let k = 0; k < pairs; k++) {
        const t = 0.12 + 0.86 * (k / (pairs - 1));
        rach.getPointAt(t, p);
        rach.getTangentAt(t, tng);
        const len = 0.5 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9)) + 0.08;
        for (const s of [-1, 1]) {
          // each leaflet points out and forward, drooping under its weight
          const out = side.clone().multiplyScalar(s).multiplyScalar(0.75).addScaledVector(tng, 0.55).normalize();
          const droop = 0.45 + 0.4 * rng.next();
          const start = crowns.count;
          for (let j = 0; j <= leafSegs; j++) {
            const u = j / leafSegs;
            const w = 0.022 * Math.sin(Math.PI * Math.min(1, 0.25 + u * 0.75));
            const pt = p.clone().addScaledVector(out, len * u).addScaledVector(UP, -droop * len * u * u * 0.6);
            const across = new THREE.Vector3().crossVectors(out, UP).normalize();
            const yellow = smoothstep(0.6, 1, u) * 0.25 + 0.35 * old;
            c.setRGB(0.27 + 0.3 * yellow, 0.42 + 0.12 * yellow, 0.16).multiplyScalar(0.9 + 0.2 * rng.next());
            crowns.v(pt.clone().addScaledVector(across, w), u, 0, c);
            crowns.v(pt.clone().addScaledVector(across, -w).addScaledVector(UP, 0.006), u, 1, c);
          }
          crowns.grid(start, 1, leafSegs);
        }
      }
    }
  }
  return { trunks: trunks.build(), crowns: crowns.build() };
}

// ---------------------------------------------------------------------------------------------------------------------
// Jasmine

export interface JasmineGeometry {
  leaves: THREE.BufferGeometry;
  flowers: THREE.BufferGeometry;
  canes: THREE.BufferGeometry;
}

/**
 * Jasmine (Jasminum sambac, the Mysore mallige) trained against the wall beside the niche on a trellis of canes: a
 * mound of small glossy oval leaves in pairs, starry white flowers of seven to nine petals and slim white buds, a few
 * of them open (November is past its main flush, so they are sparse).
 */
export function makeJasmine(tier: Tier): JasmineGeometry {
  const rng = new Rng(808);
  const leaves = new Mesh();
  const flowers = new Mesh();
  const lite = tier === "lite";
  const nLeaves = lite ? 320 : tier === "balanced" ? 620 : 900;
  const cx = JASMINE.x;
  const cy = LEVEL.terrace + JASMINE.h * 0.52;
  const cz = COURT.zBack + 0.05;
  const rx = JASMINE.w / 2;
  const ry = JASMINE.h / 2;
  const rz = 0.3;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tng = new THREE.Vector3();
  const bit = new THREE.Vector3();
  const col = new THREE.Color();
  const shellPoint = (out: THREE.Vector3, nrm: THREE.Vector3, depth: number) => {
    // a half-ellipsoid against the wall, a little fuller low down
    let a = 0;
    let b = 0;
    do {
      a = rng.next() * Math.PI * 2;
      b = Math.acos(2 * rng.next() - 1);
    } while (Math.cos(b) < -0.1 && rng.next() < 0.7);
    const sx = Math.sin(b) * Math.cos(a);
    const sy = Math.cos(b);
    const sz = Math.abs(Math.sin(b) * Math.sin(a));
    const k = depth;
    out.set(cx + sx * rx * k, cy + sy * ry * k * (sy < 0 ? 1.05 : 1), cz + sz * rz * k);
    nrm.set(sx / rx, sy / ry, sz / rz).normalize();
  };
  for (let i = 0; i < nLeaves; i++) {
    shellPoint(p, n, 0.72 + 0.3 * rng.next());
    if (p.y < LEVEL.terrace + 0.03) p.y = LEVEL.terrace + 0.03 + rng.next() * 0.05;
    // the leaf's own frame: facing out (with scatter), its tip pointing out and down a little
    n.x += (rng.next() - 0.5) * 0.9;
    n.y += (rng.next() - 0.5) * 0.9 + 0.35;
    n.z += (rng.next() - 0.5) * 0.9;
    n.normalize();
    tng.set(rng.next() - 0.5, -0.4 - rng.next() * 0.4, rng.next() - 0.5).addScaledVector(n, 0.3);
    tng.addScaledVector(n, -tng.dot(n)).normalize();
    bit.crossVectors(n, tng).normalize();
    const L = 0.042 + 0.026 * rng.next();
    const W = L * (0.48 + 0.12 * rng.next());
    const young = rng.next() < 0.18 ? 1 : 0;
    col.setRGB(0.18 + 0.14 * young, 0.32 + 0.16 * young, 0.13 + 0.04 * young).multiplyScalar(0.85 + 0.3 * rng.next());
    const start = leaves.count;
    // an oval: base, two pairs of side points, tip; folded a touch along the midrib
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [0.3, 0.5, 0.012],
      [0.68, 0.46, 0.006],
      [1, 0, 0],
      [0.68, -0.46, 0.006],
      [0.3, -0.5, 0.012],
    ];
    for (const [a, b2, f] of pts) {
      leaves.v(p.clone().addScaledVector(tng, a * L).addScaledVector(bit, b2 * W).addScaledVector(n, f * L * 3 - Math.abs(b2) * 0.004), a, b2 * 0.5 + 0.5, col);
    }
    leaves.idx.push(start, start + 1, start + 5, start + 1, start + 2, start + 5, start + 2, start + 4, start + 5, start + 2, start + 3, start + 4);
  }
  // flowers and buds on the outside of the mound
  const nFlowers = lite ? 16 : 38;
  const nBuds = lite ? 10 : 28;
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < nFlowers + nBuds; i++) {
    shellPoint(p, n, 1.0 + 0.04 * rng.next());
    if (p.y < LEVEL.terrace + 0.12) continue;
    n.y += 0.5;
    n.normalize();
    tng.set(0, 1, 0).addScaledVector(n, -n.y).normalize();
    if (tng.lengthSq() < 0.1) tng.set(1, 0, 0);
    bit.crossVectors(n, tng).normalize();
    if (i < nFlowers) {
      const petals = 7 + Math.floor(rng.next() * 3);
      const R = 0.011 + 0.004 * rng.next();
      const spin = rng.next() * Math.PI;
      for (let k = 0; k < petals; k++) {
        const a = spin + (k / petals) * Math.PI * 2;
        const dir = tng.clone().multiplyScalar(Math.cos(a)).addScaledVector(bit, Math.sin(a));
        const side = n.clone().cross(dir).normalize();
        const start = flowers.count;
        const base = p.clone().addScaledVector(dir, 0.002);
        const tip = p.clone().addScaledVector(dir, R).addScaledVector(n, 0.003);
        const midp = p.clone().addScaledVector(dir, R * 0.55).addScaledVector(n, 0.002);
        flowers.v(base, 0, 0, white);
        flowers.v(midp.clone().addScaledVector(side, R * 0.24), 0.5, 0, white);
        flowers.v(tip, 1, 0, white);
        flowers.v(midp.clone().addScaledVector(side, -R * 0.24), 0.5, 1, white);
        flowers.idx.push(start, start + 1, start + 3, start + 1, start + 2, start + 3);
      }
    } else {
      // a slim bud: a stretched diamond, pinkish at its tip
      const start = flowers.count;
      const L = 0.016 + 0.006 * rng.next();
      const up = n.clone().addScaledVector(tng, 0.6).normalize();
      const s1 = new THREE.Vector3().crossVectors(up, bit).normalize();
      const tipC = new THREE.Color(1, 0.9, 0.92);
      flowers.v(p, 0, 0, white);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const q = p.clone().addScaledVector(up, L * 0.55).addScaledVector(bit, Math.cos(a) * 0.003).addScaledVector(s1, Math.sin(a) * 0.003);
        flowers.v(q, 0.5, k / 4, white);
      }
      flowers.v(p.clone().addScaledVector(up, L), 1, 0, tipC);
      for (let k = 0; k < 4; k++) {
        const a = start + 1 + k;
        const b2 = start + 1 + ((k + 1) % 4);
        flowers.idx.push(start, b2, a, a, b2, start + 5);
      }
    }
  }
  // the trellis: three canes up, two across, and the stems' woody bases
  const canes = new Mesh();
  const brown = (_t: number, out: THREE.Color) => out.setRGB(0.55, 0.47, 0.34);
  for (const dx of [-0.28, 0, 0.28]) {
    const x = cx + dx;
    tube(canes, new THREE.LineCurve3(new THREE.Vector3(x, LEVEL.terrace, cz + 0.02), new THREE.Vector3(x + dx * 0.15, LEVEL.terrace + JASMINE.h + 0.12, cz + 0.01)), 1, lite ? 4 : 6, 0.008, 0.006, 1, brown);
  }
  for (const h of [0.35, 0.72]) {
    const y = LEVEL.terrace + h;
    tube(canes, new THREE.LineCurve3(new THREE.Vector3(cx - 0.36, y, cz + 0.03), new THREE.Vector3(cx + 0.36, y + 0.01, cz + 0.03)), 1, lite ? 4 : 6, 0.006, 0.006, 1, brown);
  }
  for (let i = 0; i < 4; i++) {
    const x = cx + (rng.next() - 0.5) * 0.3;
    tube(
      canes,
      new THREE.CatmullRomCurve3([new THREE.Vector3(x, LEVEL.terrace, cz + 0.1), new THREE.Vector3(x + (rng.next() - 0.5) * 0.2, LEVEL.terrace + 0.25, cz + 0.12), new THREE.Vector3(x + (rng.next() - 0.5) * 0.4, LEVEL.terrace + 0.5, cz + 0.14)]),
      4,
      5,
      0.008,
      0.004,
      1,
      (_t, out) => out.setRGB(0.42, 0.36, 0.26),
    );
  }
  return { leaves: leaves.build(), flowers: flowers.build(), canes: canes.build() };
}

/** Triangles in the plants for a tier. */
export function plantTriangles(tier: Tier): Record<string, number> {
  const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  const b = makeBanana(tier);
  const a = makeArecas(tier);
  const j = makeJasmine(tier);
  const out = { banana: tri(b.stems) + tri(b.leaves), areca: tri(a.trunks) + tri(a.crowns), jasmine: tri(j.leaves) + tri(j.flowers) + tri(j.canes) };
  for (const g of [b.stems, b.leaves, a.trunks, a.crowns, j.leaves, j.flowers, j.canes]) g.dispose();
  return out;
}
