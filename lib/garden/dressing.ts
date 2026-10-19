// Procedural builders for the near garden: the raised bed's surface, the
// kerb of laid fieldstones and its spade-cut edge, the flagstone path and the
// moss in its joints, the lantern, the watering can, and the parts of the
// companion plants, plus the deterministic plan that places them for one
// owner; and the shader patches the garden's materials share (wind sway with
// growth staging, the golden-hour rim, the lite tier's lantern light).
// Everything here is pure geometry and numbers: no React, nothing read per
// frame. The owner's seed is read once by the caller and passed in.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LAYOUT } from "@/lib/garden/layout";
import type { Quality } from "@/lib/garden/store";
import {
  makeLeafGeometry,
  makePetalGeometry,
  makeStemGeometry,
  stemPointAt,
  type LeafShape,
  type PetalShape,
} from "@/lib/plant/geometry";
import { Rng, clamp01, lerp, smoothstep, vnoise2 } from "@/lib/plant/prng";

/* ====================================================================== */
/* Wind sway, shared by the grass and the companion plants                 */
/* ====================================================================== */

/**
 * Shared by every compiled sway program; written once per frame from env.
 * uGrow and uOpen stage the companion planting by the hero's growth: uGrow
 * is the companions' height as a share of full (they are squashed toward the
 * mulch while the hero is young), uOpen how far their flowers are out.
 */
export const swayUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.5 },
  uBacklight: { value: 0.3 },
  uGrow: { value: 1 },
  uOpen: { value: 1 },
};
/** The height (about the mulch's top) toward which staged companions are squashed. */
const STAGE_BASE = 0.11;

// Vertex: the part bends with the wind in the mesh frame after the instance
// matrix (so every blade leans the same way), by the square of its height
// fraction so roots stay planted. Grass measures height along its own blade;
// a plant measures the instance's world height so a stem and the flower head
// riding its tip bend together. `hh` also feeds the backlight in the fragment.
const SWAY_VERT_COMMON =
  "#include <common>\nuniform float uTime; uniform float uWind; uniform float uGrow; uniform float uOpen; varying float vHh;";
function swayVertex(height: number, amount: number, world: boolean, stage: SwayStage | undefined): string {
  const h = height.toFixed(4);
  return (
    "#include <begin_vertex>\n" +
    // a flower part closes toward its own base (a petal to the disc, a floret to its stalk)
    (stage === "flower" ? "transformed *= mix(0.3, 1.0, uOpen);\n" : "") +
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
// here and the instance line inside it patched. Staged parts are also squashed
// toward the mulch by uGrow, after the instance transform, so every stem and
// the head riding its tip shrink together.
function swayProject(stage: SwayStage | undefined): string {
  const base = STAGE_BASE.toFixed(3);
  // only what stands above the mulch is squashed, so low parts at the kerb stay where they are
  const squash = stage ? ` mvPosition.y -= (1.0 - uGrow) * max(mvPosition.y - ${base}, 0.0);` : "";
  return THREE.ShaderChunk.project_vertex.replace(
    "mvPosition = instanceMatrix * mvPosition;",
    "mvPosition = instanceMatrix * mvPosition; mvPosition.xz += swayOff;" + squash,
  );
}

// Fragment: leaves and blades are thin and translucent, so a back face is lit
// like the front (no normal flip), and the sun behind one glows through its tip.
const SWAY_FRAG_COMMON = "#include <common>\nvarying float vHh; uniform float uBacklight; uniform float uOpen;";
/** A closed flower is a small green bud: its colour comes in as it opens. */
const BUD_COLOR =
  "#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(0.16, 0.26, 0.09), diffuseColor.rgb, smoothstep(0.12, 0.85, uOpen));";
const NORMAL_NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", "");
const BACKLIGHT =
  "#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n" +
  "{ vec3 bV = normalize(vViewPosition); vec3 bL = directionalLights[0].direction;\n" +
  "float back = pow(max(0.0, dot(-bV, bL)), 4.0) * (0.1 + 0.9 * vHh);\n" +
  "reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * back * uBacklight; }\n#endif";

/** How a companion part follows the hero's growth: a plant is squashed low, a flower also closes. */
export type SwayStage = "plant" | "flower";

export interface SwayOptions {
  /** metres: the height at which the sway reaches full amplitude */
  height: number;
  /** 1 = grass; stems that stand taller take a little more */
  amount: number;
  /** measure height in world space (plants) instead of along the part (blades) */
  world: boolean;
  /** staged by the hero's growth (companions only; grass is never staged) */
  stage?: SwayStage;
}

function applySway(shader: THREE.WebGLProgramParametersWithUniforms, o: SwayOptions, lit: boolean) {
  shader.uniforms.uTime = swayUniforms.uTime;
  shader.uniforms.uWind = swayUniforms.uWind;
  shader.uniforms.uBacklight = swayUniforms.uBacklight;
  shader.uniforms.uGrow = swayUniforms.uGrow;
  shader.uniforms.uOpen = swayUniforms.uOpen;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", SWAY_VERT_COMMON)
    .replace("#include <begin_vertex>", swayVertex(o.height, o.amount, o.world, o.stage))
    .replace("#include <project_vertex>", swayProject(o.stage));
  if (lit) {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", SWAY_FRAG_COMMON)
      .replace("#include <normal_fragment_begin>", NORMAL_NO_FLIP)
      .replace("#include <lights_fragment_end>", BACKLIGHT);
    if (o.stage === "flower") shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", BUD_COLOR);
    patchGardenLight(shader, false);
  }
}

/** The program cache key for a set of sway options: the stage changes the shader, so it is part of it. */
function swayKey(key: string, o: SwayOptions): string {
  return o.stage ? `${key}|${o.stage}` : key;
}

/** A standard material whose instances sway in the wind; `key` must be unique per options. */
export function makeSwayMaterial(
  key: string,
  o: SwayOptions,
  params: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...params });
  m.onBeforeCompile = (shader) => applySway(shader, o, true);
  const k = swayKey(key, o);
  m.customProgramCacheKey = () => k;
  return m;
}

/** Shadow-pass twin of a sway material, so the cast shadows move with the parts. */
export function makeSwayDepthMaterial(key: string, o: SwayOptions): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => applySway(shader, o, false);
  const k = swayKey(key, o) + "-depth";
  m.customProgramCacheKey = () => k;
  return m;
}

/* ====================================================================== */
/* Light shared across the garden's own shader patches                      */
/* ====================================================================== */

/**
 * Written once per frame by Lights.tsx before anything reads it: how golden
 * the light is (0 by day and at night, 1 with the sun a few degrees up).
 */
export const lightState = { golden: 0 };

/**
 * The backlit rim: with a low sun behind the garden (it sets back-left of the
 * default camera) the camera sees the shadow side of everything, so the
 * silhouettes of the kerb's tops, the flagstones, the lantern post and the
 * arch catch a warm edge from the sun's direction. uRim is driven by Lights.
 */
export const rimUniforms = { uRim: { value: 0 } };

/**
 * The garden lantern as a light for the lite tier, which has no point light
 * (every lit pixel would pay for one all day): the same falloff as the real
 * lamp, evaluated only in the materials near it (lawn, bed, stones, path,
 * moss, grass, companions, the hero's leaves). uLampIntensity is 0 on the
 * other tiers, where the real light does the work; Lantern.tsx drives it.
 */
export const lampUniforms = {
  uLampPos: { value: new THREE.Vector3(0, 1, 0) },
  uLampColor: { value: new THREE.Color(1, 0.7, 0.4) },
  uLampIntensity: { value: 0 },
};

const RIM_COMMON = "#include <common>\nuniform float uRim;";
const RIM =
  "#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n" +
  "{ vec3 rV = normalize(vViewPosition); vec3 rL = directionalLights[0].direction;\n" +
  "  float edge = pow(1.0 - clamp(dot(normal, rV), 0.0, 1.0), 3.0);\n" +
  "  float behind = pow(max(0.0, dot(-rV, rL)), 1.5);\n" +
  "  float rim = edge * behind * clamp(dot(normal, rL) * 0.6 + 0.5, 0.0, 1.0);\n" +
  "  reflectedLight.directDiffuse += directionalLights[0].color * rim * uRim * (0.3 + 0.7 * diffuseColor.rgb); }\n#endif";

const LAMP_VERT_COMMON = "#include <common>\nvarying vec3 vLampWorld;";
// After worldpos_vertex, which every lit program has and the sway patch leaves alone.
const LAMP_VERT =
  "#include <worldpos_vertex>\n" +
  "{ vec4 lw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n lw = instanceMatrix * lw;\n#endif\n" +
  "  vLampWorld = (modelMatrix * lw).xyz; }";
const LAMP_FRAG_COMMON =
  "#include <common>\nvarying vec3 vLampWorld; uniform vec3 uLampPos; uniform vec3 uLampColor; uniform float uLampIntensity;";
// As three's own point light (decay 2, range 6 m) with a wrapped N.L, so the
// thin leaves facing away from the lamp still take a little of it.
const LAMP_FRAG =
  "#include <lights_fragment_end>\n" +
  "if (uLampIntensity > 0.0) { vec3 lv = uLampPos - vLampWorld; float ld = length(lv);\n" +
  "  vec3 lL = normalize((viewMatrix * vec4(lv, 0.0)).xyz);\n" +
  "  float win = pow(clamp(1.0 - pow(ld / 6.0, 4.0), 0.0, 1.0), 2.0);\n" +
  "  float wrapNL = clamp(dot(normal, lL) * 0.75 + 0.25, 0.0, 1.0);\n" +
  "  reflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * uLampColor * (uLampIntensity * win * wrapNL / max(ld * ld, 0.04)); }";

/** Splices the rim and the lite lamp into a lit material's compiled shader. */
export function patchGardenLight(shader: THREE.WebGLProgramParametersWithUniforms, rim: boolean) {
  shader.uniforms.uLampPos = lampUniforms.uLampPos;
  shader.uniforms.uLampColor = lampUniforms.uLampColor;
  shader.uniforms.uLampIntensity = lampUniforms.uLampIntensity;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", LAMP_VERT_COMMON)
    .replace("#include <worldpos_vertex>", LAMP_VERT);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", LAMP_FRAG_COMMON)
    .replace("#include <lights_fragment_end>", LAMP_FRAG);
  if (rim) {
    shader.uniforms.uRim = rimUniforms.uRim;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", RIM_COMMON)
      .replace("#include <lights_fragment_end>", RIM);
  }
}

/**
 * Gives a plain lit material the lite lamp and, with `rim`, the golden-hour
 * rim. Chains any onBeforeCompile already set; `key` must be unique per
 * shader variant.
 */
export function withGardenLight<T extends THREE.Material>(m: T, key: string, rim: boolean): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    patchGardenLight(shader, rim);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + "|" + key + (rim ? "|rim" : "|lamp");
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
/**
 * The mulch settles a little against the kerb: this share of the bed's
 * height is lost by the stones' inner face, so the mulch lies just under the
 * kerb's top and the bed reads as raised and full rather than sunk behind a
 * wall of stones.
 */
const KERB_SETTLE = 0.2;
/**
 * The bed rises toward the back, where a second course of stones holds it:
 * this much extra height at the back edge, so from the front the planting
 * steps up behind the hero like a terraced border.
 */
const BACK_RISE = 0.06;
/** Oval radius where the settling starts, and where the mulch meets the stones. */
const SETTLE_RHO = 0.76;
const KERB_RHO = 0.92;

