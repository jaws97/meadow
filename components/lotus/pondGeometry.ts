// The pond's geometry (lotus v2), all original and pure three.js, so the triangle budgets can be checked without a
// browser (geometry.test.ts):
// - the water's surface and the basin of the courtyard's granite tank (the shelf, the step, the deep zone and the
//   upright block walls), in the pond frame (pond.ts POND_FRAME: the pond's centre at the fill line);
// - the lotus pot, its mud and its river pebbles, in the pot frame (POT_FRAME: the pot's centre at the fill line).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { compose, GeoBuilder, smoothIcosphere } from "@/lib/garden/dressing";
import { Rng, smoothstep, vnoise2 } from "@/lib/plant/prng";
import { smoothLathe, type ProfilePoint, type Tier } from "@/components/lotus/geometry";
import { POND, pondFloorY } from "@/components/lotus/pond";

export const POND_TESS: Record<Tier, { water: [number, number]; basin: [number, number, number]; pot: number; pebbles: number; pebbleDetail: number }> = {
  cinematic: { water: [40, 32], basin: [32, 40, 8], pot: 64, pebbles: 120, pebbleDetail: 1 },
  balanced: { water: [30, 24], basin: [24, 30, 6], pot: 48, pebbles: 90, pebbleDetail: 0 },
  lite: { water: [20, 16], basin: [14, 18, 4], pot: 32, pebbles: 50, pebbleDetail: 0 },
};

/** The water's mesh reaches this far into the tank's walls, so no gap shows under the coping's lip. */
const WATER_TUCK = 0.006;

/**
 * The water's surface: the tank's rectangle as a grid, in the pond frame at y = 0 (the mesh is moved to the level).
 * uv carries the pond-frame x and z in metres, for the shader.
 */
export function makePondWaterGeometry(nx: number, nz: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2 * (POND.rx + WATER_TUCK), 2 * (POND.rz + WATER_TUCK), nx, nz);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  g.computeBoundingSphere();
  return g;
}

/** The tank's walls stand this far above the fill line, behind the coping's lip. */
const WALL_TOP = 0.022;

/**
 * The tank's basin, in the pond frame: the floor as a grid over the rectangle (the front shelf 25.5 cm down, a short
 * steep granite step, the deep zone 0.9 m down, its silt a little rounded into the corners), then the four upright
 * walls of dressed granite blocks from the floor to just over the fill line. Vertex colours carry the shade low in the
 * corners, the dark algae and the pale mineral line at the fill line; uv runs in metres (planar on the floor, along
 * and up on the walls).
 */
