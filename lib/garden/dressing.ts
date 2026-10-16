// Procedural builders for the near garden: the raised bed's surface, the ring
// of mossy fieldstones, the flagstone path, the lantern, and the parts of the
// companion plants, plus the deterministic plan that places them for one
// owner. Everything here is pure geometry and numbers: no React, nothing read
// per frame. The owner's seed is read once by the caller and passed in.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LAYOUT } from "@/lib/garden/layout";
import type { Quality } from "@/lib/garden/store";
import {
  makeLeafGeometry,
  makePetalGeometry,
  makeStemGeometry,
  stemPointAt,
  type PetalShape,
} from "@/lib/plant/geometry";
import { Rng, clamp01, lerp, smoothstep, vnoise2 } from "@/lib/plant/prng";

/* ====================================================================== */
/* Wind sway, shared by the grass and the companion plants                 */
/* ====================================================================== */

/** Shared by every compiled sway program; written once per frame from env. */
export const swayUniforms = { uTime: { value: 0 }, uWind: { value: 0.5 }, uBacklight: { value: 0.3 } };

// Vertex: the part bends with the wind in the mesh frame after the instance
// matrix (so every blade leans the same way), by the square of its height
// fraction so roots stay planted. Grass measures height along its own blade;
// a plant measures the instance's world height so a stem and the flower head
// riding its tip bend together. `hh` also feeds the backlight in the fragment.
const SWAY_VERT_COMMON = "#include <common>\nuniform float uTime; uniform float uWind; varying float vHh;";
function swayVertex(height: number, amount: number, world: boolean): string {
  const h = height.toFixed(4);
  return (
    "#include <begin_vertex>\n" +
    `float hh = clamp(position.y / ${h}, 0.0, 1.0); vec2 swayOff = vec2(0.0);\n` +
    "#ifdef USE_INSTANCING\n{ vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);\n" +
    (world ? `hh = clamp((instanceMatrix * vec4(position, 1.0)).y / ${h}, 0.0, 1.0);\n` : "") +
    "float ph = wp.x * 1.7 + wp.z * 1.3;\n" +
    "float gust = 0.5 + 0.5 * sin(uTime * 0.8 + wp.x * 0.7 - wp.z * 0.5);\n" +
    "float sw = sin(uTime * 1.6 + ph) * 0.5 + sin(uTime * 2.7 + ph * 2.1) * 0.25;\n" +
    `float amp = uWind * hh * hh * ${amount.toFixed(3)};\n` +
    "swayOff = vec2(0.86, 0.5) * (sw + 0.9 * gust) * amp * 0.035 + vec2(-0.5, 0.86) * cos(uTime * 1.1 + ph) * amp * 0.015; }\n" +
    "#endif\nvHh = hh;"
  );
}
// onBeforeCompile sees the #include lines unexpanded, so the chunk is expanded
// here and the instance line inside it patched.
const SWAY_PROJECT = THREE.ShaderChunk.project_vertex.replace(
  "mvPosition = instanceMatrix * mvPosition;",
  "mvPosition = instanceMatrix * mvPosition; mvPosition.xz += swayOff;",
);

// Fragment: leaves and blades are thin and translucent, so a back face is lit
// like the front (no normal flip), and the sun behind one glows through its tip.
const SWAY_FRAG_COMMON = "#include <common>\nvarying float vHh; uniform float uBacklight;";
const NORMAL_NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", "");
const BACKLIGHT =
  "#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n" +
  "{ vec3 bV = normalize(vViewPosition); vec3 bL = directionalLights[0].direction;\n" +
  "float back = pow(max(0.0, dot(-bV, bL)), 4.0) * (0.1 + 0.9 * vHh);\n" +
  "reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * back * uBacklight; }\n#endif";

export interface SwayOptions {
  /** metres: the height at which the sway reaches full amplitude */
  height: number;
  /** 1 = grass; stems that stand taller take a little more */
  amount: number;
  /** measure height in world space (plants) instead of along the part (blades) */
  world: boolean;
}

function applySway(shader: THREE.WebGLProgramParametersWithUniforms, o: SwayOptions, lit: boolean) {
  shader.uniforms.uTime = swayUniforms.uTime;
  shader.uniforms.uWind = swayUniforms.uWind;
  shader.uniforms.uBacklight = swayUniforms.uBacklight;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", SWAY_VERT_COMMON)
    .replace("#include <begin_vertex>", swayVertex(o.height, o.amount, o.world))
    .replace("#include <project_vertex>", SWAY_PROJECT);
  if (lit) {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", SWAY_FRAG_COMMON)
      .replace("#include <normal_fragment_begin>", NORMAL_NO_FLIP)
      .replace("#include <lights_fragment_end>", BACKLIGHT);
  }
}

/** A standard material whose instances sway in the wind; `key` must be unique per options. */
export function makeSwayMaterial(
  key: string,
  o: SwayOptions,
  params: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...params });
  m.onBeforeCompile = (shader) => applySway(shader, o, true);
  m.customProgramCacheKey = () => key;
  return m;
}

/** Shadow-pass twin of a sway material, so the cast shadows move with the parts. */
export function makeSwayDepthMaterial(key: string, o: SwayOptions): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => applySway(shader, o, false);
  m.customProgramCacheKey = () => key + "-depth";
  return m;
}

/* ====================================================================== */
/* Geometry assembly                                                        */
/* ====================================================================== */

const tv = new THREE.Vector3();
const tn = new THREE.Vector3();
const tc = new THREE.Color();
/** Tint scratch for GeoBuilder.add; never the same object as the colour callback's `out` (tc). */
const tt = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const tm = new THREE.Matrix4();
const tq = new THREE.Quaternion();
const te = new THREE.Euler();
const ts = new THREE.Vector3();

/** Per-vertex colour callback: local position and normal in, colour out. */
export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;

/**
 * Collects indexed geometry into one buffer with position, normal, uv and
 * colour, so a ring of forty stones or a whole lantern is one draw call.
 */