/**
 * The watering basin round the hero's stem: a shallow ring trough on the
 * mound, inside the clearing the companions keep, so it shows from the
 * default camera. Small enough to stay on the plateau at the bed's front.
 */
const SAUCER_R = 0.17;
const SAUCER_W = 0.05;
const SAUCER_DEPTH = 0.011;

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
  // Settled toward the kerb, rising toward the back, then gone under the stones.
  const settle = 1 - KERB_SETTLE * smoothstep(SETTLE_RHO, KERB_RHO, rho);
  const back = BACK_RISE * smoothstep(0.1, 0.85, -(z - BED.center[2]) / BED.rz);
  let y = (BED.height * settle + back) * (1 - smoothstep(KERB_RHO - 0.02, 1.02, rho));
  const rim = (rho - 0.86) / 0.04;
  y += 0.006 * Math.exp(-rim * rim);
  const r = Math.hypot(x, z);
  const saucer = (r - SAUCER_R) / SAUCER_W;
  const basin = Math.exp(-saucer * saucer) * plateau;
  y += 0.024 * (1 - smoothstep(0.04, 0.34, r)) - SAUCER_DEPTH * basin;
  // a rougher floor in the basin, so standing water breaks into uneven puddles
  y += 0.004 * vnoise2(x * 31 + 7, z * 31 - 3) * basin;
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
      const saucer = (r - SAUCER_R) / (SAUCER_W * 1.1);
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
  const r0 = SAUCER_R - 2.2 * SAUCER_W;
  const r1 = SAUCER_R + 2.2 * SAUCER_W;
  // the level: the saucer floor where it lies on the plateau, plus a few millimetres
  let floor = 0;
  let n = 0;
  for (let j = 0; j < 48; j++) {
    const a = (j / 48) * Math.PI * 2;
    const x = Math.cos(a) * SAUCER_R;
    const z = Math.sin(a) * SAUCER_R;
    if (bedRho(x, z) > LIP_RHO - 0.04) continue;
    floor += bedSurfaceY(x, z);
    n++;
  }
  const level = (n > 0 ? floor / n : BED.height) + 0.003;
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
      // soft at the shallow margins, gone where the sheet would float
      col.push(1, 1, 1, onPlateau ? smoothstep(-0.001, 0.003, depth) * (1 - smoothstep(0.016, 0.024, depth)) : 0);
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
  /** the stone's centroid */
  x: number;
  z: number;
  /** radius of a circle of the same area, for quick distance tests */
  r: number;
  /** the outline as alternating world x, z, wound so its shoelace area in (x, z) is positive */
  outline: number[];
  /** small tilts of the top, radians, so no two stones lie in one plane */
  tiltX: number;
  tiltZ: number;
  /** how far the top stands above the soil */
  lift: number;
  tint: number;
  seed: number;
}

export interface PathPlan {
  /** the smoothed centreline, evenly spaced */
  line: THREE.Vector3[];
  stones: Flagstone[];
  /** half the width of the paving either side of the centreline */
  halfWidth: number;
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

/**
 * Clips a convex polygon (alternating x, z) to the half-plane nx*x + nz*z <= d
 * (Sutherland-Hodgman against one edge). Returns a new array.
 */
function clipHalfPlane(poly: number[], nx: number, nz: number, d: number): number[] {
  const out: number[] = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2];
    const az = poly[i * 2 + 1];
    const bx = poly[((i + 1) % n) * 2];
    const bz = poly[((i + 1) % n) * 2 + 1];
    const da = nx * ax + nz * az - d;
    const db = nx * bx + nz * bz - d;
    if (da <= 0) out.push(ax, az);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(ax + (bx - ax) * t, az + (bz - az) * t);
    }
  }
  return out;
}

function polygonArea(poly: number[]): number {
  let a = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  return a / 2;
}

function polygonCentroid(poly: number[]): [number, number] {
  let cx = 0;
  let cz = 0;
  let a = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
    a += cross;
    cx += (poly[i * 2] + poly[j * 2]) * cross;
    cz += (poly[i * 2 + 1] + poly[j * 2 + 1]) * cross;
  }
  if (Math.abs(a) < 1e-9) return [poly[0], poly[1]];
  return [cx / (3 * a), cz / (3 * a)];
}

