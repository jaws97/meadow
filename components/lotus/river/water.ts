"use client";
// The lazy river's water (write-up section 3): one opaque mesh, a MeshStandardMaterial adapted in onBeforeCompile so it
// takes the Meadow's sun, its shadows and the haze like the paving it replaces, and no extra render pass:
// - colour by depth, worked out from the plan in the shader: a warm olive over the 0.5 m ledge along each wall,
//   deepening to teal over the 1.2 m channel; the pockets' still shelves (15 cm over mud) a browner, greener olive;
// - the current: one procedural 256 px normal map sampled twice (1.6 m and 0.7 m, the second sheared a little), scrolled
//   along the ring at 0.10 and 0.06 m/s toward decreasing polar angle; inside a pocket the scroll stops and the ripples
//   drop to 30%; fine ripples fade with distance so the big screen does not shimmer;
// - reflection faked from the reflected ray's angle (the Meadow sky's own gradient and glow, a dark band low down for
//   the hedge and the trees), weighted by Schlick's Fresnel (base 0.02 for water's 1.33), boosted a little as the pond's
//   is so the surface reads as water from the Meadow's high cameras (about 0.026 unboosted at the follow camera's 50
//   degrees from the normal);
// - sun glint from the standard specular at roughness 0.12 (0.18 on lite), broken up by the ripples;
// - gentle foam: a thin cushion round each stone and bridge pier, broken wake lines trailing downstream, and a faint
//   line along the upstream side of each pocket's sill, all drifting with the current; a thin bright waterline and a
//   soft dark band along each wall.
// The pockets are found analytically (they sit at a fixed pitch either side of each cardinal direction, river.ts and
// lib/server/plots.ts: so many a quarter on each bank), so the shader needs only a handful of numbers, plus the stones
// and piers as up to MAX_OBSTACLES segments. Every measure is the Meadow's own (components/meadow/river.ts), which the
// preview shares.
import * as THREE from "three";
import { FLOW, POCKET, RIVER, riverBand } from "@/components/meadow/river";

const BAND = riverBand();

export const MAX_OBSTACLES = 96;
/** The ring's texture radius: the ring's length there (2 pi R0) is a whole number of both ripple tiles (11.2 m), so no seam. */
const R0 = (9 * 11.2) / (2 * Math.PI);

export const waterUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uNormalMap: { value: null as THREE.Texture | null },
  uSkyZenith: { value: new THREE.Color("#86aedb") },
  uSkyHorizon: { value: new THREE.Color("#ecdcc6") },
  uSkyGlow: { value: new THREE.Color("#ffd9a8") },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  /** stones and piers: segment ends (ax, az, bx, bz) and radius; count in use */
  uObs: { value: Array.from({ length: MAX_OBSTACLES }, () => new THREE.Vector4()) },
  uObsR: { value: new Float32Array(MAX_OBSTACLES) },
  uObsCount: { value: 0 },
  /** 0 still .. 1 the river's own drift (a still frame holds the ripples, not the flow) */
  uRipple: { value: 1 },
};