export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  /** Appends `g` under `m`; colour is `tint`, or `fn` when given (`tint` then multiplies it). */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, tint: THREE.Color, fn?: ColorFn) {
    const p = g.getAttribute("position");
    let n = g.getAttribute("normal");
    if (!n) {
      g.computeVertexNormals();
      n = g.getAttribute("normal");
    }
    const u = g.getAttribute("uv");
    const index = g.getIndex();
    const start = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      tv.set(p.getX(i), p.getY(i), p.getZ(i));
      tn.set(n.getX(i), n.getY(i), n.getZ(i));
      if (fn) {
        fn(tv, tn, tc);
        tc.multiply(tint);
      } else tc.copy(tint);
      tv.applyMatrix4(m);
      tn.transformDirection(m);
      this.pos.push(tv.x, tv.y, tv.z);
      this.nor.push(tn.x, tn.y, tn.z);
      this.col.push(tc.r, tc.g, tc.b);
      if (u) this.uv.push(u.getX(i), u.getY(i));
      else this.uv.push(0, 0);
    }
    if (index) {
      for (let i = 0; i < index.count; i++) this.idx.push(start + index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(start + i);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Compose a matrix from position, YXZ euler and scale into `out`. */
export function compose(
  out: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  roll: number,
  sx: number,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  te.set(pitch, yaw, roll, "YXZ");
  tq.setFromEuler(te);
  return out.compose(tv.set(x, y, z), tq, ts.set(sx, sy, sz));
}

/**
 * An indexed, smooth-shaded unit sphere from a subdivided icosahedron. The
 * polyhedron's UVs are dropped before welding: they split along a seam, and
 * after noise displacement the split vertices shade as a visible crease.
 */
export function smoothIcosphere(detail: number): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(1, detail);
  raw.deleteAttribute("uv");
  raw.deleteAttribute("normal");
  const g = mergeVertices(raw, 1e-4);
  raw.dispose();
  g.computeVertexNormals();
  return g;
}

/**
 * Box-projected UVs from each vertex's position and normal: the face of the
 * stone that points mostly up takes x/z, the sides take the other pairs. The
 * mineral grain is fine enough that the blend lines between faces never show.
 */
function boxProjectUVs(g: THREE.BufferGeometry, scale: number, offset: number) {
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u * scale + offset;
    uv[i * 2 + 1] = v * scale + offset * 0.7;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * A surface of revolution with `segments` sides (4 makes a square post, 8 an
 * octagonal one); the profile runs bottom to top as [radius, y] pairs. Sides
 * are flat-shaded so a square post keeps its corners.
 */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, segments: number, yaw0 = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rows = profile.length;
  for (let j = 0; j < rows - 1; j++) {
    const [r0, y0] = profile[j];
    const [r1, y1] = profile[j + 1];
    // side normal from the profile slope
    const dy = y1 - y0;
    const dr = r1 - r0;
    const len = Math.hypot(dy, dr) || 1;
    const nr = dy / len;
    const ny = -dr / len;
    for (let i = 0; i < segments; i++) {
      const a0 = yaw0 + (i / segments) * Math.PI * 2;
      const a1 = yaw0 + ((i + 1) / segments) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const base = pos.length / 3;
      pos.push(Math.cos(a0) * r0, y0, Math.sin(a0) * r0);
      pos.push(Math.cos(a1) * r0, y0, Math.sin(a1) * r0);
      pos.push(Math.cos(a0) * r1, y1, Math.sin(a0) * r1);
      pos.push(Math.cos(a1) * r1, y1, Math.sin(a1) * r1);
      const nx = Math.cos(am) * nr;
      const nz = Math.sin(am) * nr;
      for (let k = 0; k < 4; k++) nor.push(nx, ny, nz);
      uv.push(i / segments, j / (rows - 1), (i + 1) / segments, j / (rows - 1));
      uv.push(i / segments, (j + 1) / (rows - 1), (i + 1) / segments, (j + 1) / (rows - 1));
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ====================================================================== */
/* The raised bed                                                           */
/* ====================================================================== */

const BED = LAYOUT.bed;
/** Where the mulch plateau starts to fall away toward the stones, in oval units. */
const LIP_RHO = 1 - BED.lipWidth / ((BED.rx + BED.rz) * 0.5);

/** Distance from the bed centre in oval units: 1 on the oval's edge. */
export function bedRho(x: number, z: number): number {
  const dx = (x - BED.center[0]) / BED.rx;
  const dz = (z - BED.center[2]) / BED.rz;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Height of the mulch at (x, z): the plateau, a soft rim just inside the
 * stones, the hero's mound with the watering saucer round it, mulch lumps,
 * and past the ring a dip under the lawn so the join is hidden.
 */
export function bedSurfaceY(x: number, z: number): number {
  const rho = bedRho(x, z);
  const plateau = 1 - smoothstep(LIP_RHO, 1, rho);
  let y = BED.height * plateau;
  const rim = (rho - 0.87) / 0.05;
  y += 0.012 * Math.exp(-rim * rim);
  const r = Math.hypot(x, z);
  const saucer = (r - 0.43) / 0.09;
  y += 0.024 * (1 - smoothstep(0.04, 0.34, r)) - 0.009 * Math.exp(-saucer * saucer) * plateau;
  const lumps = 0.006 * vnoise2(x * 9 + 2.3, z * 9 - 1.1) + 0.0025 * vnoise2(x * 37, z * 37 + 5);
  y += lumps * plateau;
  y -= 0.012 * smoothstep(0.98, 1.08, rho);
  return y;
}

/**
 * Where the hero's stem meets the mulch: the crown of its mound, a few
 * millimetres down so the stem reads as planted, not stood on top.
 */
export const HERO_GROUND_Y = bedSurfaceY(LAYOUT.hero[0], LAYOUT.hero[2]) - 0.004;

/**
 * The bed as a polar grid round its centre, dense at the rim. Normals come
 * from the height field itself; vertex colour darkens the saucer and the slope
 * under the stones and lightens the mound's crown. UVs tile the mulch in
 * world space so nothing stretches.
 */
export function makeBedGeometry(rings: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const eps = 0.004;
  const [cx, , cz] = BED.center;
  for (let i = 0; i <= rings; i++) {
    const rho = i === 0 ? 0 : Math.pow(i / rings, 0.8) * 1.08;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * BED.rx * rho;
      const z = cz + Math.sin(a) * BED.rz * rho;
      const y = bedSurfaceY(x, z);
      const dydx = (bedSurfaceY(x + eps, z) - bedSurfaceY(x - eps, z)) / (2 * eps);
      const dydz = (bedSurfaceY(x, z + eps) - bedSurfaceY(x, z - eps)) / (2 * eps);
      tn.set(-dydx, 1, -dydz).normalize();
      pos.push(x, y, z);
      nor.push(tn.x, tn.y, tn.z);
      uv.push(x * 0.55, z * 0.55);
      const r = Math.hypot(x, z);
      const grain = 0.9 + 0.12 * vnoise2(x * 6 + 1, z * 6 + 7) + 0.06 * vnoise2(x * 23, z * 23);
      const saucer = (r - 0.43) / 0.1;
      const slope = smoothstep(0.9, 1.02, rho);
      let v = grain * (1 - 0.22 * Math.exp(-saucer * saucer)) * (1 - 0.45 * slope);
      v *= 1 + 0.1 * (1 - smoothstep(0.02, 0.3, r));
      col.push(v, v * 0.98, v * 0.95);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const c = a + segs + 1;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Standing water in the watering saucer round the hero, for rain and a
 * drowned bed: one flat sheet at a level a few millimetres over the saucer's
 * floor, so the mulch it lies in cuts it into an uneven ring of puddles.
 * Where the bed falls away toward the stones the sheet would float, so the
 * vertex alpha fades it out wherever the water stands too deep.
 */
export function makePuddleGeometry(rows: number, segs: number): THREE.BufferGeometry {
  const r0 = 0.27;
  const r1 = 0.62;
  // the level: the saucer floor where it lies on the plateau, plus a few millimetres
  let floor = 0;
  let n = 0;
  for (let j = 0; j < 48; j++) {
    const a = (j / 48) * Math.PI * 2;
    const x = Math.cos(a) * 0.43;
    const z = Math.sin(a) * 0.43;
    if (bedRho(x, z) > LIP_RHO - 0.04) continue;
    floor += bedSurfaceY(x, z);
    n++;
  }
  const level = (n > 0 ? floor / n : BED.height) + 0.0035;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const keep: boolean[] = [];
  for (let i = 0; i <= rows; i++) {
    const r = lerp(r0, r1, i / rows);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const depth = level - bedSurfaceY(x, z);
      const onPlateau = bedRho(x, z) < LIP_RHO - 0.01;
      pos.push(x, level, z);
      nor.push(0, 1, 0);
      uv.push(x * 2, z * 2);
      col.push(1, 1, 1, onPlateau ? 1 - smoothstep(0.004, 0.007, depth) : 0);
      keep.push(onPlateau && depth > -0.004);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const c = a + segs + 1;
      // a quad is drawn if any corner is wet; buried corners hide under the mulch
      if (keep[a] || keep[a + 1] || keep[c] || keep[c + 1]) idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ====================================================================== */
/* The path                                                                 */
/* ====================================================================== */

export interface Flagstone {
  x: number;
  z: number;
  /** nominal radius */
  r: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  /** how far the top stands above the lawn */
  lift: number;
  tint: number;
  seed: number;
}

export interface PathPlan {
  /** the smoothed centreline, evenly spaced */
  line: THREE.Vector3[];
  stones: Flagstone[];
  /** distance from (x, z) to the centreline */
  distance(x: number, z: number): number;
  /** whether (x, z) lies on a flagstone's top */
  onStone(x: number, z: number): boolean;
}

const LANTERN_XZ = [LAYOUT.lantern.position[0], LAYOUT.lantern.position[2]] as const;
/** Half the width of the lantern's square plinth, in metres. */
const LANTERN_PLINTH = 0.072;

function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1e-9;
  const t = clamp01(((px - ax) * vx + (pz - az) * vz) / l2);
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

const planCache = new Map<string, PathPlan>();

/**
 * The owner's path: the layout's waypoints with a bulge to one side chosen
 * per owner, pushed clear of the bed's stones and the lantern post, then
 * paved with irregular flagstones walked along it by arc length.
 */
export function pathPlan(seed: string): PathPlan {
  const hit = planCache.get(seed);
  if (hit) return hit;
  const rng = new Rng(seed + "|garden|path");
  const side = rng.sign();
  const pts: THREE.Vector3[] = LAYOUT.path.map((p) => new THREE.Vector3(p[0], 0, p[2]));
  for (let i = 1; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i - 1].x;
    const dz = pts[i + 1].z - pts[i - 1].z;
    const l = Math.hypot(dx, dz) || 1;
    const amt = side * rng.range(0.05, 0.13);
    pts[i].x += (-dz / l) * amt + rng.range(-0.03, 0.03);
    pts[i].z += (dx / l) * amt + rng.range(-0.03, 0.03);
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const samples = curve.getSpacedPoints(160);
  // Keep clear of the bed's stones (in oval units) and of the lantern post.
  for (const p of samples) {
    const rho = bedRho(p.x, p.z);
    if (rho < 1.32) {
      const k = 1.32 / Math.max(rho, 1e-3);
      p.x = BED.center[0] + (p.x - BED.center[0]) * k;
      p.z = BED.center[2] + (p.z - BED.center[2]) * k;
    }
    const lx = p.x - LANTERN_XZ[0];
    const lz = p.z - LANTERN_XZ[1];
    const ld = Math.hypot(lx, lz);
    if (ld < 0.5) {
      const k = 0.5 / Math.max(ld, 1e-3);
      p.x = LANTERN_XZ[0] + lx * k;
      p.z = LANTERN_XZ[1] + lz * k;
    }
  }
  // Two passes of smoothing take the kinks out of the pushed stretch.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < samples.length - 1; i++) {
      samples[i].x = (samples[i - 1].x + samples[i].x * 2 + samples[i + 1].x) / 4;
      samples[i].z = (samples[i - 1].z + samples[i].z * 2 + samples[i + 1].z) / 4;
    }
  }
  // Resample by arc length so the stone walk is even.
  const resampled = new THREE.CatmullRomCurve3(samples, false, "centripetal").getSpacedPoints(120);
  const line = resampled.map((p) => new THREE.Vector3(p.x, 0, p.z));

  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + line[i].distanceTo(line[i - 1]));
  const total = cum[cum.length - 1];
  const at = (s: number, out: THREE.Vector3, dir: THREE.Vector3) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = clamp01((s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]));
    out.copy(line[i - 1]).lerp(line[i], t);
    dir.copy(line[i]).sub(line[i - 1]).normalize();
  };

  const stones: Flagstone[] = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  let s = 0.14;
  let prevR = 0.1;
  while (s < total - 0.1) {
    const pair = rng.next() < 0.28;
    const r = pair ? rng.range(0.11, 0.14) : rng.range(0.15, 0.22);
    s += prevR + r + rng.range(0.04, 0.09);
    if (s > total - 0.1) break;
    at(s, p, d);
    const yaw = Math.atan2(d.x, d.z) + rng.range(-0.5, 0.5);
    const place = (lateral: number, rr: number) => {
      const x = p.x - d.z * lateral;
      const z = p.z + d.x * lateral;
      if (bedRho(x, z) < 1.1 + rr / 0.8) return;
      if (Math.hypot(x - LANTERN_XZ[0], z - LANTERN_XZ[1]) < 0.26 + rr) return;
      stones.push({
        x,
        z,
        r: rr,
        yaw,
        tiltX: rng.range(-0.035, 0.035),
        tiltZ: rng.range(-0.035, 0.035),
        lift: rng.range(0.008, 0.02),
        tint: rng.next(),
        seed: rng.range(0, 100),
      });
    };
    if (pair) {
      const off = 0.13 + rng.range(-0.02, 0.02);
      place(off, r);
      place(-off, rng.range(0.11, 0.14));
    } else place(rng.range(-0.07, 0.07), r);
    prevR = pair ? 0.14 : r;
  }

  const plan: PathPlan = {
    line,
    stones,
    distance(x, z) {
      let best = Infinity;
      for (let i = 1; i < line.length; i++) {
        const dd = pointSegmentDistance(x, z, line[i - 1].x, line[i - 1].z, line[i].x, line[i].z);
        if (dd < best) best = dd;
      }
      return best;
    },
    onStone(x, z) {
      for (const st of stones) {
        const dx = x - st.x;
        const dz = z - st.z;
        if (dx * dx + dz * dz < st.r * st.r * 0.8) return true;
      }
      return false;
    },
  };
  planCache.set(seed, plan);
  return plan;
}

/* ====================================================================== */
/* Stones                                                                   */
/* ====================================================================== */

const STONE_TINTS = ["#7d7f7c", "#9a8a74", "#6e7682", "#7c6b58", "#a9a394", "#5e5b55", "#8b8378", "#95907f"] as const;
const MOSS_DARK = new THREE.Color("#2c5520");
const MOSS_LIGHT = new THREE.Color("#7ea33a");
const LICHEN_PALE = new THREE.Color("#b9b89a");
const LICHEN_GOLD = new THREE.Color("#d2bf6c");

export interface Fieldstone {
  x: number;
  z: number;
  /** the gap angle after this stone, for the moss between */
  angle: number;
  length: number;
  width: number;
  height: number;
  yaw: number;
  sink: number;
}

/** Stone centres round the bed's rim, walked by their own sizes so they touch but never overlap. */
export function planFieldstones(seed: string): Fieldstone[] {
  const rng = new Rng(seed + "|garden|stones");
  const out: Fieldstone[] = [];
  const rho = 0.955;
  const [cx, , cz] = BED.center;
  let a = rng.range(0, Math.PI * 2);
  const a0 = a;
  let prevHalf = 0;
  let guard = 0;
  while (guard++ < 80) {
    const length = rng.range(0.09, 0.19);
    const width = length * rng.range(0.55, 0.85);
    const height = width * rng.range(0.7, 1.0);
    const arcPerRad = Math.hypot(BED.rx * Math.sin(a), BED.rz * Math.cos(a)) * rho;
    const step = (prevHalf + length / 2 + rng.range(0.02, 0.05)) / arcPerRad;
    if (out.length > 0 && a + step - a0 > Math.PI * 2 - 0.03) break;
    a += step;
    const rr = rho + rng.range(-0.02, 0.02);
    const x = cx + Math.cos(a) * BED.rx * rr;
    const z = cz + Math.sin(a) * BED.rz * rr;
    // the ring's tangent at this angle, so the stone's long axis follows the kerb
    const tx = -Math.sin(a) * BED.rx;
    const tz = Math.cos(a) * BED.rz;
    const yaw = Math.atan2(tx, tz) + rng.range(-0.35, 0.35);
    prevHalf = length / 2;
    // The lantern's plinth is set into the kerb: it takes the place of a stone.
    if (Math.hypot(x - LANTERN_XZ[0], z - LANTERN_XZ[1]) < LANTERN_PLINTH * 1.3 + length * 0.45) continue;
    out.push({ x, z, angle: a, length, width, height, yaw, sink: rng.range(0.32, 0.5) });
  }
  return out;
}

function toBedCentre(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(BED.center[0] - x, 0, BED.center[2] - z).normalize();
}

const inward = new THREE.Vector3();

/**
 * Every fieldstone: a subdivided icosahedron squashed to the stone's size,
 * pushed in and out by three octaves of noise, flattened underneath, then
 * coloured per vertex: a mineral tint, darkness toward the ground, moss on
 * the upper and bed-facing faces, flecks of lichen. One geometry, one draw.
 */
export function makeFieldstones(stones: Fieldstone[], seed: string, detail: number, fineDetail: number): THREE.BufferGeometry {
  const rng = new Rng(seed + "|garden|stonecolour");
  const b = new GeoBuilder();
  const base = smoothIcosphere(detail);
  const fine = fineDetail > detail ? smoothIcosphere(fineDetail) : base;
  const tint = new THREE.Color();
  const mossy = new THREE.Color();
  for (const st of stones) {
    const near = st.z > 0 || Math.abs(st.x) > 0.6;
    const src = near ? fine : base;
    const g = src.clone();
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const sx = st.length / 2;
    const sy = st.height / 2;
    const sz = st.width / 2;
    const ns = rng.range(0, 50);
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i);
      const uy = p.getY(i);
      const uz = p.getZ(i);
      const d =
        1 +
        0.2 * vnoise2(ux * 1.7 + ns, uy * 1.7 + uz * 0.9) +
        0.1 * vnoise2(uz * 3.1 + ns * 2, ux * 3.1 - uy) +
        0.035 * vnoise2(uy * 7 + ns, uz * 7 + ux * 2);
      let x = ux * sx * d;
      let y = uy * sy * d;
      const z = uz * sz * d;
      // a flat-ish bottom and a gently flattened top, as a stone that has settled
      if (y < -sy * 0.35) y = lerp(y, -sy * 0.55, 0.65);
      if (y > sy * 0.55) y = lerp(y, sy * 0.72, 0.4);
      x += 0.04 * sx * vnoise2(uy * 4 + ns, uz * 4);
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    // about one texture tile per 22 cm, offset per stone so no two share a grain
    boxProjectUVs(g, 4.5, ns * 0.37);
    tint.set(rng.pick(STONE_TINTS)).multiplyScalar(rng.range(0.85, 1.1));
    const mossAmt = Math.pow(rng.next(), 1.4) * 0.95;
    const lichenAmt = rng.next();
    toBedCentre(st.x, st.z, inward);
    const cs = Math.cos(-st.yaw);
    const sn = Math.sin(-st.yaw);
    // the bed-facing direction in the stone's local frame
    const lx = inward.x * cs - inward.z * sn;
    const lz = inward.x * sn + inward.z * cs;
    const fn: ColorFn = (v, n, out) => {
      const grain = 0.92 + 0.08 * vnoise2(v.x * 90 + ns, v.z * 90 + v.y * 40);
      const down = smoothstep(-0.9, 0.5, v.y / sy);
      out.setScalar(grain * lerp(0.45, 1, down));
      const facing = clamp01(0.5 + 0.5 * (n.x * lx + n.z * lz));
      const upness = clamp01(n.y * 0.5 + 0.5);
      const mn = 0.5 + 0.5 * vnoise2(v.x * 28 + ns, v.z * 28 + v.y * 20);
      const moss = smoothstep(0.55, 0.85, mn * 0.55 + upness * 0.25 + facing * 0.2 + mossAmt * 0.35) * mossAmt;
      if (moss > 0) {
        mossy.copy(MOSS_DARK).lerp(MOSS_LIGHT, clamp01(n.y * 0.7 + 0.3));
        out.lerp(mossy, moss);
      }
      const ln = vnoise2(v.x * 160 + ns * 3, v.z * 160 + v.y * 90);
      const lichen = smoothstep(0.45 + 0.35 * (1 - lichenAmt), 0.75, ln) * (1 - moss) * smoothstep(-0.2, 0.4, n.y);
      if (lichen > 0) out.lerp(lichenAmt > 0.5 ? LICHEN_PALE : LICHEN_GOLD, lichen * 0.7);
    };
    const surface = bedSurfaceY(st.x, st.z);
    compose(tm, st.x, surface + sy - st.height * st.sink, st.z, st.yaw, rng.range(-0.12, 0.12), rng.range(-0.12, 0.12), 1);
    b.add(g, tm, tint, fn);
    g.dispose();
  }
  base.dispose();
  if (fine !== base) fine.dispose();
  return b.build();
}

/**
 * Moss cushions in the gaps between stones and at their feet: flattened,
 * noisy domes, dark at the base and yellow-green at the crown.
 */
export function makeMossCushions(stones: Fieldstone[], seed: string): THREE.BufferGeometry {
  const rng = new Rng(seed + "|garden|moss");
  const b = new GeoBuilder();
  const dome = smoothIcosphere(1);
  const p = dome.getAttribute("position") as THREE.BufferAttribute;
  const [cx, , cz] = BED.center;
  const place = (x: number, z: number, size: number, tall: number) => {
    const g = dome.clone();
    const gp = g.getAttribute("position") as THREE.BufferAttribute;
    const ns = rng.range(0, 40);
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i);
      const uy = p.getY(i);
      const uz = p.getZ(i);
      const d = 1 + 0.16 * vnoise2(ux * 2.3 + ns, uz * 2.3 + uy) + 0.06 * vnoise2(uy * 6, ux * 6 + ns);
      gp.setXYZ(i, ux * size * d, Math.max(-0.2, uy) * tall * d, uz * size * d * rng.range(0.98, 1.02));
    }
    gp.needsUpdate = true;
    g.computeVertexNormals();
    const fn: ColorFn = (v, n, out) => {
      const t = clamp01(v.y / tall) * 0.7 + clamp01(n.y) * 0.3;
      out.copy(MOSS_DARK).lerp(MOSS_LIGHT, smoothstep(0.1, 1, t));
      out.multiplyScalar(0.9 + 0.2 * vnoise2(v.x * 120 + ns, v.z * 120));
    };
    const y = bedSurfaceY(x, z);
    compose(tm, x, Math.max(y, -0.002) - tall * 0.2, z, rng.range(0, 6.28), 0, 0, 1);
    b.add(g, tm, WHITE, fn);
    g.dispose();
  };
  for (let i = 0; i < stones.length; i++) {
    const a = stones[i];
    const nb = stones[(i + 1) % stones.length];
    // between this stone and the next, a touch inside the ring
    if (rng.next() < 0.7) {
      const ang = i === stones.length - 1 ? nb.angle + Math.PI * 2 : nb.angle;
      const mid = (a.angle + ang) / 2;
      const rr = rng.range(0.9, 0.98);
      place(cx + Math.cos(mid) * BED.rx * rr, cz + Math.sin(mid) * BED.rz * rr, rng.range(0.025, 0.055), rng.range(0.012, 0.028));
    }
    // and now and then one at a stone's foot on the lawn side
    if (rng.next() < 0.3) {
      const rr = rng.range(1.02, 1.07);
      place(cx + Math.cos(a.angle) * BED.rx * rr, cz + Math.sin(a.angle) * BED.rz * rr, rng.range(0.02, 0.04), rng.range(0.008, 0.016));
    }
  }
  dome.dispose();
  return b.build();
}

const FLAG_TINTS = ["#8c8578", "#9d927f", "#7b7870", "#a79c87", "#6f6c66", "#b3a890", "#8a8070", "#9a9488"] as const;
const FLAG_A = new THREE.Color();
const FLAG_B = new THREE.Color();

/**
 * Flagstones: each an irregular polygon with a faintly domed top, a bevel
 * and a skirt that runs under the lawn; grey-tan with dirt in the bevel and
 * moss creeping up the shaded edge. All stones in one geometry.
 */
export function makeFlagstones(plan: PathPlan, sides: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const st of plan.stones) {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const colv: THREE.Color[] = [];
    const top = st.lift;
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color) => {
      pos.push(x, y, z);
      nor.push(nx, ny, nz);
      uv.push(x * 3, z * 3);
      colv.push(c.clone());
    };
    FLAG_A.set(FLAG_TINTS[Math.floor(st.tint * FLAG_TINTS.length)]);
    FLAG_B.copy(FLAG_A).lerp(tc.set("#4a4336"), 0.45);
    // centre
    tc.copy(FLAG_A).multiplyScalar(1.04);
    push(0, top + 0.004, 0, 0, 1, 0, tc);
    const radii: number[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const wob = 0.5 + 0.5 * vnoise2(Math.cos(a) * 2.2 + st.seed, Math.sin(a) * 2.2 + st.seed * 0.3);
      const r = st.r * (0.74 + 0.26 * wob) + 0.03 * st.r * vnoise2(a * 3.1 + st.seed, st.seed);
      radii.push(r);
    }
    // ring A: top edge; ring B: bevel; ring C: skirt bottom
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const r = radii[k];
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const grain = 0.9 + 0.12 * vnoise2(cx * 9 + st.seed, cz * 9 - st.seed);
      tc.copy(FLAG_A).multiplyScalar(grain);
      push(cx * r, top, cz * r, cx * 0.25, 0.97, cz * 0.25, tc);
    }
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const r = radii[k] * 1.03;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      // moss favours the north (-z) side of the stone where it stays damp
      const moss = smoothstep(0.2, 0.9, -cz * 0.5 + 0.5 + 0.4 * vnoise2(a * 2 + st.seed, st.seed));
      tc.copy(FLAG_B).lerp(MOSS_DARK, moss * 0.6);
      push(cx * r, top - 0.009, cz * r, cx * 0.8, 0.6, cz * 0.8, tc);
    }
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const r = radii[k] * 1.0;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      tc.copy(FLAG_B).multiplyScalar(0.6);
      push(cx * r, -0.02, cz * r, cx, 0, cz, tc);
    }
    for (let k = 0; k < sides; k++) {
      const n = (k + 1) % sides;
      idx.push(0, 1 + n, 1 + k);
      const a0 = 1 + k;
      const a1 = 1 + n;
      const b0 = 1 + sides + k;
      const b1 = 1 + sides + n;
      const c0 = 1 + sides * 2 + k;
      const c1 = 1 + sides * 2 + n;
      idx.push(a0, b1, b0, a0, a1, b1);
      idx.push(b0, c1, c0, b0, b1, c1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    let vi = 0;
    const fn: ColorFn = (_v, _n, out) => {
      out.copy(colv[vi++]);
    };
    compose(tm, st.x, 0, st.z, st.yaw, st.tiltX, st.tiltZ, 1);
    b.add(g, tm, WHITE, fn);
    g.dispose();
  }
  return b.build();
}

