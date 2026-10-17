// The garden's procedural flower, built for the Meadow: the owner's rose on the dais and the full plant drawn in a
// plot while someone visits it. It is the same plant as the personal garden's hero (components/garden/Plant.tsx):
// the same blueprint from the seed and species (lib/plant/blueprint) re-dressed with the hero's leaves and sturdier
// cane, the same geometry builders (lib/plant/geometry), the same growth staging (garden/heroGrowth) and the same
// cached materials (components/garden/materials). What differs is how it is held: Plant.tsx reads the one global
// garden store and poses dozens of meshes every frame, which suits a scene with one plant. Here a plant is posed
// once from its own numbers and every part is baked into one mesh per material (about fifteen draw calls for a rose
// in full bloom instead of about two hundred), and the whole plant sways as one in the breeze.
//
// The pose (lod/pose.ts, shared with the Meadow's lighter detail levels) follows Plant.tsx's frame pass with the wind
// still: segment growth and girth, leaves unfurling as the cane reaches them, the bud swelling, petals opening (each
// petal's open shape baked from its morph target), the droop of a thirsty or poorly plant, a flower that opens
// smaller after stress. This file dresses it at the garden's own tessellation in the garden's materials, with leaves
// yellowing from the bottom.
//
// A visited plant dissolves in over its detail level (lod/handover.ts): `dissolving` dresses it in twins of the
// garden's materials that draw only their share of the dissolve, made once per material and kept for the session (so
// their shaders are compiled once, ahead of the first visit, by `warmDissolve`).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  budMaterial,
  leafMaterial,
  petalMaterial,
  petioleGeometry,
  petioleMaterial,
  sepalMaterial,
  sphereGeometry,
  stamenMaterial,
  stemMaterial,
  thornMaterial,
} from "@/components/garden/materials";
import { fullPlantDepthMaterial, patchFullPlant } from "@/components/meadow/lod/materials";
import { bakeMorph, posePlant, type PartMaterials, type PlantLook, type PoseDetail } from "@/components/meadow/lod/pose";
import type { Quality } from "@/lib/garden/store";
import { VARIANTS } from "@/lib/plant/blueprint";
import { makeReceptacleGeometry } from "@/lib/plant/geometry";
import { fadeOf, leafHealth, quantize } from "@/lib/plant/growth";
import { lerp } from "@/lib/plant/prng";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

export type { PlantLook };

export interface BuiltPlant {
  group: THREE.Group;
  /** the flower head's position in the plant's own frame, and the plant's height */
  head: THREE.Vector3;
  height: number;
  /** the petal and bud materials, whose glow the caller drives with the night */
  petalMats: THREE.MeshPhysicalMaterial[];
  budMat: THREE.MeshPhysicalMaterial;
  dispose(): void;
}

const PETAL_TESS: Record<Quality, [number, number]> = { cinematic: [16, 28], balanced: [12, 22], lite: [8, 14] };

/** The garden's own tessellation, part for part as Plant.tsx builds it. */
function fullDetail(petals: Quality): PoseDetail {
  return {
    petal: () => PETAL_TESS[petals],
    leaf: [10, 18],
    sepal: [6, 14],
    stem: [12, 10],
    rachis: [6, 6],
    thorn: [8, 8],
    receptacle: (radius, height) => makeReceptacleGeometry(radius, height, 3),
    sphere: sphereGeometry(),
    filament: petioleGeometry(),
    stamens: Infinity,
    leaflets: 5,
  };
}

/** A geometry reduced to position, normal and uv, non-indexed, so parts built different ways can merge. */
function mergeable(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  return g;
}

/**
 * Poses the plant for `look` and bakes it. `quality` picks the petal tessellation and the material variants (the
 * Meadow passes "lite" leaves everywhere, so no leaf ever asks for a transmission pass).
 */