/** Whether (x, z) is inside a convex outline of either winding: on the same side of every edge. */
function insideConvex(poly: number[], x: number, z: number): boolean {
  const n = poly.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = poly[j * 2] - poly[i * 2];
    const ez = poly[j * 2 + 1] - poly[i * 2 + 1];
    const c = ex * (z - poly[i * 2 + 1]) - ez * (x - poly[i * 2]);
    if (c !== 0) {
      const s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

const planCache = new Map<string, PathPlan>();

/**
 * The owner's path: the layout's waypoints with a bulge to one side chosen
 * per owner, pushed clear of the bed's stones and the lantern post, then
 * paved the way a gardener lays irregular flagstones. Seed points are walked
 * along it, two across with a stagger or now and then one big stone across
 * the whole width; each stone is the patch of path nearer its seed than any
 * other (a Voronoi cell, which gives five- to seven-sided outlines that fit
 * their neighbours), trimmed to the path's edge, drawn in by half a joint so
 * the stones sit two to four centimetres apart, and chipped at some corners.
 */
export function pathPlan(seed: string): PathPlan {
  return planPath(LAYOUT.path, seed + "|garden|path", seed);
}

/**
 * The front walk (LAYOUT.front.walk): the same flagstones laid the same way from the gateway in to the path's first
 * stone, from a random stream of its own, so the path itself is exactly as it was.
 */
export function walkPlan(seed: string): PathPlan {
  return planPath(LAYOUT.front.walk, seed + "|garden|walk", "walk|" + seed);
}

function planPath(waypoints: readonly (readonly [number, number, number])[], rngKey: string, cacheKey: string): PathPlan {
  const hit = planCache.get(cacheKey);
  if (hit) return hit;
  const rng = new Rng(rngKey);
  const side = rng.sign();
  const pts: THREE.Vector3[] = waypoints.map((p) => new THREE.Vector3(p[0], 0, p[2]));
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
    if (rho < 1.36) {
      const k = 1.36 / Math.max(rho, 1e-3);
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
  // A few passes of smoothing take the kinks out of the pushed stretch.
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

  const halfWidth = LAYOUT.pathWidth * 0.5;
  // Seeds, each with the centreline frame it was laid from (for trimming to the edge).
  interface Seed {
    x: number;
    z: number;
    cx: number;
    cz: number;
    nx: number;
    nz: number;
  }
  const seeds: Seed[] = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  let s = 0.08;
  while (s < total - 0.05) {
    at(s, p, d);
    const nx = -d.z;
    const nz = d.x;
    const put = (along: number, lateral: number) => {
      const x = p.x + d.x * along + nx * lateral;
      const z = p.z + d.z * along + nz * lateral;
      seeds.push({ x, z, cx: p.x + d.x * along, cz: p.z + d.z * along, nx, nz });
    };
    if (rng.next() < 0.22) {
      // one broad stone across the path
      put(rng.range(-0.02, 0.02), rng.range(-0.05, 0.05));
      s += rng.range(0.26, 0.34);
    } else {
      // two across, staggered so the joints do not line up
      const lat = rng.range(0.12, 0.15);
      const stagger = rng.range(0.03, 0.08) * rng.sign();
      put(stagger, lat + rng.range(-0.02, 0.02));
      put(-stagger, -lat + rng.range(-0.02, 0.02));
      s += rng.range(0.2, 0.3);
    }
  }

  const stones: Flagstone[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const a = seeds[i];
    // start from a generous square round the seed and cut it by every near neighbour's bisector
    let poly = [a.x - 0.45, a.z - 0.45, a.x + 0.45, a.z - 0.45, a.x + 0.45, a.z + 0.45, a.x - 0.45, a.z + 0.45];
    for (let j = 0; j < seeds.length && poly.length >= 6; j++) {
      if (j === i) continue;
      const b = seeds[j];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      if (vx * vx + vz * vz > 0.8 * 0.8) continue;
      poly = clipHalfPlane(poly, vx, vz, vx * (a.x + b.x) * 0.5 + vz * (a.z + b.z) * 0.5);
    }
    // trimmed to the paving's edges either side, a little ragged
    const hw = halfWidth * rng.range(0.9, 1.04);
    const c0 = a.nx * a.cx + a.nz * a.cz;
    poly = clipHalfPlane(poly, a.nx, a.nz, c0 + hw);
    poly = clipHalfPlane(poly, -a.nx, -a.nz, -c0 + hw);
    if (poly.length < 6) continue;
    if (polygonArea(poly) < 0) {
      // keep every outline wound one way (positive area in x, z), so edge normals are known
      const rev: number[] = [];
      for (let k = poly.length / 2 - 1; k >= 0; k--) rev.push(poly[k * 2], poly[k * 2 + 1]);
      poly = rev;
    }
    // drawn in by half a joint: each edge's line moved inward
    const joint = rng.range(0.011, 0.019);
    const edges = poly.slice();
    const ne = edges.length / 2;
    for (let k = 0; k < ne && poly.length >= 6; k++) {
      const x0 = edges[k * 2];
      const z0 = edges[k * 2 + 1];
      const x1 = edges[((k + 1) % ne) * 2];
      const z1 = edges[((k + 1) % ne) * 2 + 1];
      const ex = x1 - x0;
      const ez = z1 - z0;
      const el = Math.hypot(ex, ez) || 1;
      // outward normal of an outline with positive area in x, z
      const ox = ez / el;
      const oz = -ex / el;
      poly = clipHalfPlane(poly, ox, oz, ox * x0 + oz * z0 - joint);
    }
    if (poly.length < 6) continue;
    const [gx, gz] = polygonCentroid(poly);
    // chipped corners: some corners knocked off square to the line toward the middle
    const corners = poly.slice();
    const nc = corners.length / 2;
    for (let k = 0; k < nc; k++) {
      if (rng.next() > 0.45) continue;
      const vx = corners[k * 2];
      const vz = corners[k * 2 + 1];
      const bx = gx - vx;
      const bz = gz - vz;
      const bl = Math.hypot(bx, bz) || 1;
      const cut = rng.range(0.012, 0.03);
      // keep points at least `cut` from the corner along the bisector toward the centroid
      poly = clipHalfPlane(poly, -bx / bl, -bz / bl, -(bx / bl) * vx - (bz / bl) * vz - cut);
    }
    if (poly.length < 6) continue;
    // the bed's kerb and its spade-cut edge keep their ground: a slab that
    // reaches toward them is trimmed square to the oval, as a mason would cut it
    {
      const [qx, qz] = polygonCentroid(poly);
      const rc = bedRho(qx, qz);
      if (rc < 1.5) {
        const [bx, , bz] = BED.center;
        const px = bx + ((qx - bx) * 1.2) / rc;
        const pz = bz + ((qz - bz) * 1.2) / rc;
        const gx = (px - bx) / (BED.rx * BED.rx);
        const gz = (pz - bz) / (BED.rz * BED.rz);
        poly = clipHalfPlane(poly, -gx, -gz, -(gx * px + gz * pz));
      }
    }
    const area = polygonArea(poly);
    if (poly.length < 6 || area < 0.012) continue;
    const [sx, sz] = polygonCentroid(poly);
    if (bedRho(sx, sz) < 1.2) continue;
    if (Math.hypot(sx - LANTERN_XZ[0], sz - LANTERN_XZ[1]) < 0.2 + Math.sqrt(area / Math.PI)) continue;
    stones.push({
      x: sx,
      z: sz,
      r: Math.sqrt(area / Math.PI),
      outline: poly,
      tiltX: rng.range(-0.02, 0.02),
      tiltZ: rng.range(-0.02, 0.02),
      // about a centimetre proud of the soil: sunk, not perched
      lift: rng.range(0.008, 0.013),
      tint: rng.next(),
      seed: rng.range(0, 100),
    });
  }

  const plan: PathPlan = {
    line,
    stones,
    halfWidth,
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
        if (dx * dx + dz * dz > st.r * st.r * 2.6) continue;
        if (insideConvex(st.outline, x, z)) return true;
      }
      return false;
    },
  };
  planCache.set(cacheKey, plan);
  return plan;
}

/* ====================================================================== */
/* Stones                                                                   */
/* ====================================================================== */

/** Warm, light greys and buffs: a kerb that reads against dark mulch and lawn. */
const STONE_TINTS = ["#b3ab9c", "#c2b8a5", "#a8a297", "#bcb09a", "#9f998f", "#c8bfae", "#ada391", "#b8b2a6"] as const;
const MOSS_DARK = new THREE.Color("#2c5520");
const MOSS_LIGHT = new THREE.Color("#7ea33a");
const LICHEN_PALE = new THREE.Color("#b9b89a");
const LICHEN_GOLD = new THREE.Color("#d2bf6c");

export interface Fieldstone {
  x: number;
  z: number;
  /** angle round the bed's oval, for the moss in the joints */
  angle: number;
  /** along the kerb */
  length: number;
  /** across the kerb */
  width: number;
  height: number;
  yaw: number;
  /** where the stone's foot rests: the lawn for the first course, the stone below for the second */
  baseY: number;
  /** share of its height set below its foot */
  sink: number;
  /** 1 for the kerb itself, 2 for the course laid on it along the back of the bed */
  course: 1 | 2;
}

/** Oval radius of the kerb's centre line. */
const KERB_RING = 0.955;
/** The back of the bed, in oval units of depth (-1 at the back edge), from which the second course is laid. */
const SECOND_COURSE_FROM = -0.32;

/**
 * A fieldstone's shape spans from STONE_FOOT below its centre to STONE_CROWN
 * above it, in half-heights: its flattened underside and its pared top.
 */
const STONE_FOOT = 0.75;
const STONE_CROWN = 0.85;

/** The height of a stone's centre: its underside sits `sink` of its height below its foot. */
function stoneCentreY(st: Fieldstone): number {
  return st.baseY - st.sink * st.height + (STONE_FOOT * st.height) / 2;
}

/** The top of a stone. */
export function stoneTop(st: Fieldstone): number {
  return stoneCentreY(st) + (STONE_CROWN * st.height) / 2;
}

/**
 * The kerb, laid the way a gardener builds a low dry-stone edge: flat,
 * angular fieldstones walked round the rim by their own lengths so they
 * stand shoulder to shoulder with no soil between them, long axes along the
 * ring, set a little into the lawn; then, along the back of the bed where it
 * rises, a second course on top, broken over the joints below.
 */
export function planFieldstones(seed: string): Fieldstone[] {
  const rng = new Rng(seed + "|garden|stones");
  const out: Fieldstone[] = [];
  const [cx, , cz] = BED.center;
  const ringPoint = (a: number, rr: number) => ({
    x: cx + Math.cos(a) * BED.rx * rr,
    z: cz + Math.sin(a) * BED.rz * rr,
  });
  // the yaw that lays a stone's long (local x) axis along the ring's tangent at angle a
  const tangentYaw = (a: number) => Math.atan2(-Math.cos(a) * BED.rz, -Math.sin(a) * BED.rx);
  let a = rng.range(0, Math.PI * 2);
  const a0 = a;
  let prevHalf = 0;
  let guard = 0;
  const first: Fieldstone[] = [];
  while (guard++ < 90) {
    const length = rng.range(0.2, 0.32);
    const width = rng.range(0.13, 0.18);
    const height = rng.range(0.14, 0.17);
    const arcPerRad = Math.hypot(BED.rx * Math.sin(a), BED.rz * Math.cos(a)) * KERB_RING;
    // butted: spaced by a shade under their lengths, so the squared ends meet
    const step = (0.94 * (prevHalf + length / 2)) / arcPerRad;
    if (first.length > 0 && a + step - a0 > Math.PI * 2 - 0.02) break;
    a += step;
    prevHalf = length / 2;
    const { x, z } = ringPoint(a, KERB_RING + rng.range(-0.008, 0.008));
    // The lantern's plinth is set into the kerb: it takes the place of a stone.
    if (Math.hypot(x - LANTERN_XZ[0], z - LANTERN_XZ[1]) < LANTERN_PLINTH * 1.3 + length * 0.42) continue;
    first.push({
      x,
      z,
      angle: a,
      length,
      width,
      height,
      yaw: tangentYaw(a) + rng.range(-0.06, 0.06),
      baseY: 0,
      sink: rng.range(0.06, 0.12),
      course: 1,
    });
  }
  out.push(...first);
  // the second course: over the joints of the first, set back a touch toward the bed
  for (let i = 0; i < first.length; i++) {
    const s0 = first[i];
    const s1 = first[(i + 1) % first.length];
    let a1 = s1.angle;
    if (a1 < s0.angle) a1 += Math.PI * 2;
    const am = (s0.angle + a1) / 2;
    if (Math.sin(am) > SECOND_COURSE_FROM) continue;
    const { x, z } = ringPoint(am, KERB_RING - 0.03);
    if (Math.hypot(x - LANTERN_XZ[0], z - LANTERN_XZ[1]) < 0.22) continue;
    const below = Math.min(stoneTop(s0), stoneTop(s1));
    out.push({
      x,
      z,
      angle: am,
      length: rng.range(0.19, 0.28),
      width: rng.range(0.11, 0.15),
      height: rng.range(0.09, 0.115),
      yaw: tangentYaw(am) + rng.range(-0.06, 0.06),
      baseY: below,
      sink: rng.range(0.03, 0.08),
      course: 2,
    });
  }
  return out;
}

function toBedCentre(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(BED.center[0] - x, 0, BED.center[2] - z).normalize();
}

const inward = new THREE.Vector3();

/** A cutting plane through a unit stone: points past `o` along `n` are pared back onto it. */
interface Facet {
  n: THREE.Vector3;
  o: number;
}

/** Superellipsoid exponent: 2 is a sphere, higher a squarer block with rounded arrises. */
const STONE_SQUARENESS = 4.2;

/**
 * Every fieldstone: a subdivided icosahedron pushed out onto a rounded block
 * (a superellipsoid), then broken by a handful of planes into the faces of a
 * split stone: a flat, slightly tilted top, squared ends where it meets its
 * neighbours, and a chamfered arris or two, with a little noise so no face is
 * machined. Coloured per vertex: a warm mineral tint, moss on the tops and the
 * bed-facing side, lichen flecks, and a dark band at its foot, the contact line
 * that sets it into the ground even on the lite tier, which has no ambient
 * occlusion. One geometry, one draw.
 */
export function makeFieldstones(stones: Fieldstone[], seed: string, detail: number, fineDetail: number): THREE.BufferGeometry {
  const rng = new Rng(seed + "|garden|stonecolour");
  const b = new GeoBuilder();
  const base = smoothIcosphere(detail);
  const fine = fineDetail > detail ? smoothIcosphere(fineDetail) : base;
  const tint = new THREE.Color();
  const mossy = new THREE.Color();
  const facets: Facet[] = [];
  for (let k = 0; k < 8; k++) facets.push({ n: new THREE.Vector3(), o: 1 });
  const u = new THREE.Vector3();
  for (const st of stones) {
    const near = st.z > 0 || Math.abs(st.x) > 0.6;
    const src = near ? fine : base;
    const g = src.clone();
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const sx = st.length / 2;
    const sy = st.height / 2;
    const sz = st.width / 2;
    const ns = rng.range(0, 50);
    // a near-flat top, two squared ends along the kerb, and a chamfer or two on the arrises
    const nFacets = rng.int(4, 6);
    facets[0].n.set(rng.range(-0.08, 0.08), 1, rng.range(-0.08, 0.08)).normalize();
    facets[0].o = STONE_CROWN + rng.range(-0.03, 0.03);
    facets[1].n.set(1, rng.range(-0.1, 0.1), rng.range(-0.15, 0.15)).normalize();
    facets[1].o = rng.range(0.86, 0.95);
    facets[2].n.set(-1, rng.range(-0.1, 0.1), rng.range(-0.15, 0.15)).normalize();
    facets[2].o = rng.range(0.86, 0.95);
    for (let k = 3; k < nFacets; k++) {
      const ang = rng.range(0, Math.PI * 2);
      facets[k].n.set(Math.cos(ang), rng.range(0.3, 0.9), Math.sin(ang)).normalize();
      facets[k].o = rng.range(0.78, 0.9);
    }
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i);
      const dy = p.getY(i);
      const dz = p.getZ(i);
      const q = STONE_SQUARENESS;
      const r = Math.pow(Math.pow(Math.abs(dx), q) + Math.pow(Math.abs(dy), q) + Math.pow(Math.abs(dz), q), -1 / q);
      const n =
        1 +
        0.035 * vnoise2(dx * 2.1 + ns, dy * 2.1 + dz * 1.3) +
        0.018 * vnoise2(dz * 4.3 + ns * 2, dx * 4.3 - dy) +
        0.008 * vnoise2(dy * 9 + ns, dz * 9 + dx * 2);
      u.set(dx, dy, dz).multiplyScalar(r * n);
      for (let k = 0; k < nFacets; k++) {
        const f = facets[k];
        const over = u.dot(f.n) - f.o;
        if (over > 0) u.addScaledVector(f.n, -over * 0.97);
      }
      let y = u.y;
      // settled flat underneath
      if (y < -STONE_FOOT + 0.15) y = lerp(y, -STONE_FOOT, 0.7);
      p.setXYZ(i, u.x * sx, y * sy, u.z * sz);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    // about one texture tile per 22 cm, offset per stone so no two share a grain
    boxProjectUVs(g, 4.5, ns * 0.37);
    tint.set(rng.pick(STONE_TINTS)).multiplyScalar(rng.range(1.3, 1.55));
    // the kerb is old: every stone carries some moss on its top, some a good deal
    const mossAmt = 0.35 + 0.65 * Math.pow(rng.next(), 1.4);
    const lichenAmt = rng.next();
    // the bed-facing direction in the stone's own frame (the inverse of its yaw)
    toBedCentre(st.x, st.z, inward);
    const cs = Math.cos(st.yaw);
    const sn = Math.sin(st.yaw);
    const lx = inward.x * cs - inward.z * sn;
    const lz = inward.x * sn + inward.z * cs;
    // where the ground (or the stone below) cuts this one, in its local frame
    const groundLocal = st.baseY - stoneCentreY(st);
    const fn: ColorFn = (v, nrm, out) => {
      const grain = 0.92 + 0.08 * vnoise2(v.x * 90 + ns, v.z * 90 + v.y * 40);
      const down = smoothstep(-0.9, 0.5, v.y / sy);
      // the contact line: dark right at the foot, fading over a couple of centimetres
      const contact = 1 - smoothstep(groundLocal - 0.004, groundLocal + 0.025, v.y);
      out.setScalar(grain * lerp(0.7, 1, down) * lerp(1, 0.3, contact));
      const facing = clamp01(0.5 + 0.5 * (nrm.x * lx + nrm.z * lz));
      const upness = clamp01(nrm.y);
      const mn = 0.5 + 0.5 * vnoise2(v.x * 24 + ns, v.z * 24 + v.y * 18);
      const mn2 = 0.5 + 0.5 * vnoise2(v.x * 70 - ns, v.z * 70 + v.y * 50);
      // moss gathers on the tops and down the damp bed-facing side, in soft patches
      const where = upness * 0.62 + facing * 0.22 + (st.course === 2 ? 0.08 : 0);
      const moss = smoothstep(0.5, 0.78, mn * 0.55 + mn2 * 0.15 + where * 0.55) * mossAmt * (1 - contact);
      if (moss > 0) {
        mossy.copy(MOSS_DARK).lerp(MOSS_LIGHT, clamp01(upness * 0.8 + mn2 * 0.3));
        out.lerp(mossy, moss);
      }
      const ln = vnoise2(v.x * 160 + ns * 3, v.z * 160 + v.y * 90);
      const lichen = smoothstep(0.45 + 0.35 * (1 - lichenAmt), 0.75, ln) * (1 - moss) * smoothstep(-0.2, 0.4, nrm.y);
      if (lichen > 0) out.lerp(lichenAmt > 0.5 ? LICHEN_PALE : LICHEN_GOLD, lichen * 0.7);
    };
    compose(tm, st.x, stoneCentreY(st), st.z, st.yaw, rng.range(-0.03, 0.03), rng.range(-0.03, 0.03), 1);
    b.add(g, tm, tint, fn);
    g.dispose();
  }
  base.dispose();
  if (fine !== base) fine.dispose();
  return b.build();
}

