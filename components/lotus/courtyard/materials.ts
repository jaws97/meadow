"use client";
// The courtyard's materials, cached by key and never disposed (as components/lotus/materials). Every lit one takes
// the garden's light patch (lib/garden/dressing withGardenLight: the lite tier's lamp stand-in, and the golden-hour
// rim where it helps); the stone round the water takes one more patch of its own, the water's light: sunlight thrown
// up off the rippled tank, dancing on the risers and the coping near the water (as the urli's far wall did, art
// direction 3.5), strongest on faces that look at the water. The tank's walls under the water share the pond's
// underwater patch (depth fade, caustics).
import * as THREE from "three";
import { withGardenLight } from "@/lib/garden/dressing";
import { withUnderwater } from "@/components/lotus/materials";
import type { Tier } from "@/components/lotus/geometry";
import { POND } from "@/components/lotus/pond";
import {
  arecaTrunkTexture,
  bananaLeafTexture,
  bananaStemTexture,
  brassTexture,
  GRANITE_TILE,
  graniteTextures,
  LATERITE_TILE,
  lateriteTextures,
  teakTexture,
  tileTexture,
  wingTexture,
} from "@/components/lotus/courtyard/textures";

const cache = new Map<string, THREE.Material>();

function get<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

/** Every material whose look the rain changes (darker and glossier when wet), with its dry colour and roughness. */
export const wettable: { m: THREE.MeshStandardMaterial; colour: THREE.Color; rough: number; dark: number }[] = [];

function wets<T extends THREE.MeshStandardMaterial>(m: T, dark: number): T {
  wettable.push({ m, colour: m.color.clone(), rough: m.roughness, dark });
  return m;
}

