"use client";
// Materials for the near garden's hardscape: the mulch, the stones (border,
// flagstones and the lantern's plinth share one), the trodden path, the moss,
// the lantern's wood, iron, glass, wax and flame, and the standing water.
// They are shared singletons, created on first use and never disposed, like
// the plant's cached materials; the textures come from the canvas caches.
// `driveGardenMaterials` turns the eased weather into colour and gloss once
// per frame: wet stone darkens and shines, watered mulch goes deep brown,
// thirsty mulch pales, and the lantern's glass and wax glow as it is lit.
// The hardscape takes the garden's light patch (lib/garden/dressing): the
// lite tier's stand-in for the lantern's light, and on the stone and wood a
// warm rim when the low sun stands behind them.
//
// The watering can's moment (components/garden/garden/canLive) wets the bed where its water lands, not all at once:
// the mulch and the seed's mound take a patch, dark and glossier with a ragged edge, where the shower falls, the wet
// running round the saucer's ring and creeping up the mound toward the stem; the saucer's standing water runs round
// the ring from where it fell; the can's zinc shines where the water ran. Uniform-branched, so at rest it costs a test.
import * as THREE from "three";
import { withGardenLight } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { soilBumpTexture, soilTexture, stoneTexture, woodTexture } from "@/lib/garden/groundTextures";
import { lerp, smoothstep } from "@/lib/plant/prng";
import { canLive } from "@/components/garden/garden/canLive";
import type { Weather } from "@/components/garden/garden/weather";

/**
 * The can's wet on the soil, shared by every program that takes it (the bed's mulch, the seed's mound), in world
 * space round the stem: uWetLand (patch centre x, z, radius m, strength), uWetRing (the ring's middle bearing from +x
 * toward +z, how far round it has run (rad), its strength, and the creep up the mound 0..1), uWetLook (how much of
 * the wet is colour, how much gloss).
 */
export const canWetUniforms = {
  uWetLand: { value: new THREE.Vector4(0, 0, 0.045, 0) },
  uWetRing: { value: new THREE.Vector4(0, 0, 0, 0) },
  uWetLook: { value: new THREE.Vector4(1, 1, 0, 0) },
};

/**
 * The standing water in the saucer runs round the ring from the can's landing: (bearing, how far round (rad), and the
 * share of its opacity kept outside that reach, so the rain's own water there stays as it was).
 */
const waterSweep = { value: new THREE.Vector3(0, Math.PI, 1) };

const WET_COMMON = /* glsl */ `#include <common>
uniform vec4 uWetLand;
uniform vec4 uWetRing;
uniform vec4 uWetLook;
float wetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wetNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wetHash(i), wetHash(i + vec2(1.0, 0.0)), u.x), mix(wetHash(i + vec2(0.0, 1.0)), wetHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float canWet(vec2 p) {
  // all of it lies within about 0.3 m of the stem (the ring, a patch on it or the mound, the creep inward): the rest of
  // the bed skips the work
  if (dot(p, p) > 0.1 && distance(p, uWetLand.xy) > uWetLand.z * 1.4) return 0.0;
  float n = wetNoise(p * 38.0) * 0.6 + wetNoise(p * 95.0) * 0.4;
  vec2 d = p - uWetLand.xy;
  // the patch where the shower lands, its edge ragged
  float blob = 1.0 - smoothstep(uWetLand.z * 0.45, uWetLand.z * (0.8 + 0.4 * n), length(d));
  // the wet creeping up the mound toward the stem
  float reach = length(uWetLand.xy);
  vec2 inward = -uWetLand.xy / max(reach, 1e-3);
  float along = clamp(dot(d, inward), 0.0, uWetRing.w * reach * 0.8);
  float creep = (1.0 - smoothstep(0.016, 0.03 + 0.012 * n, length(d - inward * along))) * step(0.001, uWetRing.w);
  // round the saucer's ring, both ways from the middle of the sweep
  float band = exp(-pow((length(p) - 0.17) / (0.03 + 0.012 * n), 2.0));
  float da = abs(mod(atan(p.y, p.x) - uWetRing.x + 3.1415927, 6.2831853) - 3.1415927);
  float ringWin = max(1.0 - smoothstep(uWetRing.y - 0.25 + 0.15 * n, uWetRing.y + 0.05, da), smoothstep(2.9, 3.1, uWetRing.y));
  return clamp(max(max(blob, creep) * uWetLand.w, band * ringWin * uWetRing.z), 0.0, 1.0);
}`;