/**
 * The strip of trodden, mossy soil the flagstones lie in: a ribbon along
 * the centreline, a little wider than the stones, dark at the edges where
 * the grass takes over.
 */
export function makePathBed(plan: PathPlan): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const half = LAYOUT.pathWidth * 0.5 + 0.06;
  const line = plan.line;
  const lanes = 4;
  const edge = new THREE.Color("#2a2a17");
  const mid = new THREE.Color("#4a4530");
  for (let i = 0; i < line.length; i++) {
    const p0 = line[Math.max(0, i - 1)];
    const p1 = line[Math.min(line.length - 1, i + 1)];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    for (let j = 0; j <= lanes; j++) {
      const u = (j / lanes) * 2 - 1;
      const x = line[i].x + nx * u * half;
      const z = line[i].z + nz * u * half;
      pos.push(x, 0.003, z);
      nor.push(0, 1, 0);
      uv.push(x * 1.2, z * 1.2);
      const t = 1 - Math.pow(Math.abs(u), 2.2);
      tc.copy(edge).lerp(mid, t);
      tc.multiplyScalar(0.9 + 0.2 * vnoise2(x * 7 + 3, z * 7));
      col.push(tc.r, tc.g, tc.b);
    }
  }
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < lanes; j++) {
      const a = i * (lanes + 1) + j;
      const c = a + lanes + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ====================================================================== */
/* The lantern                                                              */
/* ====================================================================== */

export interface LanternGeometry {
  /** the post and its cap, wood-grained */
  wood: THREE.BufferGeometry;
  /** the cut-stone plinth the post stands in */
  plinth: THREE.BufferGeometry;
  /** bracket, lamp frame, roof and finial */
  iron: THREE.BufferGeometry;
  /** the four panes */
  glass: THREE.BufferGeometry;
  /** the wax candle inside */
  candle: THREE.BufferGeometry;
  /** two crossed flame cards above the wick */
  flame: THREE.BufferGeometry;
  /** world position of the lamp's centre */
  lamp: THREE.Vector3;
  /** world position of the wick, where the flame stands */
  wick: THREE.Vector3;
}

const WOOD = new THREE.Color("#6a5a4a");
const WOOD_WEATHER = new THREE.Color("#8d8578");
const IRON = new THREE.Color("#221d1a");
const IRON_LIT = new THREE.Color("#2c2622");
const PLINTH = new THREE.Color("#6e6a63");
const WAX = new THREE.Color("#f1e4c6");
const WICK = new THREE.Color("#2a1c10");

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/**
 * The lantern at LAYOUT.lantern: an octagonal oak post on a cut-stone plinth,
 * an iron bracket arm with a brace, and a four-pane lamp hung from a hook so
 * its centre sits at `lampHeight`, over the bed's edge.
 */
export function makeLantern(): LanternGeometry {
  const [px, , pz] = LAYOUT.lantern.position;
  const toBed = new THREE.Vector3(BED.center[0] - px, 0, BED.center[2] - pz).normalize();
  const yaw = Math.atan2(toBed.x, toBed.z);
  const postH = 1.52;
  const armLen = 0.27;
  const lampY = LAYOUT.lantern.lampHeight;
  const lamp = new THREE.Vector3(px + toBed.x * armLen, lampY, pz + toBed.z * armLen);

  // wood: the post, flat-shaded octagon with a slight taper and a weathered top
  const wood = new GeoBuilder();
  const post = lathe(
    [
      [0.04, 0.05],
      [0.039, 0.3],
      [0.036, 1.0],
      [0.032, postH],
      [0.0, postH],
    ],
    8,
    Math.PI / 8,
  );
  const woodFn: ColorFn = (v, _n, out) => {
    // grey weathering climbs the post from the damp foot and tops it off
    const w = 0.25 + 0.5 * smoothstep(0.3, 1.5, v.y) + 0.25 * smoothstep(1.3, postH, v.y);
    out.copy(WOOD).lerp(WOOD_WEATHER, w);
    out.multiplyScalar(0.9 + 0.2 * vnoise2(v.y * 14, Math.atan2(v.z, v.x) * 3));
  };
  compose(tm, px, 0, pz, yaw, 0, 0, 1);
  wood.add(post, tm, WHITE, woodFn);
  post.dispose();
  const cap = lathe(
    [
      [0.05, postH - 0.005],
      [0.05, postH + 0.015],
      [0.012, postH + 0.055],
      [0.0, postH + 0.055],
    ],
    4,
    Math.PI / 4 + yaw,
  );
  wood.add(cap, tm, tt.copy(WOOD).lerp(WOOD_WEATHER, 0.7));
  cap.dispose();

  // the stone plinth, then the ironwork
  const stone = new GeoBuilder();
  const plinth = lathe(
    [
      [LANTERN_PLINTH * Math.SQRT2, -0.02],
      [LANTERN_PLINTH * Math.SQRT2, 0.045],
      [LANTERN_PLINTH * Math.SQRT2 * 0.82, 0.065],
      [0.0, 0.065],
    ],
    4,
    Math.PI / 4 + yaw,
  );
  const plinthFn: ColorFn = (v, _n, out) => {
    out.copy(PLINTH).multiplyScalar(0.85 + 0.25 * vnoise2(v.x * 40, v.z * 40 + v.y * 60));
    out.lerp(MOSS_DARK, 0.35 * (1 - smoothstep(0.0, 0.05, v.y)));
  };
  stone.add(plinth, tm, WHITE, plinthFn);
  plinth.dispose();

  const iron = new GeoBuilder();

  // bracket: a band round the post, the arm, a brace, a hook
  const addIron = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry: number, rx: number, rz: number) => {
    compose(tm, x, y, z, ry, rx, rz, 1);
    iron.add(g, tm, IRON);
    g.dispose();
  };
  const band = lathe(
    [
      [0.038, postH - 0.11],
      [0.045, postH - 0.1],
      [0.045, postH - 0.06],
      [0.038, postH - 0.05],
    ],
    8,
    Math.PI / 8 + yaw,
  );
  compose(tm, px, 0, pz, 0, 0, 0, 1);
  iron.add(band, tm, IRON);
  band.dispose();
  const armY = postH - 0.08;
  // the arm runs from the post toward the bed, with a scroll at the end
  const arm = box(armLen + 0.02, 0.018, 0.014);
  addIron(arm, px + toBed.x * (armLen * 0.5), armY, pz + toBed.z * (armLen * 0.5), yaw - Math.PI / 2, 0, 0);
  const scroll = lathe(
    [
      [0.028, -0.008],
      [0.03, 0],
      [0.028, 0.008],
    ],
    10,
  );
  // the scroll is a small ring standing on edge at the arm's tip
  compose(tm, lamp.x, armY, lamp.z, yaw, Math.PI / 2, 0, 1);
  iron.add(scroll, tm, IRON);
  scroll.dispose();
  const braceLen = Math.hypot(armLen * 0.62, 0.2);
  const brace = box(braceLen, 0.012, 0.01);
  addIron(
    brace,
    px + toBed.x * (armLen * 0.31),
    armY - 0.1,
    pz + toBed.z * (armLen * 0.31),
    yaw - Math.PI / 2,
    0,
    Math.atan2(0.2, armLen * 0.62),
  );
  // hook the lamp hangs by
  const hook = box(0.008, 0.06, 0.008);
  addIron(hook, lamp.x, armY - 0.035, lamp.z, 0, 0, 0);

  // the lamp: base plate, four corner posts, top plate, a curved roof, a finial
  const L = 0.055; // half width of the body
  const bodyH = 0.15;
  const base0 = lampY - bodyH / 2;
  const plate = lathe(
    [
      [L * 1.5, base0 - 0.012],
      [L * 1.55, base0 - 0.004],
      [L * 1.35, base0],
      [0, base0],
    ],
    4,
    Math.PI / 4 + yaw,
  );
  compose(tm, lamp.x, 0, lamp.z, 0, 0, 0, 1);
  iron.add(plate, tm, IRON);
  plate.dispose();
  for (let k = 0; k < 4; k++) {
    const a = yaw + Math.PI / 4 + (k * Math.PI) / 2;
    const corner = box(0.009, bodyH, 0.009);
    addIron(corner, lamp.x + Math.cos(a) * L * 1.414 * 0.98, lampY, lamp.z + Math.sin(a) * L * 1.414 * 0.98, yaw, 0, 0);
  }
  const topY = base0 + bodyH;
  const topPlate = lathe(
    [
      [L * 1.5, topY],
      [L * 1.52, topY + 0.006],
      [L * 1.4, topY + 0.01],
      [0, topY + 0.01],
    ],
    4,
    Math.PI / 4 + yaw,
  );
  compose(tm, lamp.x, 0, lamp.z, 0, 0, 0, 1);
  iron.add(topPlate, tm, IRON);
  topPlate.dispose();
  // roof: a four-sided hip with a concave sweep, like a little pagoda
  const roofProfile: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    roofProfile.push([L * 1.65 * (1 - Math.pow(t, 0.8)), topY + 0.012 + 0.07 * t]);
  }
  const roof = lathe(roofProfile, 4, Math.PI / 4 + yaw);
  iron.add(roof, tm, IRON_LIT);
  roof.dispose();
  const finial = lathe(
    [
      [0.004, topY + 0.08],
      [0.012, topY + 0.095],
      [0.012, topY + 0.1],
      [0.004, topY + 0.108],
      [0.0, topY + 0.115],
    ],
    8,
  );
  iron.add(finial, tm, IRON);
  finial.dispose();

  // glass: four panes just inside the corner posts
  const glass = new GeoBuilder();
  for (let k = 0; k < 4; k++) {
    const a = yaw + (k * Math.PI) / 2;
    const pane = new THREE.PlaneGeometry(L * 2 - 0.012, bodyH - 0.012);
    compose(tm, lamp.x + Math.sin(a) * L * 0.96, lampY, lamp.z + Math.cos(a) * L * 0.96, a, 0, 0, 1);
    glass.add(pane, tm, WHITE);
    pane.dispose();
  }

  // the candle and its flame
  const candle = new GeoBuilder();
  const wax = lathe(
    [
      [0.011, base0],
      [0.012, base0 + 0.02],
      [0.011, base0 + 0.062],
      [0.008, base0 + 0.068],
      [0.0, base0 + 0.068],
    ],
    10,
  );
  compose(tm, lamp.x, 0, lamp.z, 0, 0, 0, 1);
  candle.add(wax, tm, WAX);
  wax.dispose();
  const wick = box(0.0025, 0.012, 0.0025);
  compose(tm, lamp.x, base0 + 0.072, lamp.z, 0, 0, 0, 1);
  candle.add(wick, tm, WICK);
  wick.dispose();

  const flame = new GeoBuilder();
  const card = makeFlameCard();
  for (let k = 0; k < 2; k++) {
    compose(tm, lamp.x, base0 + 0.074, lamp.z, (k * Math.PI) / 2, 0, 0, 1);
    flame.add(card, tm, WHITE);
  }
  card.dispose();

  return {
    wood: wood.build(),
    plinth: stone.build(),
    iron: iron.build(),
    glass: glass.build(),
    candle: candle.build(),
    flame: flame.build(),
    lamp,
    wick: new THREE.Vector3(lamp.x, base0 + 0.074, lamp.z),
  };
}