/**
 * Moss in the kerb: cushions in the tight joints where neighbouring stones'
 * tops meet, a few on the stones' tops, and now and then one tucked at a
 * stone's foot on the lawn side. Flattened, noisy domes, dark at the base
 * and yellow-green at the crown.
 */
export function makeMossCushions(stones: Fieldstone[], seed: string): THREE.BufferGeometry {
  const rng = new Rng(seed + "|garden|moss");
  const b = new GeoBuilder();
  const dome = smoothIcosphere(1);
  const p = dome.getAttribute("position") as THREE.BufferAttribute;
  const [cx, , cz] = BED.center;
  const place = (x: number, y: number, z: number, size: number, tall: number) => {
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
    compose(tm, x, y - tall * 0.25, z, rng.range(0, 6.28), 0, 0, 1);
    b.add(g, tm, WHITE, fn);
    g.dispose();
  };
  const first = stones.filter((s) => s.course === 1);
  for (let i = 0; i < first.length; i++) {
    const a = first[i];
    const nb = first[(i + 1) % first.length];
    // in the joint between this stone and the next, at the height of their tops
    if (rng.next() < 0.75) {
      const ang = i === first.length - 1 ? nb.angle + Math.PI * 2 : nb.angle;
      const mid = (a.angle + ang) / 2;
      const rr = KERB_RING + rng.range(-0.04, 0.03);
      const top = Math.min(stoneTop(a), stoneTop(nb));
      place(cx + Math.cos(mid) * BED.rx * rr, top - 0.004, cz + Math.sin(mid) * BED.rz * rr, rng.range(0.018, 0.032), rng.range(0.008, 0.016));
    }
    // a cushion on the stone's own top, now and then
    if (rng.next() < 0.3) {
      const off = rng.range(-0.3, 0.3) * a.length;
      place(a.x + Math.cos(a.yaw) * off, stoneTop(a) - 0.002, a.z - Math.sin(a.yaw) * off, rng.range(0.02, 0.035), rng.range(0.006, 0.012));
    }
    // and at the stone's foot on the lawn side
    if (rng.next() < 0.3) {
      const rr = rng.range(1.06, 1.1);
      place(cx + Math.cos(a.angle) * BED.rx * rr, 0, cz + Math.sin(a.angle) * BED.rz * rr, rng.range(0.02, 0.035), rng.range(0.008, 0.014));
    }
  }
  dome.dispose();
  return b.build();
}

/**
 * Soft contact shadows on the ground round each kerb stone of the first
 * course: a dark oval a few centimetres wider than the stone's foot, draped
 * over the lawn, opaque at the stone and fading to nothing at the rim (alpha
 * in the vertex colour). Drawn as one transparent mesh over the ground, it
 * seats the stones in the soil on every tier, including lite, which has no
 * ambient occlusion.
 */