const WET_COLOR = /* glsl */ `#include <color_fragment>
float wetM = 0.0;
if (uWetLand.w + uWetRing.z > 0.001) {
  wetM = canWet(vLampWorld.xz);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.45, 0.41), wetM * uWetLook.x);
}`;

const WET_ROUGH = /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.4, wetM * uWetLook.y);`;

/**
 * Gives a garden-lit soil material (withGardenLight first: it carries the world position this reads) the can's wet.
 * Chains any onBeforeCompile already set; `key` must be unique per shader variant.
 */
export function withCanWet<T extends THREE.MeshStandardMaterial>(m: T, key: string): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.uniforms.uWetLand = canWetUniforms.uWetLand;
    shader.uniforms.uWetRing = canWetUniforms.uWetRing;
    shader.uniforms.uWetLook = canWetUniforms.uWetLook;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", WET_COMMON)
      .replace("#include <color_fragment>", WET_COLOR)
      .replace("#include <roughnessmap_fragment>", WET_ROUGH);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + "|" + key;
  return m;
}

/** The saucer's standing water, shown only as far round the ring as the can's water has run. */
function withSweep(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSweep = waterSweep;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSaucer;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSaucer = position.xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSweep;\nvarying vec2 vSaucer;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nif (uSweep.y < 3.1) {\n" +
          "  float da = abs(mod(atan(vSaucer.y, vSaucer.x) - uSweep.x + 3.1415927, 6.2831853) - 3.1415927);\n" +
          // the reach closes the ring's far side softly as it comes round, never in one frame
          "  float reach = max(1.0 - smoothstep(uSweep.y - 0.2, uSweep.y + 0.05, da), smoothstep(2.9, 3.1, uSweep.y));\n" +
          "  diffuseColor.a *= mix(uSweep.z, 1.0, reach);\n}",
      );
  };
  m.customProgramCacheKey = () => "garden-water|sweep";
  return m;
}

export interface GardenMaterials {
  mulch: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  pathBed: THREE.MeshStandardMaterial;
  moss: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  /** the watering can's worn paint and zinc */
  can: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  candle: THREE.MeshStandardMaterial;
  flame: THREE.MeshBasicMaterial;
  water: THREE.MeshStandardMaterial;
  /** soft dark contact shadows on the ground round the kerb stones (alpha from the vertex colour) */
  contact: THREE.MeshBasicMaterial;
}

let shared: GardenMaterials | null = null;

/** Flame colour multiplier: well over 1 so the bloom pass catches it. */
const FLAME_HDR = 3.5;
const GLOW = new THREE.Color("#ffb26a");
/** The panes glow deeper than the wax, so the lamp reads amber rather than blown white. */
const PANE_GLOW = new THREE.Color("#ff9440");
const WHITE = new THREE.Color(1, 1, 1);
const WET_STONE = new THREE.Color(0.58, 0.58, 0.56);
const WET_MULCH = new THREE.Color(0.62, 0.56, 0.52);
const DRY_MULCH = new THREE.Color(1.22, 1.14, 1.04);
const WET_MOSS = new THREE.Color(0.72, 0.78, 0.7);
const WET_WOOD = new THREE.Color(0.68, 0.64, 0.6);
/** How much of the sky's colour the standing water gives back. */
const WATER_SKY = 0.05;

export function gardenMaterials(): GardenMaterials {
  if (shared) return shared;
  shared = {
    mulch: withCanWet(
      withGardenLight(
        new THREE.MeshStandardMaterial({
          map: soilTexture(1),
          bumpMap: soilBumpTexture(1),
          bumpScale: 1.2,
          vertexColors: true,
          roughness: 0.96,
          metalness: 0,
        }),
        "garden-mulch",
        false,
      ),
      "canwet",
    ),
    stone: withGardenLight(
      new THREE.MeshStandardMaterial({
        map: stoneTexture(1),
        vertexColors: true,
        roughness: 0.86,
        metalness: 0,
        envMapIntensity: 0.6,
      }),
      "garden-stone",
      true,
    ),
    // Trodden earth between the flagstones: the mulch's relief without its bark colours.
    pathBed: withGardenLight(
      new THREE.MeshStandardMaterial({
        bumpMap: soilBumpTexture(1),
        bumpScale: 0.8,
        vertexColors: true,
        roughness: 0.98,
        metalness: 0,
      }),
      "garden-path",
      false,
    ),
    moss: withGardenLight(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.4 }),
      "garden-moss",
      true,
    ),
    wood: withGardenLight(
      new THREE.MeshStandardMaterial({ map: woodTexture(1), vertexColors: true, roughness: 0.85, metalness: 0 }),
      "garden-wood",
      true,
    ),
    iron: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.55, envMapIntensity: 0.8 }),
    can: withGardenLight(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.7 }),
      "garden-can",
      true,
    ),
    glass: new THREE.MeshStandardMaterial({
      color: "#fff6e6",
      transparent: true,
      opacity: 0.22,
      roughness: 0.06,
      metalness: 0,
      envMapIntensity: 1.3,
      emissive: PANE_GLOW,
      emissiveIntensity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    candle: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0,
      emissive: GLOW,
      emissiveIntensity: 0,
    }),
    flame: new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: new THREE.Color(FLAME_HDR, FLAME_HDR, FLAME_HDR),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
    water: withSweep(
      new THREE.MeshStandardMaterial({
        color: "#2a3226",
        roughness: 0.04,
        metalness: 0,
        envMapIntensity: 1.6,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        emissive: "#000000",
      }),
    ),
    contact: new THREE.MeshBasicMaterial({
      color: "#0a0804",
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  };
  return shared;
}

export function driveGardenMaterials(m: GardenMaterials, w: Weather) {
  const wet = w.wet;
  m.stone.color.copy(WHITE).lerp(WET_STONE, wet);
  m.stone.roughness = lerp(0.86, 0.32, wet);
  m.moss.color.copy(WHITE).lerp(WET_MOSS, wet);
  m.moss.roughness = lerp(1, 0.62, wet);
  m.wood.color.copy(WHITE).lerp(WET_WOOD, wet);
  // the can shines in the rain, and for a minute where its own water ran down it
  const can = canLive.soil;
  m.can.roughness = lerp(0.6, 0.28, Math.max(wet, 0.75 * can.canWet));
  // the can's water on the soil: where it landed, round the ring, up the mound
  canWetUniforms.uWetLand.value.set(canLive.patch.x, canLive.patch.y, 0.045, can.patch);
  canWetUniforms.uWetRing.value.set(canLive.ringBearing, can.ringHalf, can.ring, can.creep);
  canWetUniforms.uWetLook.value.set(can.tone, can.gloss, 0, 0);
  waterSweep.value.x = canLive.ringBearing;
  waterSweep.value.y = w.puddleHalf;

  // Mulch reads the watering as well as the rain: pale and dusty when the
  // bed is thirsty, rich and dark once it has been watered or rained on.
  const thirsty = 1 - smoothstep(0.08, 0.32, w.moisture);
  const soaked = Math.max(wet, 0.55 * smoothstep(0.62, 1, w.moisture));
  m.mulch.color.copy(WHITE).lerp(DRY_MULCH, thirsty * (1 - wet)).lerp(WET_MULCH, soaked);
  m.mulch.roughness = lerp(0.96, 0.5, soaked);
  m.pathBed.color.copy(WHITE).lerp(WET_MULCH, wet);
  m.pathBed.roughness = lerp(0.98, 0.55, wet);

  const shown = smoothstep(0.02, 0.6, w.puddle);
  m.water.opacity = 0.88 * shown;
  // where the can's water has not yet run round to, the rain's own standing water stays exactly as it was
  waterSweep.value.z = w.puddleHalf < 3.1 && shown > 1e-4 ? Math.min(1, smoothstep(0.02, 0.6, w.standing) / shown) : 1;
  // The environment map is a studio of light panels, not the sky, so the
  // water borrows the sky's own colour as a faint glow: it reads as a sheet
  // reflecting the clouds instead of a dark stain in the mulch.
  m.water.emissive.copy(env.sky.horizon).lerp(env.sky.zenith, 0.4).multiplyScalar(WATER_SKY);

  const glow = w.lit * w.flicker;
  m.glass.emissiveIntensity = 0.35 * glow;
  // By day the panes are clear glass with a little sky in them, not a milky lit box.
  m.glass.opacity = lerp(0.1, 0.22, w.lit);
  m.glass.envMapIntensity = lerp(0.55, 1.3, w.lit);
  m.candle.emissiveIntensity = 0.7 * glow;
  m.flame.opacity = w.lit;
}