const COMMON = /* glsl */ `#include <common>
varying vec3 vRiverW;
uniform float uTime;
uniform float uNight;
uniform sampler2D uNormalMap;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform vec3 uSunDir;
uniform vec4 uObs[${MAX_OBSTACLES}];
uniform float uObsR[${MAX_OBSTACLES}];
uniform int uObsCount;
uniform float uRipple;
const float W_IN = ${BAND.wIn.toFixed(4)};
const float W_OUT = ${BAND.wOut.toFixed(4)};
const float W_MID = ${BAND.mid.toFixed(4)};
const float P_IN_N = ${POCKET.perArc.in.toFixed(1)};
const float P_OUT_N = ${POCKET.perArc.out.toFixed(1)};
const float LEDGE = ${RIVER.ledge.toFixed(3)};
const float P_LEN = ${POCKET.len.toFixed(3)};
const float P_OUT = ${POCKET.out.toFixed(3)};
const float P_PITCH = ${POCKET.pitch.toFixed(3)};
const float P_LOTUS = ${POCKET.lotusOut.toFixed(3)};
const float R0 = ${R0.toFixed(5)};
const float FLOW_FAST = ${FLOW.fast.toFixed(3)};
const float FLOW_SLOW = ${FLOW.slow.toFixed(3)};
const float HALF_PI = 1.5707963;

// the pocket nearest this point on its bank: (signed distance from its sill line, out from the wall, along the wall)
vec3 riverPocket(float r, float a) {
  bool inner = r < W_MID;
  float face = inner ? W_IN : W_OUT;
  float dir = inner ? 1.0 : -1.0;
  float n = inner ? P_IN_N : P_OUT_N;
  float rl = face + dir * P_LOTUS;
  float c = floor(a / HALF_PI + 0.5) * HALF_PI;
  float d = (a - c) * rl;
  float idx = clamp(floor(d / P_PITCH + (n - 1.0) * 0.5 + 0.5), 0.0, n - 1.0);
  float along = (d - (idx - (n - 1.0) * 0.5) * P_PITCH) * face / rl;
  float outw = (r - face) * dir;
  float s = max(outw, 0.0) / P_OUT;
  float t = abs(along) / (P_LEN * 0.5);
  // the rounded front: s^3 + t^3 = 1 on the sill line (plan.ts pocketReach); scaled to metres near it
  float k = pow(s * s * s + t * t * t, 1.0 / 3.0);
  return vec3((k - 1.0) * P_OUT, outw, along);
}

float riverHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float riverNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(riverHash(i), riverHash(i + vec2(1.0, 0.0)), f.x), mix(riverHash(i + vec2(0.0, 1.0)), riverHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const NORMAL = /* glsl */ `
vec3 rW = vRiverW;
float rR = length(rW.xz);
float rA = atan(rW.z, rW.x);
vec3 rPk = riverPocket(rR, rA);
// 0 in the channel .. 1 well inside a pocket (the sill stones cover the band between)
float rStill = 1.0 - smoothstep(-0.16, -0.04, rPk.x);
// along the flow (it runs toward decreasing angle) and across it, on the seamless ring radius
float rS = -rA * R0;
vec2 rFlowDir = vec2(rW.z, -rW.x) / max(rR, 1e-3);
float rT = uTime * uRipple;
vec2 uvA = vec2(rS - FLOW_FAST * rT, rR) / 1.6;
vec2 uvB = vec2(rS - FLOW_SLOW * rT + 0.35 * rR, rR * 1.07) / 0.7;
// in a pocket the ripples stand still, in world space
vec2 uvP = rW.xz / 1.1 + vec2(0.37, 0.11);
vec3 nA = texture2D(uNormalMap, uvA).xyz * 2.0 - 1.0;
#ifdef RIVER_LITE
// (a phone: the finer layer is a pixel or two at its size)
vec3 nB = nA;
vec3 nP = texture2D(uNormalMap, uvP).xyz * 2.0 - 1.0;
#else
vec3 nB = texture2D(uNormalMap, uvB).xyz * 2.0 - 1.0;
vec3 nP = texture2D(uNormalMap, uvP).xyz * 2.0 - 1.0;
#endif
float rDist = length(cameraPosition - rW);
float rFar = smoothstep(14.0, 70.0, rDist);
// tangent space: x along the flow, y across it (the map is laid on (along, radius))
vec2 rSlope = nA.xy * 0.55 + nB.xy * 0.45 * (1.0 - 0.7 * rFar);
rSlope = mix(rSlope, nP.xy * 0.3, rStill) * (1.0 - 0.55 * rFar);
vec2 rAcross = vec2(rW.x, rW.z) / max(rR, 1e-3);
vec2 rTilt = rFlowDir * rSlope.x + rAcross * rSlope.y;
vec3 rN = normalize(vec3(rTilt.x * 0.55, 1.0, rTilt.y * 0.55));
normal = normalize((viewMatrix * vec4(rN, 0.0)).xyz);
`;

const COLOUR = /* glsl */ `#include <color_fragment>
{
  vec3 w = vRiverW;
  float r = length(w.xz);
  float a = atan(w.z, w.x);
  vec3 pk = riverPocket(r, a);
  float still = 1.0 - smoothstep(-0.16, -0.04, pk.x);
  float wall = min(r - W_IN, W_OUT - r);
  // depth: the ledge along each wall, the slope, the channel; a pocket's shelf is 15 cm over its mud
  float depth = mix(0.3, 1.2, smoothstep(LEDGE - 0.05, LEDGE + 0.85, wall));
  depth = mix(depth, 0.15, still);
  // a garden canal's water, not a pool's: olive over the ledge's stones, a dark olive-teal over the channel (the
  // courtyard pond's tea-green, deeper), never the navy the sky's blue made of it
  vec3 ledgeTint = vec3(0.19, 0.2, 0.11);
  vec3 mudTint = vec3(0.13, 0.125, 0.06);
  vec3 deep = vec3(0.03, 0.058, 0.034);
  vec3 bottom = mix(ledgeTint, mudTint, still);
  float k = 1.0 - exp(-depth * 2.6);
  vec3 body = mix(bottom, deep, k);
  // a pocket's water a touch greener
  body = mix(body, body * vec3(0.92, 1.08, 0.86), still * 0.6);
  // along each wall: the wall's own shade a hand's width out, and a thin bright waterline against the stone
  float edge = smoothstep(0.32, 0.04, wall) * (1.0 - still);
  body *= 1.0 - 0.28 * edge;
  body += vec3(0.20, 0.21, 0.18) * smoothstep(0.035, 0.0, wall);
  // most of water's colour is light scattered back from inside it, from the whole sky, which the sun's shadows barely
  // touch: part of the body is lit by the sky directly (added after the lights), the rest as a surface
  vRiverBody = body;
  diffuseColor.rgb = body * 0.7;

  // foam: a cushion round each stone and pier, broken wake lines downstream, a faint line along each pocket's sill
  vec2 F = vec2(w.z, -w.x) / max(r, 1e-3);
  vec2 Fp = vec2(-F.y, F.x);
  float sAlong = -a * R0;
  float drift = sAlong - FLOW_FAST * 1.2 * uTime * uRipple;
  float foam = 0.0;
  for (int i = 0; i < ${MAX_OBSTACLES}; i++) {
    if (i >= uObsCount) break;
    vec4 o = uObs[i];
    float rad = uObsR[i];
    vec2 pa = o.xy, pb = o.zw;
    vec2 cen = (pa + pb) * 0.5;
    vec2 dc = w.xz - cen;
    float reach = length(pb - pa) * 0.5 + rad + 2.6;
    if (dot(dc, dc) > reach * reach) continue;
    vec2 ab = pb - pa;
    float h = clamp(dot(w.xz - pa, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
    float dseg = length(w.xz - pa - ab * h);
    // upstream faces carry the cushion; it thins round the sides
    float up = clamp(0.55 - dot(normalize(w.xz - pa - ab * h + 1e-4), F) * 0.6, 0.0, 1.0);
    // (wider and brighter on the piers' upstream noses, where the current piles against the stone)
    float ring = exp(-pow((dseg - rad - 0.025) / 0.034, 2.0)) * (0.35 + 0.9 * up);
    // the wake from the downstream end
    vec2 tail = dot(pb - pa, F) > 0.0 ? pb : pa;
    vec2 q = w.xz - tail;
    float qs = dot(q, F);
    float qt = abs(dot(q, Fp));
    float spread = rad * 0.85 + qs * 0.13;
    float line = exp(-pow((qt - spread) / (0.016 + qs * 0.014), 2.0)) * exp(-qs / 1.1) * step(0.0, qs);
    foam += ring * 0.5 + line * 0.32;
  }
  // along the upstream half of each pocket's sill, just outside the stones
  float upEnd = smoothstep(-0.2, 0.9, pk.z / (P_LEN * 0.5));
  foam += exp(-pow((pk.x - 0.12) / 0.022, 2.0)) * (0.1 + 0.6 * upEnd) * 0.3 * step(0.0, pk.y);
  // broken into drifting streaks
  float n1 = riverNoise(vec2(drift * 3.1, r * 9.0));
#ifdef RIVER_LITE
  float n2 = 0.5;
#else
  float n2 = riverNoise(vec2(drift * 7.3 + 11.0, r * 21.0 + 3.0));
#endif
  foam *= smoothstep(0.42, 0.85, n1 * 0.65 + n2 * 0.45);
  foam = clamp(foam, 0.0, 0.42);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.82, 0.79), foam);
  vRiverFoam = foam;
}`;

const REFLECT = /* glsl */ `
{
  vec3 V = normalize(cameraPosition - vRiverW);
  vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 R = reflect(-V, nW);
  float h = clamp(R.y, -1.0, 1.0);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(smoothstep(-0.02, 0.85, h), 0.7));
  float sunA = max(dot(R, normalize(uSunDir)), 0.0);
  sky += uSkyGlow * (pow(sunA, 10.0) * 0.4 + pow(1.0 - abs(h), 6.0) * 0.18);
  // the hedge and the trees beyond it, low round the horizon: a dark green band
  vec3 trees = vec3(0.06, 0.09, 0.05) * (0.3 + 0.7 * (uSkyHorizon.r + uSkyHorizon.g) * 0.5);
  sky = mix(trees, sky, smoothstep(0.12, 0.34, h));
  // by night the open sky is lit by the moon and the town's glow, and a dark canal shows a deep blue sheen of it (the
  // paving round it reads moonlit), against which the lamps' streaks stand out (a little more of it on lite, whose
  // phone screens and plainer light left the channel near black)