/** A teardrop card, base at the origin, 3 cm tall, white-gold at the core and orange at the tip. */
function makeFlameCard(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const col: number[] = [];
  const rows = 6;
  const core = new THREE.Color("#fff6d0");
  const tip = new THREE.Color("#ff8a2a");
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const w = 0.006 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - 0.6 * t);
    for (const u of [-1, 1]) {
      pos.push(u * w, t * 0.03, 0);
      uv.push(u * 0.5 + 0.5, t);
      tc.copy(core).lerp(tip, smoothstep(0.3, 1, t));
      col.push(tc.r, tc.g, tc.b);
    }
  }
  for (let j = 0; j < rows; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ====================================================================== */
/* Companion plant parts                                                    */
/* ====================================================================== */

/** Unit tapered stem along +y, base at the origin; scale (r, length, r) per instance. */
export function makeUnitStem(tubular: number, radial: number): THREE.BufferGeometry {
  return makeStemGeometry(1, 1, 0.55, 0, 0, tubular, radial);
}

/**
 * One lavender floret: three diamond cards crossed about +y, a centimetre
 * tall, darker at the calyx. Instance colour carries the owner's violet.
 */
export function makeFloretGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const card = new THREE.BufferGeometry();
  card.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -0.005, 0.006, 0, 0.005, 0.006, 0, 0, 0.012, 0], 3));
  card.setAttribute("uv", new THREE.Float32BufferAttribute([0.5, 0, 0, 0.5, 1, 0.5, 0.5, 1], 2));
  card.setIndex([0, 2, 1, 1, 2, 3]);
  card.computeVertexNormals();
  const fn: ColorFn = (v, _n, out) => {
    out.setScalar(lerp(0.55, 1.05, smoothstep(0, 0.012, v.y)));
  };
  for (let k = 0; k < 3; k++) {
    compose(tm, 0, 0, 0, (k * Math.PI) / 3, 0, 0, 1);
    b.add(card, tm, WHITE, fn);
  }
  card.dispose();
  return b.build();
}