export function buildFlowerPlant(look: PlantLook, quality: { petals: Quality; leaves: Quality }): BuiltPlant {
  const sp = SPECIES[look.speciesId];
  const base = { growth: look.growth, bloom: look.bloom, health: look.health, moisture: look.moisture, scorch: look.scorch };
  const chlorosis = look.chlorosis ?? 0;

  const leafMats = new Map<string, THREE.Material>();
  const petalFade = quantize(fadeOf(look.health) * 0.85, 4);
  const petalBurn = quantize(look.scorch, 3);
  const petalMats = Array.from({ length: VARIANTS }, (_, v) => petalMaterial(sp, petalFade, petalBurn, quality.petals, v));
  const budMat = budMaterial(sp);
  const mats: PartMaterials<THREE.Material> = {
    stem: (i, n) => stemMaterial(sp, i, n),
    leaf: (order) => {
      let fade = fadeOf(leafHealth(base, order));
      // yellowing from the bottom up
      fade = Math.max(fade, chlorosis * (1 - 0.6 * order));
      const fb = quantize(fade, 4);
      const bb = quantize(look.scorch * (0.5 + 0.5 * order), 3);
      const key = `${fb}|${bb}`;
      let m = leafMats.get(key);
      if (!m) {
        m = leafMaterial(sp, fb, bb, quality.leaves);
        leafMats.set(key, m);
      }
      return m;
    },
    petiole: () => petioleMaterial(sp),
    thorn: () => thornMaterial(sp),
    sepal: () => sepalMaterial(sp),
    bud: () => budMat,
    petal: (v) => petalMats[v],
    stamen: () => stamenMaterial(sp),
  };
  const posed = posePlant(look, fullDetail(quality.petals), mats);

  // ---- bake: every part into the plant's frame, one merged mesh per material ----
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const { geometry, matrix, morph, material } of posed.parts) {
    const geo = mergeable(morph > 0 ? bakeMorph(geometry, morph) : geometry);
    geo.applyMatrix4(matrix);
    const list = byMat.get(material);
    if (list) list.push(geo);
    else byMat.set(material, [geo]);
  }
  for (const geo of posed.own) geo.dispose();

  const group = new THREE.Group();
  const merged: THREE.BufferGeometry[] = [];
  const box = new THREE.Box3();
  for (const [mat, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox);
    merged.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    head: posed.head,
    height: box.isEmpty() ? 0 : box.max.y,
    petalMats,
    budMat,
    dispose() {
      // the materials are the garden's shared cache and are never disposed
      for (const geo of merged) geo.dispose();
    },
  };
}

/**
 * Gives a built plant's materials the Meadow's environment map at this hour's strength (the garden's own
 * envMapIntensity per material, scaled). Cheap to call every frame: a material is only recompiled when its map
 * first arrives.
 */
export function applyPlantEnv(plant: BuiltPlant, env: THREE.Texture | null, strength: number): void {
  for (const child of plant.group.children) {
    const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!mat || !("envMapIntensity" in mat)) continue;
    if (mat.userData.baseEnv === undefined) mat.userData.baseEnv = mat.envMapIntensity;
    if (mat.envMap !== env) {
      mat.envMap = env;
      mat.needsUpdate = true;
    }
    mat.envMapIntensity = (mat.userData.baseEnv as number) * strength;
  }
}

/** The petals' own light at this hour, as Plant.tsx sets it (without the garden's tone-mapping lift). */
export function petalGlow(speciesId: SpeciesId, night: number, health: number, bloom: number, time: number): number {
  const f = SPECIES[speciesId].flower;
  const pulse = SPECIES[speciesId].fx.pulse ? 0.75 + 0.25 * Math.sin(time * 1.4) : 1;
  return lerp(f.emissiveDay, f.emissiveNight, night) * (0.3 + 0.7 * health) * (0.2 + 0.8 * bloom) * pulse;
}

const twins = new WeakMap<THREE.Material, THREE.Material>();
let twinDepth: THREE.MeshDepthMaterial | null = null;

/** A garden material's twin that draws only the full plant's share of the visit's handover. */
function dissolveTwin(src: THREE.Material): THREE.Material {
  let twin = twins.get(src);
  if (!twin) {
    const t = src.clone();
    t.onBeforeCompile = (shader, renderer) => {
      src.onBeforeCompile.call(t, shader, renderer);
      patchFullPlant(shader);
    };
    const key = src.customProgramCacheKey.bind(src);
    t.customProgramCacheKey = () => key() + "|lod-handover";
    twins.set(src, t);
    twin = t;
  }
  return twin;
}

/** Dresses a built plant for the visit's handover: every part in its dissolving twin, its shadow dissolving too. */
export function dissolving(plant: BuiltPlant): BuiltPlant {
  twinDepth ??= fullPlantDepthMaterial();
  for (const child of plant.group.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) continue;
    mesh.material = dissolveTwin(mesh.material);
    mesh.customDepthMaterial = twinDepth;
  }
  const petalMats = plant.petalMats.map((m) => dissolveTwin(m) as THREE.MeshPhysicalMaterial);
  return { ...plant, petalMats, budMat: dissolveTwin(plant.budMat) as THREE.MeshPhysicalMaterial };
}

/**
 * Compiles the dissolving twins' shaders ahead of the first visit, from a rose in full bloom and a bud (between them
 * every kind of part a plant has), lit by the Meadow's plant environment as a visited plant is.
 */
export async function warmDissolve(gl: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, petals: Quality, env: THREE.Texture | null): Promise<void> {
  const look = { speciesId: "rose" as const, seed: "warm", health: 1, moisture: 0.6, scorch: 0 };
  const plants = [
    dissolving(buildFlowerPlant({ ...look, growth: 1, bloom: 1 }, { petals, leaves: "lite" })),
    dissolving(buildFlowerPlant({ ...look, growth: 0.79, bloom: 0 }, { petals, leaves: "lite" })),
  ];
  const group = new THREE.Group();
  for (const p of plants) {
    applyPlantEnv(p, env, 1);
    group.add(p.group);
  }
  try {
    await gl.compileAsync(group, camera, scene);
  } catch {
    // a visit compiles what it needs as it draws
  } finally {
    for (const p of plants) p.dispose();
  }
}