export function makeBasinGeometry(nx: number, nz: number, wallRows: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const floorAt = (x: number, z: number) => pondFloorY(x + POND.cx, z + POND.cz) - POND.waterY;
  const push = (x: number, y: number, z: number, u: number, v: number, shade: number, green = 0) => {
    pos.push(x, y, z);
    uv.push(u, v);
    col.push(shade * (1 - 0.18 * green), shade * (1 + 0.04 * green), shade * (0.95 - 0.22 * green));
  };
  // `flip` turns the faces round: the floor's rows run toward the camera and face up; the walls' run up and must face
  // into the tank
  const grid = (cols: number, rows: number, at: (i: number, j: number) => void, flip = false) => {
    const start = pos.length / 3;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) at(i, j);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = start + j * (cols + 1) + i;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        if (flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  };
  // the floor: rows packed round the shelf's step, so the drop stays crisp
  const edge = POND.shelfEdge;
  const zAt = (j: number) => {
    const z0 = -POND.rz;
    const z1 = POND.rz;
    // three bands: the deep floor, the step (a quarter of the rows over 8 cm), the shelf
    const a = Math.floor(nz * 0.375);
    const b = Math.floor(nz * 0.625);
    if (j <= a) return z0 + (edge - 0.04 - z0) * (j / a);
    if (j <= b) return edge - 0.04 + 0.08 * ((j - a) / (b - a));
    return edge + 0.04 + (z1 - edge - 0.04) * ((j - b) / (nz - b));
  };
  grid(nx, nz, (i, j) => {
    const x = -POND.rx + (2 * POND.rx * i) / nx;
    const z = zAt(j);
    // the silt rounds a few centimetres up into the foot of each wall
    const toWall = Math.min(POND.rx - Math.abs(x), POND.rz - Math.abs(z));
    const y = floorAt(x, z) + 0.02 * (1 - smoothstep(0, 0.06, toWall));
    const deep = y < -0.5 ? 1 : 0;
    const grain = 0.86 + 0.14 * vnoise2(x * 7 + 3, z * 7 - 1);
    push(x, y, z, x * 2.2, z * 2.2, 0.7 * grain * (1 - 0.3 * (1 - smoothstep(0, 0.12, toWall))) * (1 - 0.25 * deep), 0.5 + 0.3 * deep);
  });
  // the walls: front (+z), back (-z), left (-x), right (+x); each runs along its side, inward-facing
  const sides: { along: number; at: (s: number) => [number, number] }[] = [
    { along: 2 * POND.rx, at: (s) => [POND.rx - s, POND.rz] },
    { along: 2 * POND.rx, at: (s) => [-POND.rx + s, -POND.rz] },
    { along: 2 * POND.rz, at: (s) => [-POND.rx, POND.rz - s] },
    { along: 2 * POND.rz, at: (s) => [POND.rx, -POND.rz + s] },
  ];
  // the walls' rows: close together round the fill line (the mineral line, the algae band under it and the band a
  // falling level bares must be drawn, not interpolated away), then spread down to the floor
  const TOP_LEVELS = [WALL_TOP, 0.012, 0.004, -0.002, -0.008, -0.016, -0.026, -0.04, -0.055, -0.07, -0.09, -0.12];
  const deepRows = Math.max(2, wallRows - 4);
  sides.forEach((side, k) => {
    const cols = Math.max(4, Math.round((side.along / (2 * POND.rx)) * nx * 1.5));
    grid(cols, TOP_LEVELS.length - 1 + deepRows, (i, j) => {
      const s = (side.along * i) / cols;
      const [x, z] = side.at(s);
      const foot = floorAt(x * 0.995, z * 0.995) + 0.02;
      const last = TOP_LEVELS[TOP_LEVELS.length - 1];
      // j runs from the floor up (the faces turn inward with flip)
      const jj = TOP_LEVELS.length - 1 + deepRows - j;
      const y = jj < TOP_LEVELS.length ? TOP_LEVELS[jj] : last + (foot - last) * ((jj - TOP_LEVELS.length + 1) / deepRows);
      // a pale mineral line at the fill line, a hand's width of dark algae under it with a ragged lower edge, the wall
      // darkening down; the stone's own mottle in both directions (a pattern only along the wall read as fluting)
      const n1 = vnoise2(s * 9 + k * 9, y * 26);
      const n2 = vnoise2(s * 3.1 + y * 5 + k * 3, y * 13 - s * 2.3);
      const line = Math.exp(-(((y + 0.003) / 0.005) ** 2));
      const algae = Math.exp(-(((y + 0.048 + 0.016 * vnoise2(s * 7 + k * 5, 3.7)) / 0.042) ** 2));
      const shade = (0.8 + 0.08 * n1 + 0.08 * n2) * (1 + 0.85 * line) * (1 - 0.4 * algae) * (0.72 + 0.28 * smoothstep(-0.35, 0, y));
      push(x, y, z, s + k * 0.37, y, shade, (0.55 * algae + 0.3 * (1 - smoothstep(-0.4, -0.1, y))) * (1 - 0.8 * line));
    }, true);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * The lotus pot, in the pot frame: round, no drainage holes (Sayre 2004 via the pond model), 40 cm across inside and
 * 23 cm tall, its foot on the shelf, its rolled rim 2.5 cm under the fill line; v runs by arc length from the foot over
 * the rim and down the inside to the mud.
 */
export function makePotGeometry(segs: number): THREE.BufferGeometry {
  const foot = -POND.shelfDepth;
  const rim = -POND.rimDepth;
  const ri = POND.potR;
  const ro = POND.potR + POND.potWall;
  // a plain, slightly rounded lip: a rolled bead caught the light and drew a bright ring round the pot
  const pts: ProfilePoint[] = [
    { r: ro - 0.03, y: foot },
    { r: ro - 0.016, y: foot, crease: true },
    { r: ro - 0.012, y: foot + 0.02 },
    { r: ro - 0.002, y: rim - 0.04 },
    { r: ro, y: rim - 0.006 },
    { r: ro - 0.004, y: rim },
    { r: ri + 0.003, y: rim },
    { r: ri, y: rim - 0.006 },
    { r: ri - 0.004, y: -POND.mudDepth },
  ];
  return smoothLathe(pts, segs);
}

/**
 * The pot's own water, when the pond has fallen under its rim: a disc just inside the wall, in the pot frame at y = 0
 * (moved to its level); uv carries the pond-frame x and z, as the pond's surface does, so it shares the water's shader.
 */
export function makePotWaterGeometry(segs: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(POND.potR - 0.002, segs);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + POND.potX - POND.cx, p.getZ(i) + POND.potZ - POND.cz);
  return g;
}

/** The mud under the pebbles: a disc just inside the pot's wall (the pebbles hide most of it). */
export function makePotMudGeometry(segs: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(POND.potR - 0.003, segs);
  g.rotateX(-Math.PI / 2);
  // a skin of silt between the pebbles, nearly to their tops (a season's mulm settles round them in a pond with fish),
  // so the pot's top reads as silt with stones in it rather than a dish of loose pebbles
  g.translate(0, -POND.pebbleDepth - 0.0022, 0);
  return g;
}

/** River gravel under a season's silt: close greys and browns (the film evens them out), a few darker. */
const PEBBLE_TINTS = ["#8a8576", "#908a78", "#837f72", "#938b78", "#88826f", "#8d8572", "#7f7b70", "#958d7a", "#857e6c", "#8b8470"].map((c) => new THREE.Color(c));

/**
 * River pebbles on the pot's mud (3 cm deep, too big for 10 cm koi to shift: TFH's "gravel on the pot"), one merged
 * mesh: flattened, noisy pebbles 2.5-5 cm long packed over the disc, their tops at about 5 cm under the fill line,
 * vertex-coloured greys and buffs. A small clearing at the centre where the stalks rise.
 */
export function makePebblesGeometry(count: number, detail: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const unit = smoothIcosphere(detail);
  const b = new GeoBuilder();
  const m = new THREE.Matrix4();
  const placed: { x: number; z: number; r: number }[] = [];
  const top = -POND.pebbleDepth;
  let guard = 0;
  while (placed.length < count && guard++ < count * 40) {
    const a = rng.next() * Math.PI * 2;
    const rr = (0.03 + 0.97 * Math.sqrt(rng.next())) * (POND.potR - 0.022);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const r = 0.008 + 0.009 * rng.next();
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.82)) continue;
    placed.push({ x, z, r });
  }
  const g = unit.clone();
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const base = Float32Array.from(p.array as Float32Array);
  for (const pb of placed) {
    const ns = rng.next() * 40;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const z = base[i * 3 + 2];
      const n = 1 + 0.22 * vnoise2(x * 1.7 + ns, z * 1.7 + y) + 0.08 * vnoise2(x * 4 - ns, y * 4 + z);
      p.setXYZ(i, x * n, y * n, z * n);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    const h = pb.r * (0.26 + 0.16 * rng.next());
    compose(m, pb.x, top - h * 0.6 + 0.004 * (rng.next() - 0.5), pb.z, rng.next() * 6.28, (rng.next() - 0.5) * 0.3, (rng.next() - 0.5) * 0.3, pb.r * (1 + 0.5 * rng.next()), h, pb.r * (0.8 + 0.3 * rng.next()));
    b.add(g, m, PEBBLE_TINTS[Math.floor(rng.next() * PEBBLE_TINTS.length)].clone().multiplyScalar(0.94 + 0.12 * rng.next()));
  }
  g.dispose();
  unit.dispose();
  // the normals again from the faces: each pebble is a sphere squashed to a few millimetres, and its normals carried
  // through the squash by the matrix itself tipped every pebble's top sideways, so the pebbles read as dark spots
  const out = b.build();
  out.computeVertexNormals();
  return out;
}

/** Merges parts and disposes them. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("pond: parts could not be merged");
  g.computeBoundingSphere();
  return g;
}