/** The open bloom form of a petal from makePetalGeometry, as a plain static mesh. */
export function makeOpenPetalGeometry(shape: PetalShape, seed: number, nu: number, nv: number): THREE.BufferGeometry {
  const bud = makePetalGeometry(shape, seed, nu, nv);
  const open = new THREE.BufferGeometry();
  open.setAttribute("position", bud.morphAttributes.position[0]);
  open.setAttribute("normal", bud.morphAttributes.normal[0]);
  open.setAttribute("uv", bud.getAttribute("uv"));
  const index = bud.getIndex();
  if (index) open.setIndex(index);
  open.computeBoundingSphere();
  return open;
}

const DISC_TOP = new THREE.Color("#ffd65a");
const DISC_EDGE = new THREE.Color("#c97f16");

/** A flower's centre: a flattened, knobbly dome of florets, unit radius, instance colour tints it. */
export function makeDiscGeometry(detail: number): THREE.BufferGeometry {
  const dome = smoothIcosphere(detail);
  const p = dome.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = Math.max(-0.15, p.getY(i));
    const z = p.getZ(i);
    const d = 1 + 0.08 * vnoise2(x * 6 + 1, z * 6 + y * 5);
    p.setXYZ(i, x * d, y * 0.45 * d, z * d);
  }
  p.needsUpdate = true;
  dome.computeVertexNormals();
  const b = new GeoBuilder();
  const fn: ColorFn = (v, _n, out) => {
    const r = Math.hypot(v.x, v.z);
    out.copy(DISC_TOP).lerp(DISC_EDGE, smoothstep(0.35, 1, r));
    out.multiplyScalar(0.85 + 0.3 * (0.5 + 0.5 * vnoise2(v.x * 40, v.z * 40 + 3)));
  };
  b.add(dome, tm.identity(), WHITE, fn);
  dome.dispose();
  return b.build();
}

