"use client";
// Shared, cached materials. Keyed by species, colour variant and the quantised
// health band, so forty petals share three materials and a plant that yellows
// swaps to a new one only when it crosses a band. Never dispose these.
import * as THREE from "three";
import type { Species } from "@/lib/plant/species";
import {
  leafNormalTexture,
  leafTexture,
  petalEmissiveTexture,
  petalNormalTexture,
  petalTexture,
  shiftHex,
  stemTexture,
} from "@/lib/plant/textures";
import type { Quality } from "@/lib/garden/store";
import { lerp } from "@/lib/plant/prng";

const cache = new Map<string, THREE.Material>();

function get<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

/** Hue turn and lightness offset for each petal colour variant. */
const VARIANT_JITTER: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.012, 0.09],
  [-0.01, -0.08],
];

export function petalMaterial(
  sp: Species,
  fade: number,
  burn: number,
  quality: Quality,
  variant = 0,
): THREE.MeshPhysicalMaterial {
  const vi = Math.min(VARIANT_JITTER.length - 1, Math.max(0, variant));
  return get(`petal|${sp.id}|${fade}|${burn}|${quality}|${vi}`, () => {
    const f = sp.flower;
    const [dh, dl] = VARIANT_JITTER[vi];
    const map = petalTexture({
      base: shiftHex(f.colorBase, dh, dl),
      mid: shiftHex(f.colorMid, dh, dl),
      tip: shiftHex(f.colorTip, dh * 0.5, dl * 0.6),
      vein: f.veinColor,
      veins: f.veins,
      seed: 1,
      fade,
      burn,
    });
    const cinematic = quality === "cinematic";
    return new THREE.MeshPhysicalMaterial({
      map,
      normalMap: quality === "lite" ? null : petalNormalTexture(f.veins, 1),
      normalScale: new THREE.Vector2(0.35, 0.35),
      emissiveMap: petalEmissiveTexture(f.emissive, f.veins, 1),
      side: THREE.DoubleSide,
      roughness: Math.min(1, f.roughness + fade * 0.3),
      metalness: 0,
      sheen: f.sheen * (1 - fade * 0.7),
      sheenColor: new THREE.Color(f.sheenColor),
      sheenRoughness: 0.5,
      emissive: new THREE.Color(f.emissive),
      emissiveIntensity: f.emissiveDay,
      transmission: cinematic ? f.transmission * (1 - fade) : 0,
      thickness: f.thickness,
      attenuationColor: new THREE.Color(f.attenuationColor),
      attenuationDistance: 0.2,
      ior: 1.35,
      envMapIntensity: 0.8,
      shadowSide: THREE.DoubleSide,
    });
  });
}

export function leafMaterial(sp: Species, fade: number, burn: number, quality: Quality): THREE.MeshPhysicalMaterial {
  return get(`leaf|${sp.id}|${fade}|${burn}|${quality}`, () => {
    const l = sp.leaves;
    const map = leafTexture({ base: l.color, tip: l.tipColor, vein: l.veinColor, seed: 1, fade, burn });
    return new THREE.MeshPhysicalMaterial({
      map,
      normalMap: quality === "lite" ? null : leafNormalTexture(1),
      normalScale: new THREE.Vector2(0.5, 0.5),
      side: THREE.DoubleSide,
      roughness: Math.min(1, lerp(0.72, 0.35, l.gloss) + fade * 0.25),
      metalness: 0,
      sheen: 0.2,
      sheenColor: new THREE.Color(l.veinColor),
      sheenRoughness: 0.8,
      clearcoat: lerp(0.15, 0.6, l.gloss) * (1 - fade),
      clearcoatRoughness: 0.35,
      // light through the blade: backlit leaves glow green instead of going black
      transmission: quality === "cinematic" ? 0.28 * (1 - fade) : quality === "balanced" ? 0.14 * (1 - fade) : 0,
      thickness: 0.03,
      attenuationColor: new THREE.Color(l.tipColor),
      attenuationDistance: 0.12,
      // the sky's blue reflection must not turn the leaves teal
      envMapIntensity: 0.45,
      shadowSide: THREE.DoubleSide,
    });
  });
}