export function makeStoneContactShadows(stones: Fieldstone[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const rim = 18;
  const SPREAD = 0.035;
  for (const st of stones) {
    if (st.course !== 1) continue;
    const cs = Math.cos(st.yaw);
    const sn = Math.sin(st.yaw);
    const hx = st.length * 0.5 * 0.92;
    const hz = st.width * 0.5 * 0.92;
    const start = pos.length / 3;
    const put = (lx: number, lz: number, alpha: number) => {
      // local x is the stone's long axis; yaw turns +z, as compose() does
      const x = st.x + lx * cs + lz * sn;
      const z = st.z - lx * sn + lz * cs;
      pos.push(x, Math.max(0, Math.min(0.02, bedSurfaceY(x, z))) + 0.004, z);
      col.push(1, 1, 1, alpha);
    };
    put(0, 0, 0.6);
    for (let ring = 0; ring < 2; ring++) {
      for (let k = 0; k < rim; k++) {
        const ang = (k / rim) * Math.PI * 2;
        const grow = ring === 0 ? 0.95 : 1;
        const pad = ring === 0 ? 0 : SPREAD;
        put(Math.cos(ang) * (hx * grow + pad), Math.sin(ang) * (hz * grow + pad), ring === 0 ? 0.6 : 0);
      }
    }
    for (let k = 0; k < rim; k++) {
      const k1 = (k + 1) % rim;
      const a0 = start + 1 + k;
      const a1 = start + 1 + k1;
      const b0 = start + 1 + rim + k;
      const b1 = start + 1 + rim + k1;
      idx.push(start, a1, a0, a0, a1, b1, a0, b1, b0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Oval radii of the spade-cut edge: from the stones' outer foot to where the lawn starts. */
export const SPADE_EDGE: readonly [number, number] = [1.035, 1.115];

/**
 * The spade-cut edge between the lawn and the kerb: a narrow ribbon of bare,
 * dark soil round the outside of the stones with a crisp outer line where the
 * turf has been cut back, the mark of a kept garden. Vertex colours carry the
 * soil, darkest in the cut's shadow at the turf's edge.
 */
export function makeSpadeEdge(segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const [cx, , cz] = BED.center;
  const lanes = 3;
  const soil = new THREE.Color("#2b2015");
  const cut = new THREE.Color("#140f09");
  for (let j = 0; j <= segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    // the cut wanders a centimetre in and out, as a hand-cut edge does
    const wob = 0.008 * vnoise2(Math.cos(a) * 3 + 11, Math.sin(a) * 3 - 4);
    for (let i = 0; i <= lanes; i++) {
      const t = i / lanes;
      const rr = lerp(SPADE_EDGE[0], SPADE_EDGE[1] + wob, t);
      const x = cx + Math.cos(a) * BED.rx * rr;
      const z = cz + Math.sin(a) * BED.rz * rr;
      // a shallow dip: the soil sits a little below the turf at the cut
      pos.push(x, 0.0015 - 0.002 * Math.sin(Math.PI * t), z);
      nor.push(0, 1, 0);
      uv.push(x * 1.4, z * 1.4);
      tc.copy(soil).lerp(cut, smoothstep(0.55, 1, t)).multiplyScalar(0.9 + 0.2 * vnoise2(x * 30, z * 30));
      col.push(tc.r, tc.g, tc.b);
    }
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < lanes; i++) {
      const a = j * (lanes + 1) + i;
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

const FLAG_TINTS = ["#8c8578", "#9d927f", "#7b7870", "#a79c87", "#6f6c66", "#b3a890", "#8a8070", "#9a9488"] as const;
const FLAG_A = new THREE.Color();
const FLAG_B = new THREE.Color();
const FLAG_SIDE = new THREE.Color("#3e382d");
/** The flagstones' slab: the visible thickness above the soil is the lift; the rest is sunk. */
const FLAG_SINK = 0.014;
const FLAG_BEVEL = 0.006;

/**
 * The flagstones: each slab follows its outline, the edges subdivided and
 * broken a little so no side is ruled straight, a faintly domed top with a
 * worn grain, a narrow bevel, and a vertical side running down into the soil.
 * Grey-tan, dirt in the bevel, moss creeping in from the joints on the damp
 * north side. `detail` sets how finely the outline is walked. One geometry.
 */
export function makeFlagstones(plan: PathPlan, detail: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const segLen = 0.034 * (12 / Math.max(6, detail));
  for (const st of plan.stones) {
    const rng = new Rng("flag" + st.seed.toFixed(4));
    // walk the outline into short segments, nudged in and out a couple of millimetres
    const ox: number[] = [];
    const oz: number[] = [];
    const n0 = st.outline.length / 2;
    for (let k = 0; k < n0; k++) {
      const x0 = st.outline[k * 2];
      const z0 = st.outline[k * 2 + 1];
      const x1 = st.outline[((k + 1) % n0) * 2];
      const z1 = st.outline[((k + 1) % n0) * 2 + 1];
      const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / segLen));
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        let x = lerp(x0, x1, t);
        let z = lerp(z0, z1, t);
        const rx = x - st.x;
        const rz = z - st.z;
        const rl = Math.hypot(rx, rz) || 1;
        const nudge = j === 0 ? 0 : 0.0022 * vnoise2(x * 40 + st.seed, z * 40 - st.seed);
        x += (rx / rl) * nudge;
        z += (rz / rl) * nudge;
        ox.push(x - st.x);
        oz.push(z - st.z);
      }
    }
    const n = ox.length;
    let rmax = 0;
    for (let k = 0; k < n; k++) rmax = Math.max(rmax, Math.hypot(ox[k], oz[k]));
    const top = st.lift;
    const topY = (x: number, z: number) => {
      const rr = Math.hypot(x, z) / Math.max(rmax, 1e-3);
      return top + 0.003 * (1 - rr * rr) + 0.0012 * vnoise2(x * 25 + st.seed, z * 25) + st.tiltX * z - st.tiltZ * x;
    };
    FLAG_A.set(FLAG_TINTS[Math.floor(st.tint * FLAG_TINTS.length)]).multiplyScalar(rng.range(0.95, 1.1));
    FLAG_B.copy(FLAG_A).lerp(tc.set("#4a4336"), 0.5);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const colv: THREE.Color[] = [];
    const push = (x: number, y: number, z: number, c: THREE.Color) => {
      pos.push(x, y, z);
      uv.push((x + st.x) * 3.2, (z + st.z) * 3.2);
      colv.push(c.clone());
    };
    const mossAt = (x: number, z: number) => {
      // the damp north (-z) side of each stone and its joints grow moss
      const north = clamp01(0.5 - 0.5 * (z / Math.max(1e-3, Math.hypot(x, z))));
      return smoothstep(0.35, 0.85, north * 0.6 + 0.45 * (0.5 + 0.5 * vnoise2(x * 30 + st.seed, z * 30 + st.seed)));
    };
    // the top: centre, a ring at 55% (so the dome shades), the bevel's upper edge
    const grainAt = (x: number, z: number) => 0.92 + 0.1 * vnoise2(x * 14 + st.seed, z * 14 - st.seed);
    tc.copy(FLAG_A).multiplyScalar(1.03);
    push(0, topY(0, 0), 0, tc);
    for (let k = 0; k < n; k++) {
      const x = ox[k] * 0.55;
      const z = oz[k] * 0.55;
      tc.copy(FLAG_A).multiplyScalar(grainAt(x, z));
      push(x, topY(x, z), z, tc);
    }
    for (let k = 0; k < n; k++) {
      const rl = Math.hypot(ox[k], oz[k]) || 1;
      const k2 = Math.max(0.5, (rl - FLAG_BEVEL) / rl);
      const x = ox[k] * k2;
      const z = oz[k] * k2;
      tc.copy(FLAG_A).multiplyScalar(grainAt(x, z) * 0.94).lerp(MOSS_DARK, 0.3 * mossAt(x, z));
      push(x, topY(x, z), z, tc);
    }
    const topRing = 1 + n;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      idx.push(0, 1 + k1, 1 + k);
      idx.push(1 + k, 1 + k1, topRing + k, 1 + k1, topRing + k1, topRing + k);
    }
    // the bevel: its upper edge again (its own normals), down to the outline
    const bevelTop = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const rl = Math.hypot(ox[k], oz[k]) || 1;
      const k2 = Math.max(0.5, (rl - FLAG_BEVEL) / rl);
      const x = ox[k] * k2;
      const z = oz[k] * k2;
      tc.copy(FLAG_B).lerp(MOSS_DARK, 0.5 * mossAt(x, z));
      push(x, topY(x, z), z, tc);
    }
    const bevelLow = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const x = ox[k];
      const z = oz[k];
      tc.copy(FLAG_B).multiplyScalar(0.85).lerp(MOSS_DARK, 0.65 * mossAt(x, z));
      push(x, topY(x, z) - FLAG_BEVEL, z, tc);
    }
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      idx.push(bevelTop + k, bevelTop + k1, bevelLow + k, bevelTop + k1, bevelLow + k1, bevelLow + k);
    }
    // the side, straight down into the soil
    const sideTop = pos.length / 3;
    for (let k = 0; k < n; k++) push(ox[k], topY(ox[k], oz[k]) - FLAG_BEVEL, oz[k], FLAG_SIDE);
    const sideLow = pos.length / 3;
    for (let k = 0; k < n; k++) push(ox[k] * 1.01, -FLAG_SINK, oz[k] * 1.01, FLAG_SIDE);
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      idx.push(sideTop + k, sideTop + k1, sideLow + k, sideTop + k1, sideLow + k1, sideLow + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    let vi = 0;
    const fn: ColorFn = (_v, _n, out) => {
      out.copy(colv[vi++]);
    };
    compose(tm, st.x, 0, st.z, 0, 0, 0, 1);
    b.add(g, tm, WHITE, fn);
    g.dispose();
  }
  return b.build();
}

/**
 * Moss and short grass in the path's joints: small flattened cushions walked
 * round every stone's outline just outside it, so the narrow gaps between
 * the slabs read as green seams rather than empty cracks. `density` thins it
 * for the lighter tiers.
 */
export function makeJointMoss(plan: PathPlan, density: number): THREE.BufferGeometry {
  const rng = new Rng("path-joint-moss");
  const b = new GeoBuilder();
  const dome = smoothIcosphere(0);
  const p = dome.getAttribute("position") as THREE.BufferAttribute;
  const step = 0.07 / Math.max(0.2, density);
  for (const st of plan.stones) {
    const n = st.outline.length / 2;
    for (let k = 0; k < n; k++) {
      const x0 = st.outline[k * 2];
      const z0 = st.outline[k * 2 + 1];
      const x1 = st.outline[((k + 1) % n) * 2];
      const z1 = st.outline[((k + 1) % n) * 2 + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ex = (x1 - x0) / (len || 1);
      const ez = (z1 - z0) / (len || 1);
      for (let s = rng.range(0, step); s < len; s += step * rng.range(0.7, 1.3)) {
        if (rng.next() < 0.35) continue;
        // just outside the edge (outward normal of a counter-clockwise outline), in the joint
        const off = rng.range(0.005, 0.014);
        const x = x0 + ex * s + ez * off;
        const z = z0 + ez * s - ex * off;
        if (plan.distance(x, z) > plan.halfWidth + 0.02) continue;
        const size = rng.range(0.008, 0.016);
        const tall = rng.range(0.004, 0.009);
        const ns = rng.range(0, 30);
        const g = dome.clone();
        const gp = g.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          gp.setXYZ(i, p.getX(i) * size, Math.max(-0.2, p.getY(i)) * tall, p.getZ(i) * size * 1.4);
        }
        gp.needsUpdate = true;
        g.computeVertexNormals();
        const fn: ColorFn = (v, nrm, out) => {
          out.copy(MOSS_DARK).lerp(MOSS_LIGHT, smoothstep(0, 1, clamp01(v.y / tall) * 0.6 + clamp01(nrm.y) * 0.3));
          out.multiplyScalar(0.8 + 0.25 * vnoise2(v.x * 200 + ns, v.z * 200));
        };
        compose(tm, x, 0.002, z, Math.atan2(ex, ez), 0, 0, 1);
        b.add(g, tm, WHITE, fn);
        g.dispose();
      }
    }
  }
  dome.dispose();
  return b.build();
}

/**
 * The bed of soil the flagstones are laid in: a ribbon along the centreline
 * a little wider than the paving, seen only in the joints and along the
 * edges, dark and mossy green-brown where feet and damp have kept the grass
 * short, darkest at the edges where the turf takes over.
 */
export function makePathBed(plan: PathPlan): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const half = plan.halfWidth + 0.05;
  const line = plan.line;
  const lanes = 6;
  const edge = new THREE.Color("#262a16");
  const mid = new THREE.Color("#3a4024");
  const earth = new THREE.Color("#3b3324");
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
      // patches of bare earth among the moss
      const bare = smoothstep(0.1, 0.6, vnoise2(x * 5 + 2, z * 5 - 1));
      tc.copy(edge).lerp(mid, t).lerp(earth, bare * 0.6);
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
  const L = 0.068; // half width of the body
  const bodyH = 0.19;
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

/**
 * Where the watering can stands: on the close-mown lawn at the bed's right
 * front shoulder, spout turned back over the bed, as if just set down. Far
 * enough right to sit outside a phone's portrait frame, where so near the
 * lens it would loom over the kerb; in the landscape frame it balances the
 * lantern on the left.
 */
export const WATERING_CAN = { x: 0.74, z: 0.2, yaw: 1.9, scale: 1.15 } as const;

const CAN_PAINT = new THREE.Color("#6a9179");
const CAN_ZINC = new THREE.Color("#a3a7a2");
const CAN_RUST = new THREE.Color("#6e4128");
const CAN_GRIME = new THREE.Color("#2f2a22");

/**
 * The owner's watering can, left by the bed: the story prop that says this
 * garden is tended, and the visible end of the watering the game asks for.
 * An old sage-painted can, worn through to grey zinc on its edges and
 * handle, flecked with rust, grimy at the foot; a round body on a rolled
 * base, a long spout rising from low on its side with a rose on the end, and
 * a handle arching over the top. Base at the origin, spout toward +x, about
 * a quarter of a metre tall. One geometry, vertex coloured.
 */
export function makeWateringCan(radial: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // `y` is the height on the can (the parts' own frames differ), for the grime at its foot
  const wear = (v: THREE.Vector3, n: THREE.Vector3, out: THREE.Color, edge: number, y: number) => {
    const chips = smoothstep(0.55, 0.8, 0.5 + 0.5 * vnoise2(v.x * 60 + v.y * 40, v.z * 60 - v.y * 30));
    out.copy(CAN_PAINT).multiplyScalar(0.9 + 0.15 * vnoise2(v.x * 14, v.y * 14 + v.z * 9));
    out.lerp(CAN_ZINC, clamp01(chips * 0.7 + edge));
    const rust = smoothstep(0.62, 0.85, 0.5 + 0.5 * vnoise2(v.x * 90 - 3, v.y * 70 + v.z * 90));
    out.lerp(CAN_RUST, rust * 0.55);
    out.lerp(CAN_GRIME, (1 - smoothstep(0.0, 0.05, y)) * 0.6 + clamp01(-n.y) * 0.3);
  };

  // the body: a rolled foot, straight sides, a domed shoulder round a fill hole
  const profile = [
    [0.0, 0.0],
    [0.068, 0.0],
    [0.074, 0.004],
    [0.076, 0.012],
    [0.074, 0.016],
    [0.075, 0.03],
    [0.076, 0.13],
    [0.073, 0.145],
    [0.062, 0.158],
    [0.046, 0.164],
    [0.034, 0.165],
    [0.034, 0.172],
    [0.03, 0.172],
    [0.03, 0.162],
    [0.0, 0.16],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(profile, radial);
  const bodyFn: ColorFn = (v, n, out) => {
    // the rolled rims at the foot and the fill hole wear through first
    const rim = Math.max(1 - smoothstep(0.006, 0.02, Math.abs(v.y - 0.012)), 1 - smoothstep(0.003, 0.01, Math.abs(v.y - 0.168)));
    wear(v, n, out, rim * 0.6, v.y);
  };
  b.add(body, tm.identity(), WHITE, bodyFn);
  body.dispose();

  // the spout: from low on the body's side, rising out at about forty degrees
  const spoutCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, 0.03, 0),
    new THREE.Vector3(0.12, 0.075, 0),
    new THREE.Vector3(0.19, 0.14, 0),
    new THREE.Vector3(0.235, 0.185, 0),
  ]);
  const spout = new THREE.TubeGeometry(spoutCurve, 14, 0.0075, Math.max(6, Math.round(radial / 3)), false);
  const spoutFn: ColorFn = (v, n, out) => wear(v, n, out, 0.15, v.y);
  b.add(spout, tm.identity(), WHITE, spoutFn);
  spout.dispose();
  // the rose: a shallow cone on the spout's end, its face toward the bed
  const rose = new THREE.CylinderGeometry(0.019, 0.009, 0.022, Math.max(8, Math.round(radial / 2)), 1, false);
  const tip = spoutCurve.getPoint(1);
  const dir = spoutCurve.getTangent(1).normalize();
  // the cone's wide end (its +y) faces out along the spout
  tq.setFromUnitVectors(tv.set(0, 1, 0), dir);
  tm.compose(tip.addScaledVector(dir, 0.006), tq, ts.set(1, 1, 1));
  const roseFn: ColorFn = (v, n, out) => wear(v, n, out, 0.45, 0.18);
  b.add(rose, tm, WHITE, roseFn);
  rose.dispose();

  // the handle: an arch of flat strap over the top, from the back to the middle
  const handle = new THREE.TorusGeometry(0.06, 0.0065, Math.max(5, Math.round(radial / 4)), Math.max(12, radial), Math.PI);
  compose(tm, -0.018, 0.158, 0, 0, 0, 0, 1, 0.95, 1);
  const handleFn: ColorFn = (v, n, out) => wear(v, n, out, 0.55, 0.2);
  b.add(handle, tm, WHITE, handleFn);
  handle.dispose();
  return b.build();
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