#ifdef RIVER_LITE
  sky += vec3(0.035, 0.05, 0.11) * 1.6 * uNight * smoothstep(0.12, 0.5, h);
#else
  sky += vec3(0.035, 0.05, 0.11) * uNight * smoothstep(0.12, 0.5, h);
#endif
  float cosT = clamp(dot(nW, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  F = clamp(F * (1.5 + 2.5 * uNight), 0.0, 0.6) * (1.0 - vRiverFoam);
  // the sky's light scattered back from inside the water, its blue spent on the way and the rest greened by what the
  // water carries (a canal is not a pool)
  vec3 skyLight = mix(uSkyHorizon, uSkyZenith, 0.45);
  skyLight = mix(vec3(dot(skyLight, vec3(0.3, 0.59, 0.11))), skyLight, 0.12) * vec3(0.92, 1.0, 0.82);
  outgoingLight += vRiverBody * skyLight * 0.9 * (1.0 - vRiverFoam);
  outgoingLight = outgoingLight * (1.0 - F) + sky * F;
}
#include <opaque_fragment>`;

let normalMap: THREE.DataTexture | null = null;

/**
 * The ripples: a tileable height field of wave trains (whole-number wave vectors, so it repeats) leaning across the
 * flow, as a current's ripples do, with fine chop; normals by central differences. Original procedural art.
 */
export function rippleNormalMap(): THREE.DataTexture {
  if (normalMap) return normalMap;
  const N = 256;
  let s = 913;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const waves: Array<{ kx: number; ky: number; amp: number; ph: number }> = [];
  for (let i = 0; i < 38; i++) {
    const kx = Math.round((rnd() - 0.5) * 2 * (i < 14 ? 5 : 11));
    let ky = Math.round((rnd() - 0.5) * 2 * (i < 14 ? 3 : 9));
    if (kx === 0 && ky === 0) ky = 1;
    const k = Math.hypot(kx, ky);
    // crests across the flow (wave vectors along x, the flow) are favoured
    const along = Math.abs(kx) / k;
    waves.push({ kx, ky, amp: (0.55 + 0.45 * along) / Math.pow(k, 1.25), ph: rnd() * Math.PI * 2 });
  }
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * Math.PI * 2;
      const v = (y / N) * Math.PI * 2;
      let sum = 0;
      for (const w of waves) sum += w.amp * Math.sin(w.kx * u + w.ky * v + w.ph);
      h[y * N + x] = sum;
    }
  }
  let max = 0;
  for (let i = 0; i < h.length; i++) max = Math.max(max, Math.abs(h[i]));
  const data = new Uint8Array(N * N * 4);
  const strength = 2.2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const at = (xx: number, yy: number) => h[((yy + N) % N) * N + ((xx + N) % N)] / max;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  normalMap = t;
  return t;
}

/**
 * The river's surface material (one per tier: the lite tier's glint is a little broader, and it reads one ripple layer
 * and one octave of the foam's breaking where the others read two).
 */
export function riverWaterMaterial(lite: boolean): THREE.MeshStandardMaterial {
  waterUniforms.uNormalMap.value = rippleNormalMap();
  const m = new THREE.MeshStandardMaterial({ color: "#2b4f4c", roughness: lite ? 0.18 : 0.12, metalness: 0, envMapIntensity: 0 });
  if (lite) m.defines = { RIVER_LITE: "" };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRiverW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRiverW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", COMMON + "\nfloat vRiverFoam = 0.0;\nvec3 vRiverBody = vec3(0.0);")
      .replace("#include <color_fragment>", COLOUR)
      .replace("#include <normal_fragment_maps>", NORMAL)
      .replace("#include <opaque_fragment>", REFLECT);
  };
  m.customProgramCacheKey = () => "lotus-river-water-4" + (lite ? "-lite" : "");
  return m;
}