export function stemMaterial(sp: Species, i: number, n: number): THREE.MeshPhysicalMaterial {
  const t = n <= 1 ? 1 : i / (n - 1);
  return get(`stem|${sp.id}|${t.toFixed(2)}`, () => {
    const color = new THREE.Color(sp.stem.color).lerp(new THREE.Color(sp.stem.tipColor), t * 0.8);
    return new THREE.MeshPhysicalMaterial({
      map: stemTexture("#" + color.getHexString(), i + 1),
      roughness: 0.6,
      metalness: 0,
      sheen: 0.35,
      sheenColor: new THREE.Color("#b8d89a"),
      sheenRoughness: 0.85,
      clearcoat: 0.15,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.5,
    });
  });
}

export function petioleMaterial(sp: Species): THREE.MeshPhysicalMaterial {
  return get(`petiole|${sp.id}`, () => {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(sp.leaves.petioleColor ?? sp.stem.tipColor),
      roughness: 0.55,
      metalness: 0,
      sheen: 0.3,
      sheenColor: new THREE.Color("#d8b0a0"),
      sheenRoughness: 0.8,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
    });
  });
}

export function thornMaterial(sp: Species): THREE.MeshPhysicalMaterial {
  return get(`thorn|${sp.id}`, () => {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(sp.stem.thornColor ?? "#7a3a28"),
      roughness: 0.45,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.35,
      sheen: 0.2,
      sheenColor: new THREE.Color("#e0a080"),
    });
  });
}

export function sepalMaterial(sp: Species): THREE.MeshPhysicalMaterial {
  return get(`sepal|${sp.id}`, () => {
    const base = sp.flower.sepals.color;
    return new THREE.MeshPhysicalMaterial({
      // a sepal is a small leaf: midrib, side veins and mottling, in the calyx green
      map: leafTexture({ base, tip: shiftHex(base, 0.01, 0.3), vein: shiftHex(base, 0.02, 0.8), seed: 2, fade: 0, burn: 0 }),
      normalMap: leafNormalTexture(2),
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.6,
      sheen: 0.3,
      sheenColor: new THREE.Color("#b8d89a"),
      sheenRoughness: 0.8,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.45,
      side: THREE.DoubleSide,
    });
  });
}

export function budMaterial(sp: Species): THREE.MeshPhysicalMaterial {
  return get(`bud|${sp.id}`, () => {
    const c = new THREE.Color(sp.flower.colorBase).lerp(new THREE.Color(sp.flower.colorMid), 0.5);
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.5,
      sheen: 0.6,
      sheenColor: new THREE.Color(sp.flower.sheenColor),
      sheenRoughness: 0.6,
      emissive: new THREE.Color(sp.flower.emissive),
      emissiveIntensity: 0.05,
    });
  });
}

export function stamenMaterial(sp: Species): THREE.MeshStandardMaterial {
  return get(`stamen|${sp.id}`, () => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(sp.flower.center.stamenColor),
      emissive: new THREE.Color(sp.flower.center.color),
      emissiveIntensity: 0.35,
      roughness: 0.6,
    });
  });
}

let sphere: THREE.SphereGeometry | null = null;
export function sphereGeometry(): THREE.SphereGeometry {
  if (!sphere) sphere = new THREE.SphereGeometry(1, 24, 16);
  return sphere;
}

let petiole: THREE.CylinderGeometry | null = null;
/** Unit-length thin cylinder along +y, base at the origin. Scale y for length. */
export function petioleGeometry(): THREE.CylinderGeometry {
  if (!petiole) {
    petiole = new THREE.CylinderGeometry(0.0022, 0.0032, 1, 6, 1);
    petiole.translate(0, 0.5, 0);
  }
  return petiole;
}