export interface FrondSpec {
  length: number;
  pinnae: number;
  /** tessellation of each pinna */
  nu: number;
  nv: number;
  seed: number;
}

/**
 * A fern frond: a slender rachis arching toward +z with pairs of narrow
 * serrated pinnae down its length, widest a third of the way up. Base at the
 * origin, growing along +y, upper face toward -z after the pinna flip.
 */
export function makeFrondGeometry(spec: FrondSpec): THREE.BufferGeometry {
  const { length, pinnae, nu, nv, seed } = spec;
  const dz = length * 0.42;
  const b = new GeoBuilder();
  const rachis = makeStemGeometry(length, 0.0035, 0.0012, 0, dz, 10, 4);
  // the rachis samples the leaf texture at its midrib base, a stem-green
  const ru = rachis.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < ru.count; i++) ru.setXY(i, 0.5, 0.08);
  b.add(rachis, tm.identity(), WHITE);
  rachis.dispose();
  const Lp = length * 0.24;
  const m2 = new THREE.Matrix4();
  const m3 = new THREE.Matrix4();
  for (let i = 0; i < pinnae; i++) {
    const t = 0.14 + (0.84 * i) / (pinnae - 1);
    const lp = Lp * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 0.92)));
    const wp = lp * 0.3;
    const at = stemPointAt(length, 0, dz, t);
    m2.compose(at.position, at.quaternion, ts.set(1, 1, 1));
    for (const side of [-1, 1]) {
      const leaf = makeLeafGeometry({ length: lp, width: wp, serration: 0.9, fold: 0.12, tip: 0.85 }, seed + i, nu, nv);
      // spread sideways from the rachis, droop a little, flipped so the upper face shows
      te.set(0.3 + 0.1 * Math.sin(i * 1.7 + seed), Math.PI, side * 1.12, "ZXY");
      tq.setFromEuler(te);
      m3.compose(tv.set(0, 0, 0), tq, ts.set(1, 1, 1));
      tm.multiplyMatrices(m2, m3);
      b.add(leaf, tm, WHITE);
      leaf.dispose();
    }
  }
  return b.build();
}

/**
 * A hosta leaf on its petiole: the petiole leans out from the crown, the broad
 * ribbed blade turns over at its end to lie face-up. Base at the origin.
 */
export function makeHostaLeafGeometry(nu: number, nv: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const petLen = 0.11;
  const petiole = makeStemGeometry(petLen, 0.0045, 0.003, 0, 0.035, 6, 5);
  const pu = petiole.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pu.count; i++) pu.setXY(i, 0.5, 0.05);
  b.add(petiole, tm.identity(), WHITE);
  petiole.dispose();
  const blade = makeLeafGeometry({ length: 0.19, width: 0.15, serration: 0, fold: 0.45, tip: 0.5 }, 5, nu, nv);
  const end = stemPointAt(petLen, 0, 0.035, 1);
  const m2 = new THREE.Matrix4().compose(end.position, end.quaternion, ts.set(1, 1, 1));
  te.set(1.05, Math.PI, 0, "XYZ");
  tq.setFromEuler(te);
  const m3 = new THREE.Matrix4().compose(tv.set(0, 0, 0), tq, ts.set(1, 1, 1));
  tm.multiplyMatrices(m2, m3);
  b.add(blade, tm, WHITE);
  blade.dispose();
  return b.build();
}

/** Three round leaflets on a short stalk: a sprig of clover about 2 cm across. */
export function makeCloverSprigGeometry(nu: number, nv: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const stalk = makeStemGeometry(0.018, 0.0012, 0.0008, 0, 0.004, 3, 4);
  const su = stalk.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < su.count; i++) su.setXY(i, 0.5, 0.05);
  b.add(stalk, tm.identity(), WHITE);
  stalk.dispose();
  const leaflet = makeLeafGeometry({ length: 0.017, width: 0.016, serration: 0, fold: 0.18, tip: 0.06 }, 2, nu, nv);
  for (let k = 0; k < 3; k++) {
    const yaw = (k / 3) * Math.PI * 2;
    // each leaflet grows out and up from the stalk top, face to the sky
    compose(tm, Math.sin(yaw) * 0.002, 0.017, Math.cos(yaw) * 0.002, yaw, 1.25, 0, -1, 1, -1);
    b.add(leaflet, tm, WHITE);
  }
  leaflet.dispose();
  return b.build();
}

/**
 * A closed flower bud: a smooth teardrop one unit tall, fattest below the
 * middle and drawn to a point, base at the origin. Scale (r, h, r) per instance.
 */
export function makeBudGeometry(radial: number): THREE.BufferGeometry {
  const rows = 8;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.72)) * (1 - 0.3 * t);
    pts.push(new THREE.Vector2(i === 0 || i === rows ? 0 : r, t));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** Lavender's narrow, rolled, silvery leaf, about five centimetres long. */
export function makeLavenderLeafGeometry(nu: number, nv: number): THREE.BufferGeometry {
  return makeLeafGeometry({ length: 0.05, width: 0.0065, serration: 0, fold: 0.4, tip: 0.9 }, 11, nu, nv);
}

export type FlowerLeafKind = "feathery" | "spoon";

/** Cosmos foliage is finely cut and narrow; daisy leaves are small blunt spoons. */
export function makeFlowerLeafGeometry(kind: FlowerLeafKind, nu: number, nv: number): THREE.BufferGeometry {
  return kind === "feathery"
    ? makeLeafGeometry({ length: 0.055, width: 0.014, serration: 1.0, fold: 0.2, tip: 0.85 }, 7, nu, nv)
    : makeLeafGeometry({ length: 0.04, width: 0.018, serration: 0.6, fold: 0.3, tip: 0.35 }, 9, nu, nv);
}

/* ====================================================================== */
/* The owner's planting plan                                               */
/* ====================================================================== */

export interface Placement {
  m: THREE.Matrix4;
  c: THREE.Color;
}