/**
 * makeLeafGeometry's winding gives its computed normals toward -z, the
 * underside; every placement here assumes the upper face is +z, as the blade
 * is documented. The companion materials light a thin leaf by its normal on
 * both sides, so the normals are turned over to put the light on the top.
 */
function leaf(shape: LeafShape, seed: number, nu: number, nv: number): THREE.BufferGeometry {
  const g = makeLeafGeometry(shape, seed, nu, nv);
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  n.needsUpdate = true;
  return g;
}

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

/**
 * One alyssum flower: four rounded petals lying flat round a small green-gold
 * eye, about nine millimetres across, face up (+y). Instance colour tints it.
 */
export function makeTinyFlowerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [0, 0.0012, 0];
  const col: number[] = [0.78, 0.8, 0.45];
  const idx: number[] = [];
  const petals = 4;
  const steps = 5;
  for (let k = 0; k < petals; k++) {
    const a0 = (k / petals) * Math.PI * 2;
    const start = pos.length / 3;
    for (let j = 0; j <= steps; j++) {
      // a rounded lobe: out from the eye and back, widest at its tip
      const t = j / steps;
      const a = a0 + (t - 0.5) * 1.25;
      const r = 0.0045 * Math.sin(Math.PI * (0.15 + 0.7 * t)) ** 0.5;
      pos.push(Math.cos(a) * r, 0.0006 * (1 - t * (1 - t) * 4), Math.sin(a) * r);
      col.push(1, 1, 1);
    }
    for (let j = 0; j < steps; j++) idx.push(0, start + j + 1, start + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * A low cushion of foliage: a unit dome (radius 1, height 1, base at the
 * origin; scale (R, H, R) per instance), lumpy, with vertex colour running
 * from deep green in its shaded skirt to a fresh green crown and a fine
 * dapple of leaf-sized light and dark, so it reads as a mat of tiny leaves
 * under the flower heads rather than as a smooth green ball.
 */
/**
 * How far a cushion's surface stands out along the unit direction (x, y, z):
 * lumpy, as a mat of small plants grown together is, never a smooth ball.
 * Shared by the geometry and the planting plan, so the flower heads sit on it.
 */
export function cushionLump(x: number, y: number, z: number): number {
  return 1 + 0.15 * vnoise2(x * 2.6 + 1, z * 2.6 + y * 2) + 0.07 * vnoise2(x * 7, z * 7 - y * 4) + 0.03 * vnoise2(x * 17, z * 17 + y * 9);
}

export function makeCushionGeometry(detail: number): THREE.BufferGeometry {
  const dome = smoothIcosphere(detail);
  const p = dome.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const d = cushionLump(x, y, z);
    p.setXYZ(i, x * d, Math.max(-0.12, y) * d, z * d);
  }
  p.needsUpdate = true;
  dome.computeVertexNormals();
  const base = new THREE.Color("#183013");
  const crown = new THREE.Color("#3b6128");
  const b = new GeoBuilder();
  const fn: ColorFn = (v, n, out) => {
    out.copy(base).lerp(crown, smoothstep(-0.05, 0.9, v.y * 0.7 + n.y * 0.3));
    // a leaf-sized dapple, light and dark, over a broader mottle
    out.multiplyScalar(0.72 + 0.3 * (0.5 + 0.5 * vnoise2(v.x * 9 + 5, v.z * 9 + v.y * 7)) + 0.22 * vnoise2(v.x * 55, v.z * 55 + v.y * 40));
  };
  b.add(dome, tm.identity(), WHITE, fn);
  dome.dispose();
  return b.build();
}

/** The open bloom form of a petal from makePetalGeometry, as a plain static mesh. */
export function makeOpenPetalGeometry(shape: PetalShape, seed: number, nu: number, nv: number): THREE.BufferGeometry {
  const bud = makePetalGeometry(shape, seed, nu, nv);
  const { position, normal } = bud.morphAttributes;
  if (!position || !normal) throw new Error("makePetalGeometry returned no open morph target");
  const open = new THREE.BufferGeometry();
  open.setAttribute("position", position[0]);
  open.setAttribute("normal", normal[0]);
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
    const pinna = leaf({ length: lp, width: wp, serration: 0.9, fold: 0.12, tip: 0.85 }, seed + i, nu, nv);
    for (const side of [-1, 1]) {
      // spread sideways from the rachis, droop a little, flipped so the upper face shows
      te.set(0.3 + 0.1 * Math.sin(i * 1.7 + seed), Math.PI, side * 1.12, "ZXY");
      tq.setFromEuler(te);
      m3.compose(tv.set(0, 0, 0), tq, ts.set(1, 1, 1));
      tm.multiplyMatrices(m2, m3);
      b.add(pinna, tm, WHITE);
    }
    pinna.dispose();
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
  const blade = leaf({ length: 0.19, width: 0.15, serration: 0, fold: 0.45, tip: 0.5 }, 5, nu, nv);
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
  const leaflet = leaf({ length: 0.017, width: 0.016, serration: 0, fold: 0.18, tip: 0.06 }, 2, nu, nv);
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
 * A rosette of a creeping groundcover: seven small round leaves lying almost
 * flat round a point, about five centimetres across and a centimetre high.
 * Scattered in patches it reads as a low mat between the plants.
 */
export function makeGroundcoverGeometry(nu: number, nv: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng("groundcover-rosette");
  const n = 7;
  for (let k = 0; k < n; k++) {
    const s = rng.range(0.75, 1.1);
    const blade = leaf({ length: 0.024 * s, width: 0.019 * s, serration: 0, fold: 0.22, tip: 0.15 }, 20 + k, nu, nv);
    const yaw = (k / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
    // inner leaves stand up a little, outer ones lie on the mulch, face to the sky
    compose(tm, 0, 0.002 + 0.003 * (k % 2), 0, yaw, rng.range(1.15, 1.45), 0, -1, 1, -1);
    b.add(blade, tm, WHITE);
    blade.dispose();
  }
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
  return leaf({ length: 0.05, width: 0.0065, serration: 0, fold: 0.4, tip: 0.9 }, 11, nu, nv);
}

export type FlowerLeafKind = "feathery" | "spoon";

/** Cosmos foliage is finely cut and narrow; daisy leaves are small blunt spoons. */
export function makeFlowerLeafGeometry(kind: FlowerLeafKind, nu: number, nv: number): THREE.BufferGeometry {
  return kind === "feathery"
    ? leaf({ length: 0.055, width: 0.014, serration: 1.0, fold: 0.2, tip: 0.85 }, 7, nu, nv)
    : leaf({ length: 0.04, width: 0.018, serration: 0.6, fold: 0.3, tip: 0.35 }, 9, nu, nv);
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
  /** low cushions of tiny flowers along the front kerb */
  alyssum: number;
  alyssumFlorets: number;
  clover: number;
  /** patches of low creeping groundcover through the open mulch, and rosettes per patch */
  groundPatches: number;
  groundRosettes: number;
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
    lavenderPlants: 5,
    spikesPerPlant: 18,
    whorls: 7,
    lavenderLeaves: 26,
    cosmos: 14,
    daisies: 18,
    ferns: 5,
    fronds: 10,
    pinnae: 12,
    hostas: 5,
    hostaLeaves: 12,
    alyssum: 6,
    alyssumFlorets: 380,
    clover: 240,
    groundPatches: 16,
    groundRosettes: 22,
    petalTess: [5, 8],
    leafTess: [5, 8],
    pinnaTess: [3, 6],
    stoneDetail: 3,
    stoneFineDetail: 3,
    flagSides: 14,
    bedRings: 40,
    bedSegs: 120,
    discDetail: 2,
  },
  balanced: {
    lavenderPlants: 4,
    spikesPerPlant: 14,
    whorls: 6,
    lavenderLeaves: 18,
    cosmos: 11,
    daisies: 14,
    ferns: 4,
    fronds: 9,
    pinnae: 10,
    hostas: 4,
    hostaLeaves: 11,
    alyssum: 6,
    alyssumFlorets: 280,
    clover: 140,
    groundPatches: 14,
    groundRosettes: 16,
    petalTess: [4, 6],
    leafTess: [4, 6],
    pinnaTess: [3, 5],
    stoneDetail: 2,
    stoneFineDetail: 3,
    flagSides: 12,
    bedRings: 30,
    bedSegs: 88,
    discDetail: 1,
  },
  lite: {
    lavenderPlants: 3,
    spikesPerPlant: 10,
    whorls: 5,
    lavenderLeaves: 12,
    cosmos: 8,
    daisies: 10,
    ferns: 3,
    fronds: 7,
    pinnae: 7,
    hostas: 3,
    hostaLeaves: 9,
    alyssum: 5,
    alyssumFlorets: 260,
    clover: 60,
    groundPatches: 11,
    groundRosettes: 11,
    petalTess: [3, 5],
    leafTess: [3, 5],
    pinnaTess: [2, 4],
    stoneDetail: 2,
    stoneFineDetail: 2,
    flagSides: 10,
    bedRings: 22,
    bedSegs: 64,
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
  alyssum: THREE.Color;
  fern: { base: string; tip: string; vein: string };
  hosta: { base: string; tip: string; vein: string };
  flowerLeaf: { base: string; tip: string; vein: string };
  clover: { base: string; tip: string; vein: string };
  groundcover: { base: string; tip: string; vein: string };
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
  /** alyssum flowers, for makeTinyFlowerGeometry */
  alyssum: Placement[];
  /** the green cushions the alyssum heads sit on, for makeCushionGeometry */
  alyssumDomes: Placement[];
  clover: Placement[];
  /** creeping groundcover rosettes, for makeGroundcoverGeometry */
  groundcover: Placement[];
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
/**
 * Sweet alyssum's white, warmed to cream: pure white heads on dark leaves
 * read as salt or snow, high contrast and glittering at a soft pixel ratio;
 * cream reads as flowers in the same light.
 */
const ALYSSUM_TINTS = ["#f4efe0", "#f2ecdb", "#f6f1e5"] as const;
/** Creeping groundcovers: thyme's dark green, baby's tears' fresh green, creeping Jenny's gold-green. */
const GROUND_GREENS = [
  { base: "#2a5a2a", tip: "#5e9446", vein: "#a9cf8c" },
  { base: "#356a2c", tip: "#79aa4e", vein: "#c2e0a0" },
  { base: "#4a6a26", tip: "#9db04a", vein: "#d8e2a0" },
] as const;
const FERN_GREENS = [
  { base: "#1f5a2a", tip: "#4f9a3c", vein: "#9fd07a" },
  { base: "#2a6a30", tip: "#6cb04a", vein: "#b8e08a" },
] as const;
const HOSTA_GREENS = [
  { base: "#3f7d4f", tip: "#8fc070", vein: "#c8e6b0" },
  { base: "#4a8338", tip: "#a9c96e", vein: "#e6efc0" },
  { base: "#3d7868", tip: "#98c6a2", vein: "#d8eed2" },
] as const;

/** The hero stands here; companions keep out so the stem and mound stay in view. */
const HERO_CLEAR = 0.36;
const LANTERN_CLEAR = 0.16;
/** Neighbouring plants may interleave this far: real beds are planted shoulder to shoulder. */
const CROWDING = 0.7;
/** In front of the hero, between it and the camera, only clover grows. */
const inFrontOfHero = (x: number, z: number) => z > -0.18 && Math.abs(x) < 0.4;

function placementAt(m: THREE.Matrix4, c: THREE.Color): Placement {
  return { m: m.clone(), c: c.clone() };
}

const ma = new THREE.Matrix4();
const mb = new THREE.Matrix4();
const mc = new THREE.Matrix4();

/**
 * Where everything in the bed goes for one owner. Colours, counts and every
 * offset come from Rng(seed + "|garden"). The bed is planted the way a
 * gardener would, full enough that the mulch shows only in the gaps: the
 * broad hostas and the ferns first, flanking and backing the hero and filling
 * the front corners; lavender along the back; tall cosmos at the back
 * corners; daisies at the sides; white cushions of alyssum spilling over the
 * front kerb; mats of creeping groundcover through the open mulch, right up
 * to the hero's watering ring; clover along the stones. Nothing taller than
 * groundcover stands between the hero and the default camera, so even a
 * seedling is always in view.
 */
/** Advances `rng` exactly as the original alyssum heads did, `n` of them (see planCompanions). */
function skipLegacyAlyssumHeads(rng: Rng, n: number) {
  for (let h = 0; h < n; h++) {
    rng.next();
    rng.next();
    const perHead = rng.int(7, 11);
    rng.next();
    for (let k = 0; k < perHead * 5; k++) rng.next();
  }
}

export function planCompanions(seed: string, budget: CompanionBudget): CompanionPlan {
  const rng = new Rng(seed + "|garden");
  const lavHue = rng.range(0.72, 0.78);
  // Colour values here are linear: a lightness of a third reads as a mid lavender on screen.
  const palette: Palette = {
    lavender: new THREE.Color().setHSL(lavHue, rng.range(0.45, 0.6), rng.range(0.27, 0.33)),
    lavenderTip: new THREE.Color().setHSL(lavHue - 0.02, 0.5, 0.47),
    cosmos: (() => {
      const pair = rng.pick(COSMOS_PAIRS);
      return [new THREE.Color(pair[0]), new THREE.Color(pair[1])] as [THREE.Color, THREE.Color];
    })(),
    daisy: new THREE.Color(rng.pick(DAISY_WHITES)),
    disc: new THREE.Color().setHSL(rng.range(0.115, 0.135), 0.9, rng.range(0.42, 0.5)),
    budGreen: new THREE.Color("#4f7a34"),
    alyssum: new THREE.Color(rng.pick(ALYSSUM_TINTS)),
    fern: rng.pick(FERN_GREENS),
    hosta: rng.pick(HOSTA_GREENS),
    flowerLeaf: { base: "#2f6a2c", tip: "#5f9c43", vein: "#a6d484" },
    clover: { base: "#2f7a2e", tip: "#6fb354", vein: "#cfeab0" },
    groundcover: rng.pick(GROUND_GREENS),
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
    alyssum: [],
    alyssumDomes: [],
    clover: [],
    groundcover: [],
    daisyPetal: { length: 0.036, width: 0.012, bend: 0.12, cup: 0.35, ruffle: 0.25, tip: 0.5 },
    cosmosPetal: { length: 0.042, width: 0.025, bend: 0.18, cup: 0.25, ruffle: 0.35, tip: 0.15 },
    frondLength: 0.4,
  };

  const [lx, , lz] = LAYOUT.lantern.position;
  const taken: { x: number; z: number; r: number }[] = [];
  /**
   * A spot in the mulch clear of the hero, the post and earlier plants, inside
   * the band zMin..zMax and |x| <= xMax, and accepted by `ok` when given.
   */
  const findSpot = (
    zMin: number,
    zMax: number,
    xMax: number,
    radius: number,
    maxRho: number,
    ok?: (x: number, z: number) => boolean,
    tries = 80,
  ) => {
    for (let k = 0; k < tries; k++) {
      const x = rng.range(-xMax, xMax);
      const z = rng.range(zMin, zMax);
      if (bedRho(x, z) > maxRho) continue;
      if (Math.hypot(x, z) < HERO_CLEAR + radius * 0.5) continue;
      if (Math.hypot(x - lx, z - lz) < LANTERN_CLEAR + radius) continue;
      if (ok && !ok(x, z)) continue;
      let clash = false;
      for (const t of taken) {
        if (Math.hypot(x - t.x, z - t.z) < (t.r + radius) * CROWDING) {
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

  // --- hostas: broad mounds either side of the hero, one behind it, and the front corners ---
  for (let h = 0; h < budget.hostas; h++) {
    const side = h % 2 === 0 ? -1 : 1;
    const spot =
      h < 2
        ? findSpot(-0.6, -0.18, 0.74, 0.17, 0.8, (x) => x * side > 0.36)
        : h === 2
          ? findSpot(-0.82, -0.55, 0.32, 0.17, 0.82)
          : findSpot(-0.12, 0.12, 0.8, 0.15, 0.86, (x) => x * side > 0.5);
    if (!spot) continue;
    const y0 = surface(spot.x, spot.z);
    const size = h < 3 ? rng.range(1.05, 1.25) : rng.range(0.85, 1.0);
    for (let k = 0; k < budget.hostaLeaves; k++) {
      const a = (k / budget.hostaLeaves) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const ring = k % 2;
      const lean = ring === 0 ? rng.range(0.6, 0.9) : rng.range(0.25, 0.5);
      const s = size * (ring === 0 ? 1 : 0.8) * rng.range(0.85, 1.1);
      compose(ma, spot.x + Math.sin(a) * 0.01, y0 + 0.01, spot.z + Math.cos(a) * 0.01, a, lean, rng.range(-0.15, 0.15), s);
      c.setScalar(rng.range(0.85, 1.05));
      plan.hostaLeaves.push(placementAt(ma, c));
    }
  }

  // --- ferns: back left by the lantern, back right, behind the hero, and out at the sides ---
  for (let f = 0; f < budget.ferns; f++) {
    const spot =
      f === 0
        ? findSpot(-0.85, -0.42, 0.8, 0.15, 0.8, (x) => x < -0.3)
        : f === 1
          ? findSpot(-0.85, -0.45, 0.8, 0.15, 0.8, (x) => x > 0.3)
          : f === 2
            ? findSpot(-0.9, -0.6, 0.3, 0.15, 0.82)
            : findSpot(-0.5, -0.15, 0.86, 0.14, 0.86, (x) => x * (f === 3 ? 1 : -1) > 0.62);
    if (!spot) continue;
    const y0 = surface(spot.x, spot.z);
    const variant = f % 2;
    for (let k = 0; k < budget.fronds; k++) {
      const a = (k / budget.fronds) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const pitch = rng.range(0.4, 1.0);
      const s = rng.range(0.8, 1.12);
      compose(ma, spot.x + Math.sin(a) * 0.012, y0 + 0.01, spot.z + Math.cos(a) * 0.012, a, pitch, 0, s);
      c.setScalar(rng.range(0.85, 1.05));
      plan.fronds[variant].push(placementAt(ma, c));
    }
  }

  // --- lavender: a drift of clumps along the back of the bed, each beside the last ---
  const lavSpots: { x: number; z: number }[] = [];
  for (let p = 0; p < budget.lavenderPlants; p++) {
    const prev = lavSpots.length > 0 ? lavSpots[lavSpots.length - 1] : null;
    const beside = (x: number, z: number) =>
      prev !== null && Math.abs(x - prev.x) > 0.09 && Math.hypot(x - prev.x, z - prev.z) < 0.24;
    const spot = (prev && findSpot(-0.92, -0.42, 0.74, 0.12, 0.84, beside)) || findSpot(-0.92, -0.42, 0.7, 0.12, 0.84);
    if (!spot) continue;
    lavSpots.push(spot);
    const y0 = surface(spot.x, spot.z);
    for (let s = 0; s < budget.spikesPerPlant; s++) {
      const ox = rng.gauss() * 0.045;
      const oz = rng.gauss() * 0.045;
      const x = spot.x + ox;
      const z = spot.z + oz;
      const L = rng.range(0.28, 0.46);
      const r = rng.range(0.0022, 0.003);
      const outward = Math.atan2(ox, oz) + rng.range(-0.5, 0.5);
      const lean = rng.range(0.08, 0.38) * Math.min(1, Math.hypot(ox, oz) / 0.05 + 0.3);
      compose(ma, x, y0, z, outward, lean, 0, r, L, r);
      c.setHSL(0.24, 0.22, rng.range(0.18, 0.24));
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
            rng.range(0.9, 1.25),
          );
          c.copy(palette.lavender).lerp(palette.lavenderTip, 0.5 * t * rng.next());
          c.multiplyScalar(rng.range(0.85, 1.1));
          plan.lavFlorets.push(placementAt(ma, c));
        }
      }
    }
    // silvery foliage round the crown
    for (let k = 0; k < budget.lavenderLeaves; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0.01, 0.07);
      compose(ma, spot.x + Math.sin(a) * d, y0 + rng.range(0.005, 0.05), spot.z + Math.cos(a) * d, a, rng.range(0.5, 1.2), 0, -1, 1, -1);
      c.setHSL(0.27, 0.16, rng.range(0.26, 0.34));
      plan.lavLeaves.push(placementAt(ma, c));
    }
  }

  // --- alyssum: low green cushions along the front kerb, spilling over it, domed with
  // rounded heads of tiny flowers (not a speckle of loose florets) ---
  const [bcx, , bcz] = BED.center;
  for (let m = 0; m < budget.alyssum; m++) {
    let spot: { x: number; z: number } | null = null;
    for (let k = 0; k < 40 && !spot; k++) {
      // the front half of the oval, from one side round to the other, just inside the stones
      const a = rng.range(0.15, Math.PI - 0.15);
      const rr = rng.range(0.7, 0.78);
      const x = bcx + Math.cos(a) * BED.rx * rr;
      const z = bcz + Math.sin(a) * BED.rz * rr;
      if (inFrontOfHero(x, z) || Math.hypot(x - lx, z - lz) < 0.2) continue;
      if (taken.some((t) => Math.hypot(x - t.x, z - t.z) < (t.r + 0.12) * CROWDING)) continue;
      taken.push({ x, z, r: 0.12 });
      spot = { x, z };
    }
    if (!spot) continue;
    // low, wide mats, much wider than they are tall
    const R = rng.range(0.12, 0.16);
    const H = rng.range(0.045, 0.065);
    // the cushion slumps outward, the way it spills over a kerb
    const ox = (spot.x - bcx) / BED.rx;
    const oz = (spot.z - bcz) / BED.rz;
    const ol = Math.hypot(ox, oz) || 1;
    const y0 = surface(spot.x, spot.z);
    // The mat is a few overlapping mounds along the kerb, the cushion leaning
    // out over it, so its outline is lumpy and low rather than one dome.
    const tx = -oz / ol;
    const tz = ox / ol;
    const mounds = [
      { x: 0, z: 0, r: R, h: H },
      { x: R * rng.range(0.5, 0.65), z: rng.range(-0.2, 0.2) * R, r: R * rng.range(0.55, 0.7), h: H * rng.range(0.75, 0.9) },
      { x: -R * rng.range(0.5, 0.65), z: rng.range(-0.2, 0.2) * R, r: R * rng.range(0.5, 0.65), h: H * rng.range(0.7, 0.85) },
    ];
    let area = 0;
    for (const md of mounds) area += md.r * md.r;
    // Fewer, larger heads, each a tight dome of florets lying on the mound's
    // own surface, so the cushion shades as one mass of bloom rather than a
    // scatter of separately lit specks. They draw from their own stream; the
    // shared one is advanced exactly as the earlier, finer heads drew from it,
    // so the cosmos and daisies planned after them keep their places.
    const legacyHeads = Math.max(12, Math.round(budget.alyssumFlorets / 3.6));
    const heads = Math.max(8, Math.round(budget.alyssumFlorets / 6.5));
    const hrng = new Rng(`${seed}|alyssum|${m}`);
    for (const md of mounds) {
      // along the kerb (x) and out over it (z), from the cushion's spot
      const cx0 = spot.x + tx * md.x + (ox / ol) * (R * 0.25 + md.z);
      const cz0 = spot.z + tz * md.x + (oz / ol) * (R * 0.25 + md.z);
      const cy0 = surface(cx0, cz0) - 0.006;
      const yaw = Math.atan2(ox, oz) + rng.range(-0.5, 0.5);
      compose(ma, cx0, cy0, cz0, yaw, 0, 0, md.r, md.h, md.r);
      c.setScalar(rng.range(0.85, 1.05));
      plan.alyssumDomes.push(placementAt(ma, c));
      skipLegacyAlyssumHeads(rng, Math.round((legacyHeads * md.r * md.r) / area));
      // rounded heads of florets all over the mound, down to its skirt, each a tight umbel
      const n = Math.round((heads * md.r * md.r) / area);
      for (let h = 0; h < n; h++) {
        const th = Math.acos(1 - hrng.next() * 0.92);
        const ph = hrng.range(0, Math.PI * 2);
        const perHead = hrng.int(6, 9);
        const headShade = hrng.range(0.86, 1.0) * lerp(0.82, 1.04, Math.cos(th));
        for (let k = 0; k < perHead; k++) {
          // a little cap of florets round the head's centre, on the mound's own lumpy surface
          const a = hrng.range(0, Math.PI * 2);
          const dd = Math.sqrt(hrng.next()) * 0.21;
          const t2 = Math.max(0, th + Math.cos(a) * dd);
          const p2 = ph + (Math.sin(a) * dd) / Math.max(0.2, Math.sin(th));
          // the unit direction in the mound's own frame, turned by the instance's yaw
          tv.set(Math.sin(t2) * Math.cos(p2), Math.cos(t2), Math.sin(t2) * Math.sin(p2));
          const lump = cushionLump(tv.x, tv.y, tv.z) + 0.04 * (1 - dd / 0.21);
          tv.multiplyScalar(lump);
          const cs = Math.cos(yaw);
          const sn = Math.sin(yaw);
          const lx = tv.x * cs + tv.z * sn;
          const lz = -tv.x * sn + tv.z * cs;
          tn.set(lx / md.r, tv.y / md.h, lz / md.r).normalize();
          compose(
            ma,
            cx0 + lx * md.r,
            cy0 + Math.max(0, tv.y) * md.h + 0.002,
            cz0 + lz * md.r,
            Math.atan2(tn.x, tn.z),
            // facing out along the dome, barely jittered, so neighbours catch the light alike
            Math.acos(Math.min(1, tn.y)) + hrng.range(-0.07, 0.07),
            0,
            hrng.range(1.9, 2.4),
          );
          c.copy(palette.alyssum).multiplyScalar(headShade * hrng.range(0.95, 1.02));
          plan.alyssum.push(placementAt(ma, c));
        }
      }
    }
    const cx0 = spot.x + (ox / ol) * R * 0.25;
    const cz0 = spot.z + (oz / ol) * R * 0.25;
    // a fringe of small leaves where the cushion meets the mulch
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const sc = rng.range(0.7, 1.0);
      compose(ma, cx0 + Math.sin(a) * R * 0.8, y0 + 0.002, cz0 + Math.cos(a) * R * 0.8, a, rng.range(1.1, 1.4), 0, -sc, sc, -sc);
      c.setScalar(rng.range(0.8, 0.95));
      plan.spoon.push(placementAt(ma, c));
    }
  }

  // --- cosmos: tall, at the back corners; daisies: shorter, at the sides ---
  const flower = (kind: "cosmos" | "daisy", x: number, z: number) => {
    const y0 = surface(x, z);
    const cosmos = kind === "cosmos";
    const L = cosmos ? rng.range(0.42, 0.62) : rng.range(0.18, 0.3);
    const r = cosmos ? rng.range(0.0028, 0.0034) : rng.range(0.0024, 0.0029);
    // lean mostly toward the viewer so most faces show
    const yaw = rng.next() < 0.7 ? rng.range(-1.0, 1.0) : rng.range(0, Math.PI * 2);
    const lean = rng.range(0.06, 0.28);
    compose(ma, x, y0, z, yaw, lean, 0, r, L, r);
    c.setHSL(0.27, 0.32, rng.range(0.13, 0.19));
    plan.flowerStems.push(placementAt(ma, c));
    const dirx = Math.sin(lean) * Math.sin(yaw);
    const diry = Math.cos(lean);
    const dirz = Math.sin(lean) * Math.cos(yaw);
    const hx = x + dirx * L;
    const hy = y0 + diry * L;
    const hz = z + dirz * L;
    const isBud = rng.next() < 0.15;
    const discR = cosmos ? rng.range(0.011, 0.013) : rng.range(0.013, 0.016);
    if (isBud) {
      compose(ma, hx, hy, hz, yaw, lean, 0, discR * 1.1, discR * 2.4, discR * 1.1);
      plan.buds.push(placementAt(ma, c.copy(palette.budGreen)));
    } else {
      // the head nods a little further over than the stem leans
      const nod = lean + rng.range(0.2, 0.5);
      compose(ma, hx, hy, hz, yaw, nod, 0, 1);
      compose(mb, 0, 0, 0, 0, 0, 0, discR);
      mc.multiplyMatrices(ma, mb);
      plan.discs.push(placementAt(mc, c.copy(palette.disc).multiplyScalar(rng.range(0.9, 1.08))));
      const petals = cosmos ? 8 : rng.int(13, 16);
      const open = cosmos ? rng.range(1.25, 1.42) : rng.range(1.3, 1.5);
      const tint = cosmos ? c.copy(palette.cosmos[0]).lerp(palette.cosmos[1], rng.next()) : c.copy(palette.daisy);
      const scale = rng.range(0.9, 1.1);
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
    const leaves = cosmos ? rng.int(3, 4) : rng.int(5, 7);
    for (let k = 0; k < leaves; k++) {
      const t = cosmos ? rng.range(0.2, 0.65) : rng.range(0.02, 0.12);
      const a = rng.range(0, Math.PI * 2);
      const s = cosmos ? rng.range(1.0, 1.4) : rng.range(0.9, 1.3);
      compose(ma, x + dirx * L * t, y0 + diry * L * t, z + dirz * L * t, a, rng.range(0.9, 1.3), 0, -s, s, -s);
      c.setScalar(rng.range(0.85, 1.05));
      (cosmos ? plan.feathery : plan.spoon).push(placementAt(ma, c));
    }
  };
  // Planted in drifts, the way a gardener sets out bedding: three to five of a
  // kind together round a drift centre, the drifts spread across the bed.
  const drift = (kind: "cosmos" | "daisy", total: number, find: () => { x: number; z: number } | null, spread: number) => {
    let left = total;
    for (let tries = 0; left > 0 && tries < total; tries++) {
      const centre = find();
      if (!centre) continue;
      const n = Math.min(left, rng.int(3, 5));
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = k === 0 ? 0 : rng.range(0.3, 1) * spread;
        const x = centre.x + Math.cos(a) * r;
        const z = centre.z + Math.sin(a) * r * 0.8;
        if (bedRho(x, z) > 0.84 || Math.hypot(x, z) < HERO_CLEAR * 0.85 || inFrontOfHero(x, z)) continue;
        if (Math.hypot(x - lx, z - lz) < LANTERN_CLEAR) continue;
        flower(kind, x, z);
        left--;
      }
    }
  };
  // the back corners and the shoulders behind the hostas, never straight behind the hero
  drift("cosmos", budget.cosmos, () => findSpot(-0.86, -0.36, 0.78, 0.1, 0.82, (x) => Math.abs(x) > 0.3), 0.085);
  drift("daisy", budget.daisies, () => findSpot(-0.48, 0.12, 0.8, 0.1, 0.8, (x, z) => !inFrontOfHero(x, z)), 0.075);

  // --- groundcover: low creeping mats through the open mulch, up to the watering ring ---
  // Patch centres avoid each other so the mats spread across the bed; the
  // rosettes run under the taller plants as a real groundcover does. The
  // saucer round the hero stays clear, a dark ring of watered mulch.
  const patches: { x: number; z: number }[] = [];
  for (let k = 0; k < budget.groundPatches * 6 && patches.length < budget.groundPatches; k++) {
    // the first few patches go round and in front of the hero, where the bed shows most
    const near = patches.length < Math.ceil(budget.groundPatches * 0.4);
    const a = rng.range(0, Math.PI * 2);
    const x = near ? Math.sin(a) * rng.range(0.3, 0.42) : rng.range(-0.85, 0.85);
    const z = near ? Math.cos(a) * rng.range(0.3, 0.4) * 0.8 : rng.range(-0.9, 0.2);
    if (bedRho(x, z) > 0.84 || Math.hypot(x, z) < 0.3) continue;
    if (Math.hypot(x - lx, z - lz) < LANTERN_CLEAR + 0.04) continue;
    if (patches.some((q) => Math.hypot(x - q.x, z - q.z) < 0.16)) continue;
    patches.push({ x, z });
  }
  for (const q of patches) {
    const spread = rng.range(0.06, 0.1);
    for (let k = 0; k < budget.groundRosettes; k++) {
      const x = q.x + rng.gauss() * spread;
      const z = q.z + rng.gauss() * spread;
      if (bedRho(x, z) > 0.88 || Math.hypot(x, z) < 0.25 || Math.hypot(x - lx, z - lz) < LANTERN_CLEAR) continue;
      compose(ma, x, surface(x, z) + 0.002, z, rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12), rng.range(-0.12, 0.12), rng.range(0.8, 1.35));
      c.setScalar(rng.range(0.8, 1.08));
      plan.groundcover.push(placementAt(ma, c));
    }
  }

  // --- clover: creeping in along the inside of the stones and out over them onto the lawn ---
  // (kept to the kerb: scattered through the mulch it would read as weeds in a tended bed)
  for (let i = 0; i < budget.clover; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.next() < 0.35 ? rng.range(0.76, 0.83) : rng.range(SPADE_EDGE[1] + 0.01, SPADE_EDGE[1] + 0.09);
    const x = BED.center[0] + Math.cos(a) * BED.rx * rr;
    const z = BED.center[2] + Math.sin(a) * BED.rz * rr;
    if (Math.hypot(x - lx, z - lz) < 0.13) continue;
    const y = Math.max(0, bedSurfaceY(x, z)) - 0.004;
    compose(ma, x, y, z, rng.range(0, Math.PI * 2), rng.range(-0.15, 0.15), 0, rng.range(0.8, 1.35));
    c.setScalar(rng.range(0.8, 1.1));
    plan.clover.push(placementAt(ma, c));
  }

  return plan;
}
