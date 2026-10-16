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
import * as THREE from "three";
import { withGardenLight } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { soilBumpTexture, soilTexture, stoneTexture, woodTexture } from "@/lib/garden/groundTextures";
import { lerp, smoothstep } from "@/lib/plant/prng";
import type { Weather } from "@/components/garden/garden/weather";

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
    mulch: withGardenLight(
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
    water: new THREE.MeshStandardMaterial({
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
  m.can.roughness = lerp(0.6, 0.28, wet);

  // Mulch reads the watering as well as the rain: pale and dusty when the
  // bed is thirsty, rich and dark once it has been watered or rained on.
  const thirsty = 1 - smoothstep(0.08, 0.32, w.moisture);
  const soaked = Math.max(wet, 0.55 * smoothstep(0.62, 1, w.moisture));
  m.mulch.color.copy(WHITE).lerp(DRY_MULCH, thirsty * (1 - wet)).lerp(WET_MULCH, soaked);
  m.mulch.roughness = lerp(0.96, 0.5, soaked);
  m.pathBed.color.copy(WHITE).lerp(WET_MULCH, wet);
  m.pathBed.roughness = lerp(0.98, 0.55, wet);

  m.water.opacity = 0.88 * smoothstep(0.02, 0.6, w.puddle);
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