export interface CompanionBudget {
  lavenderPlants: number;
  spikesPerPlant: number;
  whorls: number;
  lavenderLeaves: number;
  cosmos: number;
  daisies: number;
  ferns: number;
  fronds: number;
  pinnae: number;
  hostas: number;
  hostaLeaves: number;
  clover: number;
  petalTess: [number, number];
  leafTess: [number, number];
  pinnaTess: [number, number];
  stoneDetail: number;
  stoneFineDetail: number;
  flagSides: number;
  bedRings: number;
  bedSegs: number;
  discDetail: number;
}

export const COMPANION_BUDGET: Record<Quality, CompanionBudget> = {
  cinematic: {
    lavenderPlants: 4,
    spikesPerPlant: 16,
    whorls: 7,
    lavenderLeaves: 22,
    cosmos: 12,
    daisies: 16,
    ferns: 3,
    fronds: 8,
    pinnae: 11,
    hostas: 4,
    hostaLeaves: 10,
    clover: 240,
    petalTess: [5, 8],
    leafTess: [5, 8],
    pinnaTess: [3, 6],
    stoneDetail: 2,
    stoneFineDetail: 3,
    flagSides: 14,
    bedRings: 36,
    bedSegs: 112,
    discDetail: 2,
  },
  balanced: {
    lavenderPlants: 3,
    spikesPerPlant: 12,
    whorls: 6,
    lavenderLeaves: 16,
    cosmos: 9,
    daisies: 12,
    ferns: 2,
    fronds: 7,
    pinnae: 9,
    hostas: 3,
    hostaLeaves: 9,
    clover: 140,
    petalTess: [4, 6],
    leafTess: [4, 6],
    pinnaTess: [3, 5],
    stoneDetail: 2,
    stoneFineDetail: 2,
    flagSides: 12,
    bedRings: 28,
    bedSegs: 80,
    discDetail: 1,
  },
  lite: {
    lavenderPlants: 2,
    spikesPerPlant: 10,
    whorls: 5,
    lavenderLeaves: 12,
    cosmos: 6,
    daisies: 8,
    ferns: 2,
    fronds: 5,
    pinnae: 7,
    hostas: 2,
    hostaLeaves: 7,
    clover: 60,
    petalTess: [3, 5],
    leafTess: [3, 5],
    pinnaTess: [2, 4],
    stoneDetail: 1,
    stoneFineDetail: 1,
    flagSides: 10,
    bedRings: 20,
    bedSegs: 56,
    discDetail: 1,
  },
};

export interface Palette {
  lavender: THREE.Color;
  lavenderTip: THREE.Color;
  cosmos: [THREE.Color, THREE.Color];
  daisy: THREE.Color;
  disc: THREE.Color;
  budGreen: THREE.Color;
  fern: { base: string; tip: string; vein: string };
  hosta: { base: string; tip: string; vein: string };
  flowerLeaf: { base: string; tip: string; vein: string };
  clover: { base: string; tip: string; vein: string };
}

export interface CompanionPlan {
  palette: Palette;
  lavStems: Placement[];
  lavFlorets: Placement[];
  lavLeaves: Placement[];
  flowerStems: Placement[];
  daisyPetals: Placement[];
  cosmosPetals: Placement[];
  discs: Placement[];
  buds: Placement[];
  feathery: Placement[];
  spoon: Placement[];
  fronds: [Placement[], Placement[]];
  hostaLeaves: Placement[];
  clover: Placement[];
  /** the open petal shapes the plan was laid out for */
  daisyPetal: PetalShape;
  cosmosPetal: PetalShape;
  frondLength: number;
}

const COSMOS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["#f28ab9", "#d8407f"],
  ["#fbf3fb", "#f3b4d2"],
  ["#e75d9a", "#f6c3dc"],
  ["#ff8e3c", "#ffc24a"],
  ["#f7c9de", "#ffffff"],
];
const DAISY_WHITES = ["#ffffff", "#fff7ea", "#fff2cf"] as const;
const FERN_GREENS = [
  { base: "#1f5a2a", tip: "#4f9a3c", vein: "#9fd07a" },
  { base: "#2a6a30", tip: "#6cb04a", vein: "#b8e08a" },
] as const;
const HOSTA_GREENS = [
  { base: "#2d6b4e", tip: "#7fb86a", vein: "#b5dca0" },
  { base: "#3f7a2e", tip: "#a9d35e", vein: "#e6f2b0" },
  { base: "#2a5f5a", tip: "#86b88f", vein: "#cfe8c8" },
] as const;

/** The hero stands here; companions keep out so the stem and mound stay in view. */
const HERO_CLEAR = 0.36;
const LANTERN_CLEAR = 0.16;

function placementAt(m: THREE.Matrix4, c: THREE.Color): Placement {
  return { m: m.clone(), c: c.clone() };
}

const ma = new THREE.Matrix4();
const mb = new THREE.Matrix4();
const mc = new THREE.Matrix4();

/**
 * Where everything in the bed goes for one owner. Colours, counts and every
 * offset come from Rng(seed + "|garden"); nothing here hides the hero from
 * the default camera: in front of and beside it only low plants stand, the
 * taller ones gather behind.
 */