/** Writes the rain's wetness into every wettable material (0 dry .. 1 soaked). */
export function wetCourt(wet: number) {
  for (const w of wettable) {
    w.m.color.copy(w.colour).multiplyScalar(1 - w.dark * wet);
    w.m.roughness = w.rough - (w.rough - 0.18) * 0.8 * wet;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The water's light on the stone

export const waterLightUniforms = {
  /** strength: the sun on the water (0 at night, in shade of cloud) */
  uWaterLight: { value: 0 },
  uWaterLightColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uWaterLightTime: { value: 0 },
  /** the water's rectangle (world x0, z0, x1, z1) and its level */
  uWaterRect: { value: new THREE.Vector4(POND.cx - POND.rx, POND.cz - POND.rz, POND.cx + POND.rx, POND.cz + POND.rz) },
  uWaterLevel: { value: POND.waterY },
};

const WL_VERT_COMMON = "#include <common>\nvarying vec3 vWlWorld;\nvarying vec3 vWlNormal;";
const WL_VERT =
  "#include <worldpos_vertex>\n" +
  "{ vec4 wl = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wl = instanceMatrix * wl;\n#endif\n" +
  "  vWlWorld = (modelMatrix * wl).xyz; vWlNormal = normalize(mat3(modelMatrix) * objectNormal); }";
const WL_FRAG_COMMON = /* glsl */ `#include <common>
varying vec3 vWlWorld;
varying vec3 vWlNormal;
uniform float uWaterLight;
uniform vec3 uWaterLightColor;
uniform float uWaterLightTime;
uniform vec4 uWaterRect;
uniform float uWaterLevel;
float wlCells(vec2 p, float t) {
  vec2 a = p + vec2(sin(p.y * 1.7 + t * 0.9), cos(p.x * 1.3 - t * 0.8)) * 0.7;
  vec2 b = p * 1.7 + vec2(cos(p.y * 1.1 - t * 0.7), sin(p.x * 1.5 + t * 1.1)) * 0.6;
  return 0.6 * pow(1.0 - abs(sin(a.x) * sin(a.y)), 4.0) + 0.4 * pow(1.0 - abs(sin(b.x + 1.1) * sin(b.y - 0.4)), 4.0);
}`;
const WL_FRAG = /* glsl */ `#include <emissivemap_fragment>
if (uWaterLight > 0.0) {
  // how far the point stands from the water's rectangle in plan, and over its surface
  vec2 c = clamp(vWlWorld.xz, uWaterRect.xy, uWaterRect.zw);
  vec2 off = vWlWorld.xz - c;
  float d = length(off);
  float h = vWlWorld.y - uWaterLevel;
  if (d < 0.5 && h > 0.0 && h < 0.5) {
    // faces turned toward the water (toward its middle and down to it) catch the light it throws up
    vec2 mid = (uWaterRect.xy + uWaterRect.zw) * 0.5;
    vec3 toWater = normalize(vec3(mid.x - vWlWorld.x, -0.25 - h, mid.y - vWlWorld.z));
    float facing = clamp(dot(normalize(vWlNormal), toWater) + 0.1, 0.0, 1.0);
    float near = (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - smoothstep(0.0, 0.42, h)) * smoothstep(0.0, 0.01, h);
    // the pattern drifting with the ripples, its cells a few centimetres across in both directions on every face (a
    // pattern fine along the face and coarse up it drew vertical stripes, which read as fluting on the coping)
    vec2 q = vec2((vWlWorld.x + vWlWorld.z) * 26.0, vWlWorld.y * 26.0 - d * 9.0 + (vWlWorld.x - vWlWorld.z) * 6.0);
    // a net of bright lines (the ripples' foci) over a faint even glow, as sunlight thrown off water lies on stone
    float cells = wlCells(q, uWaterLightTime * 1.3);
    float web = pow(clamp(cells, 0.0, 1.2), 2.2);
    totalEmissiveRadiance += uWaterLightColor * uWaterLight * near * facing * (0.12 + 1.4 * web) * diffuseColor.rgb;
  }
}`;

function withWaterLight<T extends THREE.Material>(m: T, key: string): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, waterLightUniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", WL_VERT_COMMON).replace("#include <worldpos_vertex>", WL_VERT);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", WL_FRAG_COMMON).replace("#include <emissivemap_fragment>", WL_FRAG);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + "|wl-" + key;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stone

function graniteMaps(tier: Tier) {
  const g = graniteTextures();
  const map = g.map.clone();
  map.repeat.set(1 / GRANITE_TILE, 1 / GRANITE_TILE);
  map.needsUpdate = true;
  let normal: THREE.Texture | null = null;
  if (tier !== "lite") {
    normal = g.normal.clone();
    normal.repeat.set(1 / GRANITE_TILE, 1 / GRANITE_TILE);
    normal.needsUpdate = true;
  }
  return { map, normal };
}

/** The steps, the coping and the slabs: block-tinted granite, its fine grain, the water's light near the tank. */
export function graniteMaterial(tier: Tier): THREE.MeshStandardMaterial {
  return get(`granite|${tier}`, () => {
    const { map, normal } = graniteMaps(tier);
    const m = new THREE.MeshStandardMaterial({
      map,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      vertexColors: true,
      roughness: 0.74,
      metalness: 0,
      envMapIntensity: 0.4,
    });
    return wets(withWaterLight(withGardenLight(m, "court-granite", true), "granite"), 0.38);
  });
}

/** Dressed granite (the niche's frame and sill, the walls' coping, the veranda's plinth): finer, a touch paler. */
export function dressedMaterial(tier: Tier): THREE.MeshStandardMaterial {
  return get(`dressed|${tier}`, () => {
    const { map, normal } = graniteMaps(tier);
    const m = new THREE.MeshStandardMaterial({
      map,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.3, 0.3),
      color: "#a8a49b",
      roughness: 0.62,
      metalness: 0,
      envMapIntensity: 0.45,
    });
    return wets(withGardenLight(m, "court-dressed", true), 0.35);
  });
}

/** The joints' bedding: dark lime mortar and grit. */
export function beddingMaterial(): THREE.MeshStandardMaterial {
  return get("bedding", () => wets(withGardenLight(new THREE.MeshStandardMaterial({ color: "#5d5852", roughness: 1, metalness: 0 }), "court-bedding", false), 0.3));
}

/** The tank's walls and floor under the water: granite blocks, then silt, under the pond's underwater patch. */
export function tankBasinMaterial(tier: Tier): THREE.MeshStandardMaterial {
  return get(`tankBasin|${tier}`, () => {
    const { map } = graniteMaps(tier);
    // a season's film of algae and silt over the stone: olive-dark, as a tank's walls are under water
    return withUnderwater(new THREE.MeshStandardMaterial({ map, color: "#5d5c47", vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.2 }), "tank-basin");
  });
}

/** The laterite walls (and the niche's sooted interior): porous rust-brown blocks, their pits in the normal map. */
export function lateriteMaterial(tier: Tier): THREE.MeshStandardMaterial {
  return get(`laterite|${tier}`, () => {
    const l = lateriteTextures();
    const map = l.map.clone();
    map.repeat.set(1 / LATERITE_TILE[0], 1 / LATERITE_TILE[1]);
    map.needsUpdate = true;
    let normal: THREE.Texture | null = null;
    if (tier !== "lite") {
      normal = l.normal.clone();
      normal.repeat.copy(map.repeat);
      normal.needsUpdate = true;
    }
    const m = new THREE.MeshStandardMaterial({
      map,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.3,
    });
    return wets(withGardenLight(m, "court-laterite", true), 0.32);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Brass, clay, wood, tiles

/** Brass: a warm metal with its tarnish, polished bright on the rims and knops (metalness 1). */
export function brassMaterial(): THREE.MeshStandardMaterial {
  return get("brass", () =>
    withGardenLight(
      new THREE.MeshStandardMaterial({ map: brassTexture(), color: "#c9a362", metalness: 1, roughness: 0.44, envMapIntensity: 1.0 }),
      "court-brass",
      true,
    ),
  );
}

/** Fired clay: the small lamps, matte unglazed terracotta (the first renders' read as glossy red pucks). */
export function clayMaterial(): THREE.MeshStandardMaterial {
  return get("clay2", () => withGardenLight(new THREE.MeshStandardMaterial({ color: "#a8714d", roughness: 0.96, metalness: 0, envMapIntensity: 0.12 }), "court-clay", false));
}

/** The lamp oil in a clay lamp's well: dark, glossy, a little amber where the flame lights it. */
export function oilMaterial(): THREE.MeshStandardMaterial {
  return get("oil", () => new THREE.MeshStandardMaterial({ color: "#2a1a0e", roughness: 0.12, metalness: 0, envMapIntensity: 0.6 }));
}

export function teakMaterial(): THREE.MeshStandardMaterial {
  return get("teak", () => withGardenLight(new THREE.MeshStandardMaterial({ map: teakTexture(), roughness: 0.6, metalness: 0 }), "court-teak", false));
}

/** The house's lime wash: a warm off-white, a little weathered (behind the camera; seen in a look round). */
export function limeMaterial(): THREE.MeshStandardMaterial {
  return get("lime", () => withGardenLight(new THREE.MeshStandardMaterial({ color: "#d9d0bf", roughness: 0.95, metalness: 0 }), "court-lime", false));
}

/** The doorway's dark interior. */
export function doorwayMaterial(): THREE.MeshStandardMaterial {
  return get("doorway", () => new THREE.MeshStandardMaterial({ color: "#1c1510", roughness: 1, metalness: 0 }));
}

export function tileMaterial(): THREE.MeshStandardMaterial {
  return get("tile", () => {
    const t = tileTexture().clone();
    t.repeat.set(1 / 0.5, 1 / 0.5);
    t.needsUpdate = true;
    return withGardenLight(new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), "court-tile", false);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Plants

export function bananaLeafMaterial(): THREE.MeshStandardMaterial {
  return get("bananaLeaf", () =>
    withGardenLight(
      new THREE.MeshStandardMaterial({ map: bananaLeafTexture(), vertexColors: true, side: THREE.DoubleSide, roughness: 0.72, metalness: 0, envMapIntensity: 0.25 }),
      "court-banana-leaf",
      true,
    ),
  );
}

export function bananaStemMaterial(): THREE.MeshStandardMaterial {
  return get("bananaStem", () => withGardenLight(new THREE.MeshStandardMaterial({ map: bananaStemTexture(), roughness: 0.6, metalness: 0 }), "court-banana-stem", true));
}

export function arecaTrunkMaterial(): THREE.MeshStandardMaterial {
  return get("arecaTrunk", () => {
    const t = arecaTrunkTexture().clone();
    t.repeat.set(1, 0.5);
    t.needsUpdate = true;
    return withGardenLight(new THREE.MeshStandardMaterial({ map: t, roughness: 0.78, metalness: 0 }), "court-areca", true);
  });
}

/** Vertex-coloured foliage, both sides (the areca's fronds and crownshaft, the jasmine's leaves). */
export function foliageMaterial(key: string, roughness: number): THREE.MeshStandardMaterial {
  return get(`foliage|${key}`, () =>
    withGardenLight(
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness, metalness: 0, envMapIntensity: 0.5 }),
      `court-foliage-${key}`,
      true,
    ),
  );
}

/** Jasmine's flowers: waxy white, lit faintly from within at dusk (they open in the evening and are seen then). */
export function jasmineFlowerMaterial(): THREE.MeshStandardMaterial {
  return get("jasmineFlower", () =>
    withGardenLight(
      new THREE.MeshStandardMaterial({ color: "#fbf8f0", emissive: "#fff6e6", emissiveIntensity: 0, side: THREE.DoubleSide, roughness: 0.5, metalness: 0 }),
      "court-jasmine-flower",
      false,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Dragonflies

export function wingMaterial(): THREE.MeshStandardMaterial {
  return get("wing", () =>
    new THREE.MeshStandardMaterial({
      map: wingTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.15,
      metalness: 0.2,
      envMapIntensity: 1.4,
    }),
  );
}

export function dragonflyBodyMaterial(colour: string): THREE.MeshStandardMaterial {
  return get(`dfBody|${colour}`, () => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35, metalness: 0.25, envMapIntensity: 0.9 }));
}