export function planCompanions(seed: string, budget: CompanionBudget): CompanionPlan {
  const rng = new Rng(seed + "|garden");
  const lavHue = rng.range(0.7, 0.79);
  const palette: Palette = {
    lavender: new THREE.Color().setHSL(lavHue, rng.range(0.5, 0.65), rng.range(0.5, 0.6)),
    lavenderTip: new THREE.Color().setHSL(lavHue - 0.03, 0.6, 0.72),
    cosmos: (() => {
      const pair = rng.pick(COSMOS_PAIRS);
      return [new THREE.Color(pair[0]), new THREE.Color(pair[1])] as [THREE.Color, THREE.Color];
    })(),
    daisy: new THREE.Color(rng.pick(DAISY_WHITES)),
    disc: new THREE.Color().setHSL(rng.range(0.1, 0.13), 0.9, rng.range(0.52, 0.6)),
    budGreen: new THREE.Color("#5c8a3c"),
    fern: rng.pick(FERN_GREENS),
    hosta: rng.pick(HOSTA_GREENS),
    flowerLeaf: { base: "#2f6a2c", tip: "#5f9c43", vein: "#a6d484" },
    clover: { base: "#2f7a2e", tip: "#6fb354", vein: "#cfeab0" },
  };

  const plan: CompanionPlan = {
    palette,
    lavStems: [],
    lavFlorets: [],
    lavLeaves: [],
    flowerStems: [],
    daisyPetals: [],
    cosmosPetals: [],
    discs: [],
    buds: [],
    feathery: [],
    spoon: [],
    fronds: [[], []],
    hostaLeaves: [],
    clover: [],
    daisyPetal: { length: 0.03, width: 0.011, bend: 0.12, cup: 0.35, ruffle: 0.25, tip: 0.5 },
    cosmosPetal: { length: 0.034, width: 0.021, bend: 0.18, cup: 0.25, ruffle: 0.35, tip: 0.15 },
    frondLength: 0.34,
  };

  const [lx, , lz] = LAYOUT.lantern.position;
  const taken: { x: number; z: number; r: number }[] = [];
  /** A spot in the mulch clear of the hero, the post, the stones and earlier plants. */
  const findSpot = (zMin: number, zMax: number, xMax: number, radius: number, maxRho: number, tries = 60) => {
    for (let k = 0; k < tries; k++) {
      const x = rng.range(-xMax, xMax);
      const z = rng.range(zMin, zMax);
      if (bedRho(x, z) > maxRho) continue;
      if (Math.hypot(x, z) < HERO_CLEAR + radius * 0.5) continue;
      if (Math.hypot(x - lx, z - lz) < LANTERN_CLEAR + radius) continue;
      let clash = false;
      for (const t of taken) {
        if (Math.hypot(x - t.x, z - t.z) < t.r + radius) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      taken.push({ x, z, r: radius });
      return { x, z };
    }
    return null;
  };

  const surface = (x: number, z: number) => bedSurfaceY(x, z) - 0.006;
  const c = new THREE.Color();

  // --- lavender: clumps of spikes across the back of the bed ---
  for (let p = 0; p < budget.lavenderPlants; p++) {
    const spot = findSpot(-0.88, -0.5, 0.62, 0.16, 0.82);
    if (!spot) break;
    const y0 = surface(spot.x, spot.z);
    for (let s = 0; s < budget.spikesPerPlant; s++) {
      const ox = rng.gauss() * 0.045;
      const oz = rng.gauss() * 0.045;
      const x = spot.x + ox;
      const z = spot.z + oz;
      const L = rng.range(0.26, 0.42);
      const r = rng.range(0.0022, 0.003);
      const outward = Math.atan2(ox, oz) + rng.range(-0.5, 0.5);
      const lean = rng.range(0.08, 0.38) * Math.min(1, Math.hypot(ox, oz) / 0.05 + 0.3);
      compose(ma, x, y0, z, outward, lean, 0, r, L, r);
      c.setHSL(0.25, 0.25, rng.range(0.42, 0.5));
      plan.lavStems.push(placementAt(ma, c));
      // the spike: whorls of florets up the top third
      const dirx = Math.sin(lean) * Math.sin(outward);
      const diry = Math.cos(lean);
      const dirz = Math.sin(lean) * Math.cos(outward);
      for (let w = 0; w < budget.whorls; w++) {
        const t = 0.6 + (0.4 * w) / (budget.whorls - 1);
        const h = L * t;
        const n = w === budget.whorls - 1 ? 2 : 3;
        for (let k = 0; k < n; k++) {
          const a = w * 1.1 + (k * Math.PI * 2) / n + rng.range(-0.3, 0.3);
          const fr = 0.0045;
          compose(
            ma,
            x + dirx * h + Math.sin(a) * fr,
            y0 + diry * h,
            z + dirz * h + Math.cos(a) * fr,
            a,
            0.55,
            0,
            rng.range(0.85, 1.15),
          );
          c.copy(palette.lavender).lerp(palette.lavenderTip, 0.6 * t * rng.next());
          c.multiplyScalar(rng.range(0.85, 1.1));
          plan.lavFlorets.push(placementAt(ma, c));
        }
      }
    }
    // grey-green foliage round the crown
    for (let k = 0; k < budget.lavenderLeaves; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0.01, 0.07);
      compose(ma, spot.x + Math.sin(a) * d, y0 + rng.range(0.005, 0.05), spot.z + Math.cos(a) * d, a, rng.range(0.5, 1.2), 0, -1, 1, -1);
      c.setHSL(0.28, 0.2, rng.range(0.45, 0.58));
      plan.lavLeaves.push(placementAt(ma, c));
    }
  }

  // --- cosmos: tall, at the back corners; daisies: short, at the sides and front corners ---
  const flower = (kind: "cosmos" | "daisy", x: number, z: number) => {
    const y0 = surface(x, z);
    const cosmos = kind === "cosmos";
    const L = cosmos ? rng.range(0.36, 0.52) : rng.range(0.16, 0.26);
    const r = cosmos ? rng.range(0.0028, 0.0034) : rng.range(0.0022, 0.0027);
    // lean mostly toward the viewer so most faces show
    const yaw = rng.next() < 0.7 ? rng.range(-1.0, 1.0) : rng.range(0, Math.PI * 2);
    const lean = rng.range(0.06, 0.28);
    compose(ma, x, y0, z, yaw, lean, 0, r, L, r);
    c.setHSL(0.27, 0.35, rng.range(0.32, 0.42));
    plan.flowerStems.push(placementAt(ma, c));
    const dirx = Math.sin(lean) * Math.sin(yaw);
    const diry = Math.cos(lean);
    const dirz = Math.sin(lean) * Math.cos(yaw);
    const hx = x + dirx * L;
    const hy = y0 + diry * L;
    const hz = z + dirz * L;
    const isBud = rng.next() < 0.18;
    const discR = cosmos ? rng.range(0.009, 0.011) : rng.range(0.011, 0.014);
    if (isBud) {
      compose(ma, hx, hy, hz, yaw, lean, 0, discR * 0.8, discR * 2.2, discR * 0.8);
      plan.buds.push(placementAt(ma, c.copy(palette.budGreen)));
    } else {
      // the head nods a little further over than the stem leans
      const nod = lean + rng.range(0.2, 0.5);
      compose(ma, hx, hy, hz, yaw, nod, 0, 1);
      compose(mb, 0, 0, 0, 0, 0, 0, discR);
      mc.multiplyMatrices(ma, mb);
      plan.discs.push(placementAt(mc, c.copy(palette.disc).multiplyScalar(rng.range(0.9, 1.08))));
      const petals = cosmos ? 8 : rng.int(11, 13);
      const open = cosmos ? rng.range(1.25, 1.42) : rng.range(1.3, 1.5);
      const tint = cosmos ? c.copy(palette.cosmos[0]).lerp(palette.cosmos[1], rng.next()) : c.copy(palette.daisy);
      const scale = rng.range(0.9, 1.1) * (cosmos ? 1 : 0.95);
      for (let k = 0; k < petals; k++) {
        const psi = (k / petals) * Math.PI * 2 + rng.range(-0.06, 0.06);
        compose(mb, 0, 0.002, 0, psi, 0, 0, 1);
        mc.multiplyMatrices(ma, mb);
        compose(mb, 0, 0, discR * 0.45, 0, open + rng.range(-0.08, 0.08), 0, scale);
        mb.premultiply(mc);
        (cosmos ? plan.cosmosPetals : plan.daisyPetals).push(placementAt(mb, tint.clone().multiplyScalar(rng.range(0.94, 1.04))));
      }
    }
    // foliage: feathery leaves up a cosmos stem, a spoon rosette at a daisy's foot
    const leaves = cosmos ? rng.int(2, 3) : rng.int(4, 6);
    for (let k = 0; k < leaves; k++) {
      const t = cosmos ? rng.range(0.25, 0.65) : rng.range(0.02, 0.1);
      const a = rng.range(0, Math.PI * 2);
      const s = cosmos ? rng.range(0.9, 1.3) : rng.range(0.8, 1.2);
      compose(ma, x + dirx * L * t, y0 + diry * L * t, z + dirz * L * t, a, rng.range(0.9, 1.3), 0, -s, s, -s);
      c.setScalar(rng.range(0.85, 1.05));
      (cosmos ? plan.feathery : plan.spoon).push(placementAt(ma, c));
    }
  };
  for (let i = 0; i < budget.cosmos; i++) {
    const side = rng.sign();
    const spot = findSpot(-0.78, -0.3, 0.74, 0.06, 0.83, 40);
    if (!spot) break;
    if (Math.abs(spot.x) < 0.25 && side > 0) spot.x += 0.3 * Math.sign(spot.x || 1);
    flower("cosmos", spot.x, spot.z);
  }
  for (let i = 0; i < budget.daisies; i++) {
    // sides and the front corners: low enough never to cover the hero
    const spot = findSpot(-0.45, 0.14, 0.72, 0.05, 0.84, 40);
    if (!spot) break;
    if (spot.z > -0.15 && Math.abs(spot.x) < 0.42) continue;
    flower("daisy", spot.x, spot.z);
  }

  // --- ferns: at the back, one by the lantern ---
  for (let f = 0; f < budget.ferns; f++) {
    const spot =
      f === 0
        ? findSpot(-0.72, -0.5, 0.74, 0.14, 0.8, 40)
        : findSpot(-0.86, -0.55, 0.6, 0.14, 0.8, 40);
    if (!spot) break;
    const y0 = surface(spot.x, spot.z);
    const variant = f % 2;
    for (let k = 0; k < budget.fronds; k++) {
      const a = (k / budget.fronds) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const pitch = rng.range(0.45, 1.05);
      const s = rng.range(0.75, 1.1);
      compose(ma, spot.x + Math.sin(a) * 0.012, y0 + 0.01, spot.z + Math.cos(a) * 0.012, a, pitch, 0, s);
      c.setScalar(rng.range(0.85, 1.05));
      plan.fronds[variant].push(placementAt(ma, c));
    }
  }

  // --- hostas: broad mounds either side behind the hero ---
  for (let h = 0; h < budget.hostas; h++) {
    const spot = findSpot(-0.62, -0.2, 0.62, 0.13, 0.8, 40);
    if (!spot) break;
    if (Math.abs(spot.x) < 0.3) spot.x = 0.38 * Math.sign(spot.x || 1);
    const y0 = surface(spot.x, spot.z);
    for (let k = 0; k < budget.hostaLeaves; k++) {
      const a = (k / budget.hostaLeaves) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const ring = k % 2;
      const lean = ring === 0 ? rng.range(0.55, 0.85) : rng.range(0.25, 0.5);
      const s = (ring === 0 ? 1 : 0.8) * rng.range(0.85, 1.1);
      compose(ma, spot.x + Math.sin(a) * 0.01, y0 + 0.01, spot.z + Math.cos(a) * 0.01, a, lean, rng.range(-0.15, 0.15), s);
      c.setScalar(rng.range(0.85, 1.05));
      plan.hostaLeaves.push(placementAt(ma, c));
    }
  }

  // --- clover: along the stones inside the bed, spilling over onto the lawn, and round the saucer ---
  for (let i = 0; i < budget.clover; i++) {
    const pick = rng.next();
    let x: number;
    let z: number;
    const a = rng.range(0, Math.PI * 2);
    if (pick < 0.5) {
      const rr = rng.range(0.66, 0.9);
      x = BED.center[0] + Math.cos(a) * BED.rx * rr;
      z = BED.center[2] + Math.sin(a) * BED.rz * rr;
    } else if (pick < 0.82) {
      const rr = rng.range(1.02, 1.16);
      x = BED.center[0] + Math.cos(a) * BED.rx * rr;
      z = BED.center[2] + Math.sin(a) * BED.rz * rr;
    } else {
      const rr = rng.range(0.5, 0.6);
      x = Math.cos(a) * rr;
      z = Math.sin(a) * rr;
    }
    if (Math.hypot(x - lx, z - lz) < 0.13) continue;
    const y = Math.max(0, bedSurfaceY(x, z)) - 0.004;
    compose(ma, x, y, z, rng.range(0, Math.PI * 2), rng.range(-0.15, 0.15), 0, rng.range(0.8, 1.35));
    c.setScalar(rng.range(0.8, 1.1));
    plan.clover.push(placementAt(ma, c));
  }

  return plan;
}
